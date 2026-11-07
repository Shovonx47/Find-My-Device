# Find My Device — Consent-Based Location Sharing

A Next.js 14 (App Router, TypeScript, Tailwind CSS) application connected to Supabase Auth, Postgres (with Row Level Security), and Supabase Realtime for explicit, revocable location-sharing consent.

## Features

- **Authentication**: Email/password signup & login via Supabase Auth (`@supabase/ssr`), protected `/dashboard` and `/account` routes that redirect unauthenticated users to `/login`, and a simple `/account` page showing the signed-in email, display name, and logout control.
- **Strict Row Level Security (RLS)**:
  - `public.profiles`: Users can only read and update their own profile row (`auth.uid() = id`).
  - `public.connections`: Users can only read connection rows where they are `requester_id` or `target_id`; only `requester_id` can create pending requests and only `target_id` can transition consent (`pending -> accepted | denied`, `accepted -> revoked`).
- **Unambiguous Consent Flow & Live Realtime Updates**:
  - Send a location-sharing request from `/dashboard` by entering another registered user's email.
  - Recipients see `"[Name] wants to see your location."` with explicit explanation of what accepting or denying means and **Accept** / **Deny** controls.
  - Accepted connections display a persistent **`Sharing with [Name] — Stop sharing`** control on the target user's dashboard that immediately sets status to `'revoked'`.
  - Powered by **Supabase Realtime** (`postgres_changes` on `public.connections`) so both sides see new requests and status updates live without refreshing.

---

## 1. Supabase Setup

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor** -> **New query**, paste the contents of [`supabase/schema.sql`](./supabase/schema.sql), and click **Run**.
   - This creates `profiles` and `connections`, enables RLS policies, sets up automatic profile creation on signup, adds narrow RPC functions (`request_location_sharing`, `get_my_connections`), and enables `supabase_realtime` on `public.connections`.
3. *(Optional for rapid testing)* In **Authentication -> Providers -> Email**, you can toggle **Confirm email** off to sign in immediately without email verification links, or keep it enabled and add your local/Vercel callback URL (`http://127.0.0.1:3000/auth/callback` and `https://<your-domain>.vercel.app/auth/callback`) under **Authentication -> URL Configuration -> Redirect URLs**.
4. Grab your **Project URL** and **anon public** key from **Project Settings -> API**.

---

## 2. Local Development

```bash
cp .env.local.example .env.local
```

Populate `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-public-key
```

Install dependencies and start the dev server (bound to `127.0.0.1:3000`):

```bash
npm install
npm run dev
```

To test the two-user live consent flow locally:
- Open `http://127.0.0.1:3000/signup` in a normal browser window and register **User A**.
- Open `http://127.0.0.1:3000/signup` in an Incognito/Private window and register **User B**.
- Keep both `/dashboard` tabs side-by-side: send a request from User A to User B's email, watch it appear live on User B's dashboard, click **Accept** (or **Deny**), and click **Stop sharing** to verify live revocation.

---

## 3. Deploying to Vercel

1. Push this repository to GitHub/GitLab/Bitbucket and import it into **Vercel**.
2. In Vercel **Project Settings -> Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy! Once deployed, add `https://<your-vercel-domain>.vercel.app/auth/callback` to **Supabase -> Authentication -> URL Configuration -> Redirect URLs** (and set **Site URL** to `https://<your-vercel-domain>.vercel.app`).

---

## Scripts

- `npm run dev` — Start Next.js development server on `127.0.0.1`
- `npm run build` — Production build check
- `npm run typecheck` — TypeScript strict check
- `npm run lint` — ESLint check
- `npm test` — Run Vitest unit & consent-flow integration tests

