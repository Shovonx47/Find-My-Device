import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { updateSessionAndGuardRoutes } from '@/lib/supabase/middleware';

describe('Protected Route Middleware', () => {
  it('redirects unauthenticated /dashboard requests to /login with security headers', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');

    const request = new NextRequest('http://localhost:3000/dashboard');
    const response = await updateSessionAndGuardRoutes(request);

    expect(response.status).toBe(307);
    // Just check path, not full origin (varies by test environment)
    expect(response.headers.get('location')).toContain('/login');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cache-Control')).toContain('no-store');

    vi.unstubAllEnvs();
  });

  it('redirects unauthenticated /account requests to /login', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');

    const request = new NextRequest('http://localhost:3000/account');
    const response = await updateSessionAndGuardRoutes(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');

    vi.unstubAllEnvs();
  });
});
