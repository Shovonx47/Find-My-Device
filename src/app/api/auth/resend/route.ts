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
    const ipRate = checkRateLimit(`resend:ip:${ip}`, 5, 10 * 60 * 1000);
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a few minutes before trying again.' },
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

    const emailRate = checkRateLimit(`resend:email:${emailCheck.value}`, 3, 10 * 60 * 1000);
    if (!emailRate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a few minutes before trying again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(emailRate.retryAfterSeconds) },
        }
      );
    }

    const origin = new URL(request.url).origin;
    const supabase = createSupabaseServerClient();

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: emailCheck.value,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });

    if (error) {
      logServerError('auth:resend', error);
    }

    // Always return a uniform response to prevent email enumeration
    return NextResponse.json({
      ok: true,
      message: 'A new confirmation email has been sent. Please check your inbox.',
    });
  } catch (err) {
    logServerError('auth:resend:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
