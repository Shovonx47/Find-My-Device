import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import {
  checkRateLimit,
  getClientIp,
  logServerError,
  verifyCsrfRequest,
} from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const csrf = verifyCsrfRequest(request);
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.error }, { status: 403 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit(`logout:${ip}`, 30, 5 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        }
      );
    }

    if (isSupabaseConfigured()) {
      const supabase = createSupabaseServerClient();
      // Invalidate all active sessions globally for the user on sign-out
      await supabase.auth.signOut({ scope: 'global' });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logServerError('auth:logout:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
