import { redirect } from 'next/navigation';
import { AccountPanel } from '@/components/AccountPanel';
import { AppHeader } from '@/components/AppHeader';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  const fallbackName =
    (typeof user.user_metadata?.display_name === 'string' &&
      user.user_metadata.display_name.trim()) ||
    user.email?.split('@')[0] ||
    'User';

  const displayName = profile?.display_name ?? fallbackName;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader activePage="account" displayName={displayName} />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <AccountPanel
          email={user.email ?? 'Unknown email'}
          initialDisplayName={displayName}
        />
      </main>
    </div>
  );
}

