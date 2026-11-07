import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit, getClientIp, logServerError } from '@/lib/security';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ALLOWED_REDIRECT_PATHS = new Set(['/dashboard', '/account']);
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'email',
  'recovery',
  'invite',
  'magiclink',
  'email_change',
]);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  try {
    const ip = getClientIp(request);
    const rate = checkRateLimit(`auth:callback:${ip}`, 20, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.redirect(
        new URL('/login?error=rate_limited', requestUrl.origin)
      );
    }

    const code = requestUrl.searchParams.get('code');
    const token_hash = requestUrl.searchParams.get('token_hash');
    const rawType = requestUrl.searchParams.get('type') as EmailOtpType | null;
    const rawNext = requestUrl.searchParams.get('next') ?? '/dashboard';

    // Strict allow-list check to prevent open-redirect attacks
    const safeNext = ALLOWED_REDIRECT_PATHS.has(rawNext)
      ? rawNext
      : '/dashboard';

    if (!isSupabaseConfigured()) {
      return NextResponse.redirect(
        new URL('/login?error=service_unavailable', requestUrl.origin)
      );
    }

    const supabase = createSupabaseServerClient();

    if (code && code.length <= 512) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
      }
      logServerError('auth:callback:code', error);
    } else if (
      token_hash &&
      token_hash.length <= 512 &&
      rawType &&
      ALLOWED_OTP_TYPES.has(rawType)
    ) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: rawType,
      });
      if (!error) {
        return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
      }
      logServerError('auth:callback:otp', error);
    }

    return NextResponse.redirect(
      new URL('/login?error=verification_failed', requestUrl.origin)
    );
  } catch (err) {
    logServerError('auth:callback:unhandled', err);
    return NextResponse.redirect(
      new URL('/login?error=verification_failed', requestUrl.origin)
    );
  }
}
