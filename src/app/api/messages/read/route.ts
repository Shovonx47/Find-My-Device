import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import {
  checkRateLimit,
  logServerError,
  verifyCsrfRequest,
} from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateUuid } from '@/lib/validation';

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

    const rate = checkRateLimit(`messages:read:${user.id}`, 60, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests.' },
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
      return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
    }

    const connCheck = validateUuid(body.connection_id);
    if (!connCheck.valid) {
      return NextResponse.json({ error: 'Invalid connection.' }, { status: 400 });
    }

    const readAt = new Date().toISOString();

    const { error } = await supabase
      .from('messages')
      .update({ read_at: readAt })
      .eq('connection_id', connCheck.value)
      .eq('recipient_id', user.id)
      .is('read_at', null);

    if (error) {
      logServerError('messages:read', error);
      return NextResponse.json(
        { error: 'Unable to update read status.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, readAt });
  } catch (err) {
    logServerError('messages:read:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

