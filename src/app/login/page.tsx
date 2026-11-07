import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

interface LoginPageProps {
  searchParams?: {
    error?: string;
  };
}

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  verification_failed: 'Could not verify your email link. Please sign in or request a new link.',
  service_unavailable: 'Account service is temporarily unavailable. Please try again shortly.',
  rate_limited: 'Too many verification attempts. Please wait a moment and try again.',
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
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

  const errorCode =
    typeof searchParams?.error === 'string' ? searchParams.error : '';
  const safeError = LOGIN_ERROR_MESSAGES[errorCode];

  return (
    <main>
      <AuthForm
        mode="login"
        supabaseConfigured={configured}
        initialError={safeError}
      />
    </main>
  );
}
