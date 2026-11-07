-- ============================================================================
-- Find My Device: Location Sharing, Commands & Realtime Schema
-- Safe to run multiple times (idempotent). Execute in Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- Trigger: auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  v_name := left(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ), 80);

  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any users who existed before this migration
insert into public.profiles (id, display_name)
select u.id,
       left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
                     nullif(split_part(coalesce(u.email,''),'@',1),''),
                     'User'), 80)
from   auth.users u
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. CONNECTIONS TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.connections (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending','accepted','denied','revoked')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint connections_no_self_request check (requester_id <> target_id)
);

create unique index if not exists connections_active_pair_idx
  on public.connections (requester_id, target_id)
  where status in ('pending','accepted');

create index if not exists connections_requester_idx
  on public.connections (requester_id, created_at desc);

create index if not exists connections_target_idx
  on public.connections (target_id,    created_at desc);

alter table public.connections enable row level security;

drop policy if exists "connections_select_involved"  on public.connections;
drop policy if exists "connections_insert_requester" on public.connections;
drop policy if exists "connections_update_target"    on public.connections;

create policy "connections_select_involved"
  on public.connections for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = target_id);

create policy "connections_insert_requester"
  on public.connections for insert to authenticated
  with check (
    auth.uid() = requester_id
    and requester_id <> target_id
    and status = 'pending'
    and responded_at is null
  );

create policy "connections_update_target"
  on public.connections for update to authenticated
  using  (auth.uid() = target_id)
  with check (
    auth.uid() = target_id
    and status in ('accepted','denied','revoked')
  );

create or replace function public.enforce_connection_state_transition()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id           <> old.id           or
     new.requester_id <> old.requester_id or
     new.target_id    <> old.target_id    or
     new.created_at   <> old.created_at   then
    raise exception 'Connection identity fields are immutable.';
  end if;

  if old.status = 'pending' and new.status in ('accepted','denied') then
    new.responded_at := now(); return new;
  elsif old.status = 'accepted' and new.status = 'revoked' then
    new.responded_at := now(); return new;
  else
    raise exception 'Invalid connection status transition: % -> %', old.status, new.status;
  end if;
end;
$$;

drop trigger if exists trg_enforce_connection_state_transition on public.connections;
create trigger trg_enforce_connection_state_transition
  before update on public.connections
  for each row execute function public.enforce_connection_state_transition();

-- ----------------------------------------------------------------------------
-- 3. LOCATIONS TABLE (PHASE 2 & PHASE 3 HARDENED)
-- ----------------------------------------------------------------------------
create table if not exists public.locations (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  accuracy    double precision check (accuracy is null or (accuracy >= 0 and accuracy <= 100000)),
  updated_at  timestamptz not null default now()
);

alter table public.locations enable row level security;

drop policy if exists "locations_select_active" on public.locations;
drop policy if exists "locations_insert_own"    on public.locations;
drop policy if exists "locations_update_own"    on public.locations;

-- A user can see their own location, OR another user's location if there is an
-- 'accepted' connection between them in either direction.
create policy "locations_select_active"
  on public.locations for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = auth.uid() and c.target_id = locations.user_id) or
          (c.target_id = auth.uid() and c.requester_id = locations.user_id)
        )
    )
  );

-- Users can only insert or update their own location row
create policy "locations_insert_own"
  on public.locations for insert to authenticated
  with check (auth.uid() = user_id);

create policy "locations_update_own"
  on public.locations for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4. COMMANDS TABLE: RING & MESSAGE (PHASE 2 & PHASE 3 HARDENED)
-- ----------------------------------------------------------------------------
create table if not exists public.commands (
  id           uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id   uuid not null references public.profiles(id) on delete cascade,
  type         text not null check (type in ('ring', 'message')),
  payload      text check (payload is null or char_length(payload) <= 280),
  created_at   timestamptz not null default now(),
  constraint commands_no_self_send check (from_user_id <> to_user_id)
);

alter table public.commands enable row level security;

drop policy if exists "commands_insert_accepted"  on public.commands;
drop policy if exists "commands_select_recipient" on public.commands;
drop policy if exists "commands_select_involved"  on public.commands;

-- Users can only send commands to another user if an accepted connection exists
create policy "commands_insert_accepted"
  on public.commands for insert to authenticated
  with check (
    auth.uid() = from_user_id
    and from_user_id <> to_user_id
    and exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = auth.uid() and c.target_id = commands.to_user_id) or
          (c.target_id = auth.uid() and c.requester_id = commands.to_user_id)
        )
    )
  );

-- Users can select commands where they are recipient or sender
create policy "commands_select_involved"
  on public.commands for select to authenticated
  using (auth.uid() = to_user_id or auth.uid() = from_user_id);

-- ----------------------------------------------------------------------------
-- 5. MESSAGES TABLE: REAL-TIME THREADS PER CONNECTION
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  sender_id     uuid not null references public.profiles(id) on delete cascade,
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  body          text not null check (char_length(trim(body)) between 1 and 500),
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  constraint messages_no_self_send check (sender_id <> recipient_id)
);

create index if not exists messages_connection_created_idx
  on public.messages (connection_id, created_at asc);

create index if not exists messages_recipient_unread_idx
  on public.messages (recipient_id, connection_id)
  where read_at is null;

alter table public.messages enable row level security;

drop policy if exists "messages_select_involved"       on public.messages;
drop policy if exists "messages_insert_accepted"       on public.messages;
drop policy if exists "messages_update_recipient_read" on public.messages;

-- Users can only select messages where they are sender or recipient
create policy "messages_select_involved"
  on public.messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Users can only insert messages where an 'accepted' connection exists between sender and recipient
