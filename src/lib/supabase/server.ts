import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseEnv } from '@/lib/env';

export function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = cookies();
  const isProd = process.env.NODE_ENV === 'production';

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              secure: isProd ? true : Boolean(options.secure),
              path: options.path ?? '/',
            });
          });
        } catch {
          // Called from a Server Component render where cookies cannot be mutated directly;
          // session token refresh is persisted by src/middleware.ts on every request.
        }
      },
    },
  });
}
