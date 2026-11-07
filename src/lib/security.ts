import { getSupabaseCspOrigins } from '@/lib/env';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

// TODO(security): Replace with Upstash Redis for horizontal scaling.
const rateLimitStore = new Map<string, RateLimitBucket>();

function pruneExpiredBuckets(now: number): void {
  if (rateLimitStore.size < 500) return;
  rateLimitStore.forEach((bucket, key) => {
    if (bucket.resetAt <= now) rateLimitStore.delete(key);
  });
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  pruneExpiredBuckets(now);

  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= maxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000)
    );
    return { allowed: false, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimitStoreForTests(): void {
  rateLimitStore.clear();
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  return request.headers.get('x-real-ip')?.trim() || '127.0.0.1';
}

/**
 * Defense-in-depth CSRF verification for state-changing BFF endpoints.
 * Requires both a custom X-Requested-With header (unreachable from plain HTML
 * forms) and a strict Origin-to-Host match.
 */
export function verifyCsrfRequest(request: Request): {
  ok: boolean;
  error?: string;
} {
  const requestedWith = request.headers.get('x-requested-with');
  if (requestedWith !== 'XMLHttpRequest') {
    return { ok: false, error: 'Missing required security header.' };
  }

  const origin = request.headers.get('origin');
  const expectedHost =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host');

  if (!origin || !expectedHost) {
    return { ok: false, error: 'Missing request origin metadata.' };
  }

  try {
    const originHost = new URL(origin).host;
    const normalizedExpectedHost = expectedHost.split(',')[0]?.trim();
    if (originHost !== normalizedExpectedHost) {
      return {
        ok: false,
        error: 'Cross-origin state-changing request rejected.',
      };
    }
  } catch {
    return { ok: false, error: 'Malformed request origin.' };
  }

  return { ok: true };
}

export function buildSecurityHeaders(isDev: boolean): Record<string, string> {
  const supabaseOrigins = getSupabaseCspOrigins().join(' ');

  // TODO(security): Migrate to per-request nonces once all pages are force-dynamic.
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  const cspDirectives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://unpkg.com",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigins} https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://nominatim.openstreetmap.org`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  return {
    'Content-Security-Policy': cspDirectives.join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Phase 2: geolocation=(self) allows the browser Geolocation API for the
    // signed-in origin. Camera and microphone remain blocked.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  };
}

/**
 * Server-side diagnostic logger that strips PII, tokens, SQL details, and
 * stack traces before logging. Never expose the output of this function to clients.
 */
export function logServerError(scope: string, err: unknown): void {
  if (process.env.NODE_ENV === 'test') return;
  const code =
    err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : 'INTERNAL_ERROR';
  // Only log the route scope and opaque error code — never log user inputs,
  // emails, coordinates, tokens, or raw SQL messages.
  console.error(`[server-error] scope=${scope} code=${code}`);
}

