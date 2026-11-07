import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function SignupPage() {
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && user.email_confirmed_at) {
      redirect('/dashboard');
    }
  }

  return (
    <main>
      <AuthForm mode="signup" supabaseConfigured={configured} />
    </main>
  );
}
