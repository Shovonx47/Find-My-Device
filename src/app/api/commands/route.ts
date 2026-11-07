import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit, logServerError, verifyCsrfRequest } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateCommandMessage, validateUuid } from '@/lib/validation';

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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
    }

    const targetIdCheck = validateUuid(body.to_user_id);
    if (!targetIdCheck.valid) {
      return NextResponse.json({ error: 'Invalid recipient.' }, { status: 400 });
    }

    if (targetIdCheck.value === user.id) {
      return NextResponse.json({ error: 'Invalid recipient.' }, { status: 400 });
    }

    const type = body.type;
    if (type !== 'ring' && type !== 'message') {
      return NextResponse.json({ error: 'Invalid command type.' }, { status: 400 });
    }

    let payload: string | null = null;
    if (type === 'message') {
      const msgCheck = validateCommandMessage(body.payload);
      if (!msgCheck.valid) {
        return NextResponse.json({ error: msgCheck.error }, { status: 400 });
      }
      payload = msgCheck.value;
    }

    // Rate limiting
    const rateKey = `command:${type}:${user.id}`;
    const maxRequests = type === 'ring' ? 10 : 20;
    const rate = checkRateLimit(rateKey, maxRequests, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Too many ${type}s sent. Please wait briefly.` },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    // Verify accepted connection exists between user and target
    const { data: connection, error: connError } = await supabase
      .from('connections')
      .select('id')
      .eq('status', 'accepted')
      .or(
        `and(requester_id.eq.${user.id},target_id.eq.${targetIdCheck.value}),and(target_id.eq.${user.id},requester_id.eq.${targetIdCheck.value})`
      )
      .maybeSingle();

    if (connError) {
      logServerError('commands:check-connection', connError);
      return NextResponse.json(
        { error: 'Unable to send command. Please try again.' },
        { status: 500 }
      );
    }

    if (!connection) {
      return NextResponse.json(
        { error: 'You can only send commands to someone you are actively connected with.' },
        { status: 403 }
      );
    }

    const { error: insertError } = await supabase
      .from('commands')
      .insert({
        from_user_id: user.id,
        to_user_id: targetIdCheck.value,
        type,
        payload,
      });

    if (insertError) {
      logServerError('commands:insert', insertError);
      return NextResponse.json(
        { error: 'Unable to send command. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    logServerError('commands:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