create policy "messages_insert_accepted"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and exists (
      select 1 from public.connections c
      where c.id = connection_id
        and c.status = 'accepted'
        and (
          (c.requester_id = sender_id and c.target_id = recipient_id) or
          (c.target_id = sender_id and c.requester_id = recipient_id)
        )
    )
  );

-- Only the recipient can update their incoming message rows (to set read_at)
create policy "messages_update_recipient_read"
  on public.messages for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

create or replace function public.enforce_message_read_only_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id            <> old.id            or
     new.connection_id <> old.connection_id or
     new.sender_id     <> old.sender_id     or
     new.recipient_id  <> old.recipient_id  or
     new.body          <> old.body          or
     new.created_at    <> old.created_at    then
    raise exception 'Only read_at may be updated on messages.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_message_read_only_update on public.messages;
create trigger trg_enforce_message_read_only_update
  before update on public.messages
  for each row execute function public.enforce_message_read_only_update();

-- ----------------------------------------------------------------------------
-- 6. SECURITY-DEFINER RPCs (PHASE 3 HARDENED AGAINST ENUMERATION & ABUSE)
-- ----------------------------------------------------------------------------

create or replace function public.request_location_sharing(target_email text)
returns jsonb language plpgsql security definer
set search_path = public, auth as $$
declare
  v_me          uuid := auth.uid();
  v_email       text := lower(trim(coalesce(target_email, '')));
  v_me_verified timestamptz;
  v_recent_cnt  integer;
  v_target      record;
  v_existing    text;
  v_conn_id     uuid;
begin
  if v_me is null then
    return jsonb_build_object('success',false,'code','UNAUTHENTICATED',
      'message','You must be signed in to send a request.');
  end if;

  select email_confirmed_at into v_me_verified
  from auth.users where id = v_me limit 1;

  if v_me_verified is null then
    return jsonb_build_object('success',false,'code','UNVERIFIED_EMAIL',
      'message','Please verify your email address before sending requests.');
  end if;

  if v_email = '' or position('@' in v_email) < 2 then
    return jsonb_build_object('success',false,'code','INVALID_EMAIL',
      'message','Please enter a valid email address.');
  end if;

  -- Database-enforced rate limit: max 5 outgoing requests per 10 minutes
  select count(*) into v_recent_cnt
  from public.connections
  where requester_id = v_me
    and created_at > now() - interval '10 minutes';

  if v_recent_cnt >= 5 then
    return jsonb_build_object('success',false,'code','RATE_LIMITED',
      'message','Too many requests sent recently. Please wait a few minutes.');
  end if;

  select id, email, raw_user_meta_data into v_target
  from auth.users where lower(email) = v_email limit 1;

  -- Anti-enumeration: return identical neutral success message when target does not exist
  if v_target.id is null then
    return jsonb_build_object('success',true,'code','REQUEST_SENT',
      'message','If an account exists for that email, your location-sharing request has been sent.',
      'connection_id',null);
  end if;

  if v_target.id = v_me then
    return jsonb_build_object('success',false,'code','SELF_REQUEST',
      'message','You cannot send a request to yourself.');
  end if;

  insert into public.profiles (id, display_name)
  select u.id, left(coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'),''),
                              nullif(split_part(coalesce(u.email,''),'@',1),''),
                              'User'), 80)
  from auth.users u where u.id in (v_me, v_target.id)
  on conflict (id) do nothing;

  select status into v_existing
  from public.connections
  where requester_id = v_me and target_id = v_target.id
    and status in ('pending','accepted')
  limit 1;

  if v_existing = 'pending' then
    return jsonb_build_object('success',false,'code','ALREADY_PENDING',
      'message','You already have a pending request for this user.');
  elsif v_existing = 'accepted' then
    return jsonb_build_object('success',false,'code','ALREADY_ACCEPTED',
      'message','This user is already sharing their location with you.');
  end if;

  insert into public.connections (requester_id, target_id, status)
  values (v_me, v_target.id, 'pending')
  returning id into v_conn_id;

  return jsonb_build_object('success',true,'code','REQUEST_SENT',
    'message','If an account exists for that email, your location-sharing request has been sent.',
    'connection_id',v_conn_id);
end;
$$;

revoke all on function public.request_location_sharing(text) from public, anon;
grant execute on function public.request_location_sharing(text) to authenticated;

create or replace function public.get_my_connections()
returns table (
  id             uuid,
  requester_id   uuid,
  target_id      uuid,
  requester_name text,
  target_name    text,
  status         text,
  created_at     timestamptz,
  responded_at   timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;

  return query
  select c.id, c.requester_id, c.target_id,
         rp.display_name, tp.display_name,
         c.status, c.created_at, c.responded_at
  from   public.connections c
  join   public.profiles rp on rp.id = c.requester_id
  join   public.profiles tp on tp.id = c.target_id
  where  c.requester_id = auth.uid() or c.target_id = auth.uid()
  order  by c.created_at desc;
end;
$$;

revoke all on function public.get_my_connections() from public, anon;
grant execute on function public.get_my_connections() to authenticated;

-- Explicitly revoke unauthenticated (anon) table access across all application tables
revoke all on table public.profiles, public.connections, public.locations, public.commands, public.messages from anon;

-- ----------------------------------------------------------------------------
-- 7. SUPABASE REALTIME CONFIGURATION
-- ----------------------------------------------------------------------------
alter table public.connections replica identity full;
alter table public.locations   replica identity full;
alter table public.commands    replica identity full;
alter table public.messages    replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'connections'
  ) then
    alter publication supabase_realtime add table public.connections;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'locations'
  ) then
    alter publication supabase_realtime add table public.locations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commands'
  ) then
    alter publication supabase_realtime add table public.commands;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
