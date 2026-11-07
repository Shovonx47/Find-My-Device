import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit, logServerError, verifyCsrfRequest } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateCoordinates } from '@/lib/validation';

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

    // Rate limit: at most 30 location updates per minute per user (one every 2 seconds)
    const rate = checkRateLimit(`location:${user.id}`, 30, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many location updates.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
    }

    const coordsCheck = validateCoordinates(body);
    if (!coordsCheck.valid) {
      return NextResponse.json({ error: coordsCheck.error }, { status: 400 });
    }

    const { latitude, longitude, accuracy } = coordsCheck.value;

    const { error } = await supabase.from('locations').upsert(
      {
        user_id: user.id,
        latitude,
        longitude,
        accuracy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      logServerError('location:upsert', error);
      return NextResponse.json({ error: 'Unable to save location.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logServerError('location:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
