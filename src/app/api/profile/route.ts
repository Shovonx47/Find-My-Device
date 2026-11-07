import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit, logServerError, verifyCsrfRequest } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateDisplayName } from '@/lib/validation';

export async function POST(request: Request) {
  try {
    const csrf = verifyCsrfRequest(request);
    if (!csrf.ok) {
      return NextResponse.json({ error: csrf.error }, { status: 403 });
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Service is temporarily unavailable.' },
        { status: 503 }
      );
    }

    const supabase = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const rate = checkRateLimit(`profile:update:${user.id}`, 15, 5 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many profile updates. Please wait briefly.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        }
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

    const displayNameCheck = validateDisplayName(body.displayName);
    if (!displayNameCheck.valid) {
      return NextResponse.json({ error: displayNameCheck.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: displayNameCheck.value })
      .eq('id', user.id)
      .select('id, display_name, created_at')
      .single();

    if (error || !data) {
      logServerError('profile:update', error);
      return NextResponse.json(
        { error: 'Unable to update your name right now.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      profile: data,
    });
  } catch (err) {
    logServerError('profile:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
