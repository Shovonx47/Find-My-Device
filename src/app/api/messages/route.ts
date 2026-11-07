import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import {
  checkRateLimit,
  getClientIp,
  logServerError,
  verifyCsrfRequest,
} from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateThreadMessage, validateUuid } from '@/lib/validation';
import type { MessageRecord } from '@/types/database';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit(`messages:get:${ip}`, 120, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait briefly.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        }
      );
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

    const url = new URL(request.url);
    const rawConnId = url.searchParams.get('connectionId');

    let query = supabase
      .from('messages')
      .select('id, connection_id, sender_id, recipient_id, body, created_at, read_at')
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order('created_at', { ascending: true })
      .limit(200);

    if (rawConnId) {
      const connCheck = validateUuid(rawConnId);
      if (!connCheck.valid) {
        return NextResponse.json({ error: 'Invalid connection identifier.' }, { status: 400 });
      }
      query = query.eq('connection_id', connCheck.value);
    }

    const { data, error } = await query;

    if (error) {
      logServerError('messages:get', error);
      return NextResponse.json(
        { error: 'Unable to load messages right now.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      messages: (data ?? []) as MessageRecord[],
    });
  } catch (err) {
    logServerError('messages:get:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

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

    const rate = checkRateLimit(`messages:post:${user.id}`, 30, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many messages sent. Please wait a moment.' },
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

    const recipientCheck = validateUuid(body.recipient_id);
    if (!recipientCheck.valid || recipientCheck.value === user.id) {
      return NextResponse.json({ error: 'Invalid recipient.' }, { status: 400 });
    }

    const bodyCheck = validateThreadMessage(body.body);
    if (!bodyCheck.valid) {
      return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
    }

    // Verify accepted connection exists with matching connection_id between sender and recipient
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('id, requester_id, target_id, status')
      .eq('id', connCheck.value)
      .eq('status', 'accepted')
      .maybeSingle();

    if (connError) {
      logServerError('messages:check-connection', connError);
      return NextResponse.json(
        { error: 'Unable to send message right now.' },
        { status: 500 }
      );
    }

    const isMatchingPair =
      connection &&
      ((connection.requester_id === user.id &&
        connection.target_id === recipientCheck.value) ||
        (connection.target_id === user.id &&
          connection.requester_id === recipientCheck.value));

    if (!isMatchingPair) {
      return NextResponse.json(
        { error: 'You can only message people you are actively connected with.' },
        { status: 403 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from('messages')
      .insert({
        connection_id: connCheck.value,
        sender_id: user.id,
        recipient_id: recipientCheck.value,
        body: bodyCheck.value,
      })
      .select('id, connection_id, sender_id, recipient_id, body, created_at, read_at')
      .single();

    if (insertError || !inserted) {
      logServerError('messages:insert', insertError);
      return NextResponse.json(
        { error: 'Unable to send message. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, message: inserted as MessageRecord },
      { status: 201 }
    );
  } catch (err) {
    logServerError('messages:post:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

