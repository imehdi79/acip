import { NextResponse, type NextRequest } from 'next/server';

// Next 16 renamed this file convention from `middleware` to `proxy`; the
// runtime still resolves `proxy ?? middleware ?? default`, but the old name
// warns on every build.

// Kept in step by hand with SESSION_COOKIE in src/lib/session.ts. It is not
// imported from there because that module pulls in node:crypto and
// next/headers, and this file runs on the edge runtime where neither exists.
const SESSION_COOKIE = 'editor_admin_session';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Presence only, never verification. The edge runtime has no node:crypto, so
  // the HMAC cannot be checked here. This is navigation, not a lock — the real
  // check is requireSession() on the Node runtime, and every protected page
  // must still call it.
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  if (!hasSessionCookie && pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's internals, the API routes, and anything with a
  // file extension (favicon, images, fonts). The `(?:/|$)` matches whole path
  // segments, so a future /api-docs page is still covered.
  matcher: ['/((?!api(?:/|$)|_next(?:/|$)|.*\\.[^/]+$).*)'],
};
