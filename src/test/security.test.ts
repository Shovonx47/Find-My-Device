import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSecurityHeaders,
  checkRateLimit,
  resetRateLimitStoreForTests,
  verifyCsrfRequest,
} from '@/lib/security';

describe('BFF Security Guards (CSRF, Rate Limiting, Headers)', () => {
  beforeEach(() => {
    resetRateLimitStoreForTests();
  });

  it('rejects state-changing requests missing X-Requested-With header', () => {
    const req = new Request('https://app.example.com/api/connections', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        Host: 'app.example.com',
      },
    });
    expect(verifyCsrfRequest(req).ok).toBe(false);
  });

  it('rejects cross-origin CSRF attempts when Origin does not match Host', () => {
    const req = new Request('https://app.example.com/api/connections', {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://evil.example.org',
        Host: 'app.example.com',
      },
    });
    expect(verifyCsrfRequest(req)).toEqual({
      ok: false,
      error: 'Cross-origin state-changing request rejected.',
    });
  });

  it('accepts valid same-origin requests including Vercel x-forwarded-host', () => {
    const req = new Request('https://my-app.vercel.app/api/connections', {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://my-app.vercel.app',
        'x-forwarded-host': 'my-app.vercel.app',
        Host: 'internal.vercel.infra',
      },
    });
    expect(verifyCsrfRequest(req)).toEqual({ ok: true });
  });

  it('enforces per-key rate limits within window', () => {
    expect(checkRateLimit('ip:1', 2, 60_000).allowed).toBe(true);
    expect(checkRateLimit('ip:1', 2, 60_000).allowed).toBe(true);
    const blocked = checkRateLimit('ip:1', 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('generates hardened production CSP with Supabase origins and updated Permissions-Policy', () => {
    // With no NEXT_PUBLIC_SUPABASE_URL set, falls back to wildcard origins
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const headers = buildSecurityHeaders(false);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    // Phase 2: geolocation=(self) allows the browser Geolocation API
    expect(headers['Permissions-Policy']).toContain('geolocation=(self)');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Content-Security-Policy']).toContain("connect-src 'self'");
    expect(headers['Content-Security-Policy']).not.toContain("'unsafe-eval'");
    vi.unstubAllEnvs();
  });
});
