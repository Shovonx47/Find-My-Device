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
import type {
  ConnectionWithNames,
  RequestLocationRpcResult,
} from '@/types/database';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit(`connections:get:${ip}`, 120, 60 * 1000);
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

    const { data, error } = await supabase.rpc('get_my_connections');
    if (error) {
      logServerError('connections:get', error);
      return NextResponse.json(
        { error: 'Unable to load connections right now. Please try again later.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      connections: (data ?? []) as ConnectionWithNames[],
    });
  } catch (err) {
    logServerError('connections:get:unhandled', err);
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

    const ip = getClientIp(request);
    const ipRate = checkRateLimit(`connections:create:ip:${ip}`, 10, 10 * 60 * 1000);
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: 'Too many location-sharing requests. Please wait a few minutes.' },
        {
          status: 429,
          headers: { 'Retry-After': String(ipRate.retryAfterSeconds) },
        }
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

    const userRate = checkRateLimit(`connections:create:user:${user.id}`, 5, 10 * 60 * 1000);
    if (!userRate.allowed) {
      return NextResponse.json(
        { error: 'Too many location-sharing requests. Please wait a few minutes.' },
        {
          status: 429,
          headers: { 'Retry-After': String(userRate.retryAfterSeconds) },
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

    const emailCheck = validateEmail(body.email);
    if (!emailCheck.valid) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 });
    }

    if (user.email && user.email.toLowerCase() === emailCheck.value) {
      return NextResponse.json(
        { error: 'You cannot send a location-sharing request to yourself.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('request_location_sharing', {
      target_email: emailCheck.value,
    });

    if (error) {
      logServerError('connections:create', error);
      return NextResponse.json(
        { error: 'Could not process location-sharing request. Please try again later.' },
        { status: 500 }
      );
    }

    const result = data as RequestLocationRpcResult | null;

    // Anti-enumeration: treat USER_NOT_FOUND identically to CREATED/REQUEST_SENT
    if (result?.code === 'USER_NOT_FOUND' || result?.code === 'REQUEST_SENT' || result?.code === 'CREATED') {
      return NextResponse.json(
        {
          ok: true,
          message: 'If an account exists for that email, your location-sharing request has been sent.',
          connectionId: result?.connection_id ?? null,
        },
        { status: 200 }
      );
    }

    if (!result || !result.success) {
      const statusMap: Record<string, number> = {
        UNAUTHENTICATED: 401,
        UNVERIFIED_EMAIL: 403,
        RATE_LIMITED: 429,
        INVALID_EMAIL: 400,
        SELF_REQUEST: 400,
        ALREADY_PENDING: 409,
        ALREADY_ACCEPTED: 409,
      };

      const statusCode = (result?.code && statusMap[result.code]) || 400;
      return NextResponse.json(
        { error: result?.message ?? 'Unable to create location-sharing request.' },
        { status: statusCode }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        message: 'If an account exists for that email, your location-sharing request has been sent.',
        connectionId: result.connection_id ?? null,
      },
      { status: 200 }
    );
  } catch (err) {
    logServerError('connections:create:unhandled', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
