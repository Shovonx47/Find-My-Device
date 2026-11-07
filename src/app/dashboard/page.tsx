import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { ConsentDashboard } from '@/components/ConsentDashboard';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ConnectionWithNames,
  MessageRecord,
  UserLocation,
} from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    redirect('/login');
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  if (!user.email_confirmed_at) {
    redirect('/verify-email?email=' + encodeURIComponent(user.email ?? ''));
  }

  const [
    { data: profile },
    { data: connectionsData, error: connectionsError },
    { data: locationsData },
    { data: messagesData },
    {
      data: { session },
    },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.rpc('get_my_connections'),
    supabase.from('locations').select('*'),
    supabase
      .from('messages')
      .select('id, connection_id, sender_id, recipient_id, body, created_at, read_at')
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase.auth.getSession(),
  ]);

  const fallbackName =
    (typeof user.user_metadata?.display_name === 'string' &&
      user.user_metadata.display_name.trim()) ||
    user.email?.split('@')[0] ||
    'User';

  const displayName = profile?.display_name ?? fallbackName;
  const initialConnections = (connectionsData ?? []) as ConnectionWithNames[];
  const initialLocations = (locationsData ?? []) as UserLocation[];
  const initialMessages = (messagesData ?? []) as MessageRecord[];
  const schemaError = connectionsError
    ? 'Unable to load your sharing list right now. Please refresh the page in a moment.'
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader activePage="dashboard" displayName={displayName} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8 sm:px-6">
        <ConsentDashboard
          currentUserId={user.id}
          initialConnections={initialConnections}
          initialLocations={initialLocations}
          initialMessages={initialMessages}
          schemaError={schemaError}
          realtimeAccessToken={session?.access_token ?? null}
        />
      </main>
    </div>
  );
}
