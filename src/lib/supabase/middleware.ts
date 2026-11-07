import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv, isSupabaseConfigured } from '@/lib/env';
import { buildSecurityHeaders } from '@/lib/security';

const PROTECTED_PREFIXES = ['/dashboard', '/account'];
const AUTH_PAGES = ['/login', '/signup'];

function applyResponseHeaders(
  response: NextResponse,
  pathname: string,
  isDev: boolean
): NextResponse {
  const securityHeaders = buildSecurityHeaders(isDev);
  for (const [header, value] of Object.entries(securityHeaders)) {
    response.headers.set(header, value);
  }

  const isSensitiveRoute =
    PROTECTED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    ) || pathname.startsWith('/api/');

  if (isSensitiveRoute) {
    response.headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, max-age=0'
    );
  }

  return response;
}

export async function updateSessionAndGuardRoutes(
  request: NextRequest
): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== 'production';
  const { pathname } = request.nextUrl;

  const isProtectedRoute = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (!isSupabaseConfigured()) {
    if (isProtectedRoute) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      return applyResponseHeaders(
        NextResponse.redirect(loginUrl),
        pathname,
        isDev
      );
    }

    return applyResponseHeaders(NextResponse.next({ request }), pathname, isDev);
  }

  let supabaseResponse = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();
  const isProd = process.env.NODE_ENV === 'production';

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[]
      ) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: 'lax',
            secure: isProd ? true : Boolean(options.secure),
            path: options.path ?? '/',
          });
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    const redirectResponse = NextResponse.redirect(loginUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set({
        ...cookie,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd ? true : Boolean(cookie.secure),
        path: cookie.path ?? '/',
      });
    });
    return applyResponseHeaders(redirectResponse, pathname, isDev);
  }

  // Redirect unverified users from protected routes to /verify-email
  if (user && isProtectedRoute && !user.email_confirmed_at) {
    const verifyUrl = request.nextUrl.clone();
    verifyUrl.pathname = '/verify-email';
    if (user.email) {
      verifyUrl.searchParams.set('email', user.email);
    }
    const redirectResponse = NextResponse.redirect(verifyUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set({
        ...cookie,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd ? true : Boolean(cookie.secure),
        path: cookie.path ?? '/',
      });
    });
    return applyResponseHeaders(redirectResponse, pathname, isDev);
  }

  if (user && user.email_confirmed_at && isAuthPage) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    const redirectResponse = NextResponse.redirect(dashboardUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set({
        ...cookie,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd ? true : Boolean(cookie.secure),
        path: cookie.path ?? '/',
      });
    });
    return applyResponseHeaders(redirectResponse, pathname, isDev);
  }

  return applyResponseHeaders(supabaseResponse, pathname, isDev);
}
