import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit, getClientIp, logServerError } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit(`realtime-token:${ip}`, 30, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        }
      );
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ accessToken: null }, { status: 200 });
    }

    const supabase = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user || !user.email_confirmed_at) {
      return NextResponse.json({ accessToken: null }, { status: 401 });
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return NextResponse.json({
      accessToken: session?.access_token ?? null,
    });
  } catch (err) {
    logServerError('auth:realtime-token', err);
    return NextResponse.json({ accessToken: null }, { status: 500 });
  }
}
