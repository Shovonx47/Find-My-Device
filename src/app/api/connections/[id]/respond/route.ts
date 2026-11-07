import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit, logServerError, verifyCsrfRequest } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  canTransitionStatus,
  validateConsentAction,
  validateUuid,
} from '@/lib/validation';
import type { Connection } from '@/types/database';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
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

    const idCheck = validateUuid(context.params.id);
    if (!idCheck.valid) {
      return NextResponse.json({ error: idCheck.error }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const rate = checkRateLimit(`connections:respond:${user.id}`, 40, 5 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many updates. Please wait briefly.' },
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

    const actionCheck = validateConsentAction(body.status);
    if (!actionCheck.valid) {
      return NextResponse.json({ error: actionCheck.error }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabase
      .from('connections')
      .select('id, requester_id, target_id, status, created_at, responded_at')
      .eq('id', idCheck.value)
      .maybeSingle();

    if (fetchError) {
      logServerError('connections:respond:fetch', fetchError);
      return NextResponse.json(
        { error: 'Unable to look up request.' },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'Request not found.' },
        { status: 404 }
      );
    }

    const currentConnection = existing as Connection;

    // Explicit server-side ownership validation (also enforced by RLS and DB trigger)
    if (currentConnection.target_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the recipient of a request can respond to it.' },
        { status: 403 }
      );
    }

    if (!canTransitionStatus(currentConnection.status, actionCheck.value)) {
      return NextResponse.json(
        { error: 'This request has already been updated.' },
        { status: 409 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from('connections')
      .update({
        status: actionCheck.value,
        responded_at: new Date().toISOString(),
      })
      .eq('id', idCheck.value)
      .eq('target_id', user.id)
      .select('id, requester_id, target_id, status, created_at, responded_at')
      .single();

    if (updateError || !updated) {
      logServerError('connections:respond:update', updateError);
      return NextResponse.json(
        { error: 'Unable to update request right now.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      connection: updated as Connection,
    });
  } catch (err) {
    logServerError('connections:respond:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
