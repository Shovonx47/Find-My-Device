-- ============================================================================
-- Consent-Based Location-Sharing Schema, RLS Policies, Triggers & Realtime
-- Run this entire script in the Supabase SQL Editor (Project -> SQL Editor).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. PROFILES TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Automatically create a profile row whenever a new auth.users record is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := left(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    80
  );

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill profiles for any users that existed prior to running this migration
insert into public.profiles (id, display_name)
select
  u.id,
  left(
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'User'
    ),
    80
  )
from auth.users u
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. CONNECTIONS TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'denied', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint connections_no_self_request check (requester_id <> target_id)
);

-- Prevent duplicate active ('pending' or 'accepted') requests for the same pair
create unique index if not exists connections_active_pair_idx
  on public.connections (requester_id, target_id)
  where status in ('pending', 'accepted');

create index if not exists connections_requester_idx
  on public.connections (requester_id, created_at desc);

create index if not exists connections_target_idx
  on public.connections (target_id, created_at desc);

alter table public.connections enable row level security;

-- Users can only see connection rows where they are requester_id or target_id
drop policy if exists "connections_select_involved" on public.connections;
create policy "connections_select_involved"
  on public.connections
  for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = target_id);

-- Requesters can only create new pending connections originating from themselves
drop policy if exists "connections_insert_requester" on public.connections;
create policy "connections_insert_requester"
  on public.connections
  for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and requester_id <> target_id
    and status = 'pending'
    and responded_at is null
  );

-- Only the target user can respond to or revoke consent on a connection
drop policy if exists "connections_update_target" on public.connections;
create policy "connections_update_target"
  on public.connections
  for update
  to authenticated
  using (auth.uid() = target_id)
  with check (
    auth.uid() = target_id
    and status in ('accepted', 'denied', 'revoked')
  );

-- Enforce strict state machine transitions and immutable ownership columns
create or replace function public.enforce_connection_state_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id <> old.id
     or new.requester_id <> old.requester_id
     or new.target_id <> old.target_id
     or new.created_at <> old.created_at then
    raise exception 'Connection identity fields are immutable.';
  end if;

  if auth.uid() is not null and auth.uid() <> old.target_id then
    raise exception 'Only the target user can modify consent status.';
  end if;

  if old.status = 'pending' and new.status in ('accepted', 'denied') then
    new.responded_at := now();
    return new;
  elsif old.status = 'accepted' and new.status = 'revoked' then
    new.responded_at := now();
    return new;
  else
    raise exception 'Invalid connection status transition from % to %.', old.status, new.status;
  end if;
end;
$$;

drop trigger if exists trg_enforce_connection_state_transition on public.connections;
create trigger trg_enforce_connection_state_transition
  before update on public.connections
  for each row
  execute function public.enforce_connection_state_transition();

-- ----------------------------------------------------------------------------
-- 3. NARROW SECURITY DEFINER RPC FUNCTIONS (PRESERVES STRICT PROFILES RLS)
-- ----------------------------------------------------------------------------

-- Send a location-sharing request by looking up the target user's email
create or replace function public.request_location_sharing(target_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_requester_id uuid := auth.uid();
  v_normalized_email text := lower(trim(coalesce(target_email, '')));
  v_target_record record;
  v_existing_status text;
  v_connection_id uuid;
begin
  if v_requester_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'UNAUTHENTICATED',
      'message', 'You must be signed in to send a request.'
    );
  end if;

  if v_normalized_email = '' or position('@' in v_normalized_email) < 2 then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_EMAIL',
      'message', 'Please enter a valid email address.'
    );
  end if;

  select u.id, u.email, u.raw_user_meta_data
  into v_target_record
  from auth.users u
  where lower(u.email) = v_normalized_email
  limit 1;

  if v_target_record.id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'USER_NOT_FOUND',
      'message', 'No account found with that email address.'
    );
  end if;

  if v_target_record.id = v_requester_id then
    return jsonb_build_object(
      'success', false,
      'code', 'SELF_REQUEST',
      'message', 'You cannot send a location-sharing request to yourself.'
    );
  end if;

  -- Ensure both users have profile rows
  insert into public.profiles (id, display_name)
  select
    u.id,
    left(
      coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
        'User'
      ),
      80
    )
  from auth.users u
  where u.id in (v_requester_id, v_target_record.id)
  on conflict (id) do nothing;

  select c.status
  into v_existing_status
  from public.connections c
  where c.requester_id = v_requester_id
    and c.target_id = v_target_record.id
    and c.status in ('pending', 'accepted')
  limit 1;

  if v_existing_status = 'pending' then
    return jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PENDING',
      'message', 'You already have a pending request for this user.'
    );
  elsif v_existing_status = 'accepted' then
    return jsonb_build_object(
      'success', false,
      'code', 'ALREADY_ACCEPTED',
      'message', 'This user is already sharing their location with you.'
    );
  end if;

  insert into public.connections (requester_id, target_id, status)
  values (v_requester_id, v_target_record.id, 'pending')
  returning id into v_connection_id;

  return jsonb_build_object(
    'success', true,
    'code', 'CREATED',
    'message', 'Location-sharing request sent.',
    'connection_id', v_connection_id
  );
end;
$$;

revoke all on function public.request_location_sharing(text) from public;
grant execute on function public.request_location_sharing(text) to authenticated;

-- Fetch connections for the current user along with counterparty display names
create or replace function public.get_my_connections()
returns table (
  id uuid,
  requester_id uuid,
  target_id uuid,
  requester_name text,
  target_name text,
  status text,
  created_at timestamptz,
  responded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  select
    c.id,
    c.requester_id,
    c.target_id,
    rp.display_name as requester_name,
    tp.display_name as target_name,
    c.status,
    c.created_at,
    c.responded_at
  from public.connections c
  join public.profiles rp on rp.id = c.requester_id
  join public.profiles tp on tp.id = c.target_id
  where c.requester_id = auth.uid()
     or c.target_id = auth.uid()
  order by c.created_at desc;
end;
$$;

revoke all on function public.get_my_connections() from public;
grant execute on function public.get_my_connections() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. SUPABASE REALTIME CONFIGURATION
-- ----------------------------------------------------------------------------
alter table public.connections replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'connections'
  ) then
    alter publication supabase_realtime add table public.connections;
  end if;
end
$$;
