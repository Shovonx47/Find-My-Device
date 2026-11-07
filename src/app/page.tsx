import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';

export default async function HomePage() {
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect('/dashboard');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-teal-50 via-white to-slate-50 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md text-center">
        {/* Brand Icon */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-600 shadow-md">
            <MapPin className="h-8 w-8 text-white" />
          </div>
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Find My Device
        </h1>
        <p className="mt-3 text-base text-slate-600 sm:text-lg">
          Share your location with people you trust.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="w-full sm:w-auto min-h-[44px]">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto min-h-[44px]">
            <Link href="/signup">Create an account</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
