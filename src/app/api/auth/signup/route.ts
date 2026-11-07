import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import {
  checkRateLimit,
  getClientIp,
  logServerError,
  verifyCsrfRequest,
} from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '@/lib/validation';

export async function POST(request: Request) {
  try {
    const csrf = verifyCsrfRequest(request);
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.error }, { status: 403 });
    }

    const ip = getClientIp(request);
    const ipRate = checkRateLimit(`signup:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again shortly.' },
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

    const emailRate = checkRateLimit(`signup:email:${emailCheck.value}`, 3, 15 * 60 * 1000);
    if (!emailRate.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again shortly.' },
        {
          status: 429,
          headers: { 'Retry-After': String(emailRate.retryAfterSeconds) },
        }
      );
    }

    const passwordCheck = validatePassword(body.password);
    if (!passwordCheck.valid) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const fallbackName = emailCheck.value.split('@')[0] || 'User';
    const rawDisplayName =
      typeof body.displayName === 'string' && body.displayName.trim().length > 0
        ? body.displayName
        : fallbackName;

    const displayNameCheck = validateDisplayName(rawDisplayName);
    if (!displayNameCheck.valid) {
      return NextResponse.json({ error: displayNameCheck.error }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase.auth.signUp({
      email: emailCheck.value,
      password: passwordCheck.value,
      options: {
        data: {
          display_name: displayNameCheck.value,
        },
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });

    if (error) {
      // Prevent email enumeration: if the email is already registered, return the
      // same confirmation-required response rather than revealing account existence.
      if (error.message.toLowerCase().includes('already registered')) {
        return NextResponse.json({
          ok: true,
          requiresEmailConfirmation: true,
        });
      }

      logServerError('auth:signup', error);
      return NextResponse.json(
        { error: 'Unable to create account. Please check your details and try again.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      requiresEmailConfirmation: !data.session,
    });
  } catch (err) {
    logServerError('auth:signup:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
