import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'editor_admin_session';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_AGE_MS = MAX_AGE_SECONDS * 1000;

// The cookie carries `<userId>.<expiryEpochMs>.<signatureHex>`. Everything up
// to the last dot is the signed payload, so a userId containing a dot would
// still round-trip.
const SEPARATOR = '.';

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Deliberately fatal. A fallback default secret is a forgeable session
    // cookie in production, and it would be found only after it was abused.
    throw new Error(
      'AUTH_SECRET is not set. Set it in the environment before signing sessions.',
    );
  }

  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', authSecret()).update(payload).digest('hex');
}

export async function createSession(userId: string): Promise<void> {
  const expiresAt = Date.now() + MAX_AGE_MS;
  const payload = `${userId}${SEPARATOR}${expiresAt}`;

  // Next 16: cookies() is async.
  const store = await cookies();
  store.set(SESSION_COOKIE, `${payload}${SEPARATOR}${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) {
    return null;
  }

  const signatureAt = raw.lastIndexOf(SEPARATOR);
  if (signatureAt === -1) {
    return null;
  }

  const payload = raw.slice(0, signatureAt);
  const signature = Buffer.from(raw.slice(signatureAt + 1), 'hex');
  const expected = Buffer.from(sign(payload), 'hex');

  // Length is checked first because timingSafeEqual throws when the two
  // buffers differ in size.
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return null;
  }

  const expiryAt = payload.lastIndexOf(SEPARATOR);
  if (expiryAt === -1) {
    return null;
  }

  const userId = payload.slice(0, expiryAt);
  const expiresAt = Number(payload.slice(expiryAt + 1));
  if (!userId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return null;
  }

  return userId;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
