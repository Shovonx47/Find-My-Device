import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateEmail } from '@/lib/validation';
import { VerifyEmailCard } from '@/components/VerifyEmailCard';

interface VerifyEmailPageProps {
  searchParams?: {
    email?: string;
  };
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const emailCheck = validateEmail(searchParams?.email);
  let userEmail = emailCheck.valid ? emailCheck.value : '';

  if (!userEmail && isSupabaseConfigured()) {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) {
      userEmail = user.email;
    }
  }

  return (
    <main>
      <VerifyEmailCard initialEmail={userEmail} />
    </main>
  );
}
