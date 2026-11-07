import { type NextRequest } from 'next/server';
import { updateSessionAndGuardRoutes } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSessionAndGuardRoutes(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and image optimization assets.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

