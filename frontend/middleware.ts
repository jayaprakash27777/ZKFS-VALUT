/**
 * middleware.ts
 *
 * Next.js Edge Middleware — Route Guard
 * =====================================
 * Protects /dashboard/* routes.
 * If no access token is found in cookies or localStorage-derived headers,
 * redirects to /login.
 *
 * NOTE: localStorage is not accessible in Edge runtime.
 * The auth flow stores the JWT in localStorage (client-side). To protect
 * routes server-side we check for a cookie named `zkfs_access_token`
 * which the login page sets simultaneously with localStorage.
 *
 * If your auth API only supports Authorization headers, keep this middleware
 * as a soft guard — the API client in the browser will handle 401s.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PATHS = ['/dashboard'];
const AUTH_COOKIE     = 'zkfs_access_token';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PATHS.some(p => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // Check for auth cookie (set by login page alongside localStorage)
  const token = request.cookies.get(AUTH_COOKIE)?.value;

  if (!token) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
