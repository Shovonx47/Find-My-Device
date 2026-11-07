import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import {
  checkRateLimit,
  getClientIp,
  logServerError,
  verifyCsrfRequest,
} from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateEmail } from '@/lib/validation';

export async function POST(request: Request) {
  try {
    const csrf = verifyCsrfRequest(request);
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.error }, { status: 403 });
    }

    const ip = getClientIp(request);
    const ipRate = checkRateLimit(`login:ip:${ip}`, 15, 15 * 60 * 1000);
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please wait before trying again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(ipRate.retryAfterSeconds) },
        }
      );
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Account service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'Invalid request payload.' },
        { status: 400 }
      );
    }

    const emailCheck = validateEmail(body.email);
    if (!emailCheck.valid) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 });
    }

    const emailRate = checkRateLimit(`login:email:${emailCheck.value}`, 5, 15 * 60 * 1000);
    if (!emailRate.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please wait before trying again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(emailRate.retryAfterSeconds) },
        }
      );
    }

    if (
      typeof body.password !== 'string' ||
      body.password.length === 0 ||
      body.password.length > 128
    ) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: emailCheck.value,
      password: body.password,
    });

    if (error) {
      const isUnconfirmed = error.message.toLowerCase().includes('email not confirmed');
      if (isUnconfirmed) {
        return NextResponse.json(
          {
            error: 'Please verify your email address before signing in.',
            unverified: true,
            email: emailCheck.value,
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logServerError('auth:login:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
