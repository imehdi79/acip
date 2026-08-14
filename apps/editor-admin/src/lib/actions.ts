'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { createSession, destroySession } from '@/lib/session';

export type LoginState = { error?: string };

// Every failure returns this, whatever went wrong. Telling someone that the
// password was the wrong part turns the login form into an account-existence
// oracle.
const GENERIC_ERROR = 'Invalid email or password';

// A real scrypt hash of a throwaway password, in the exact stored format.
// When no user matches, the password is verified against this anyway so the
// unknown-email path costs the same ~100ms as the wrong-password path and the
// two cannot be told apart by timing.
const DUMMY_HASH =
  'scrypt$2a040ec054220245ef3563b50806a7fe$db74935cbf23764b12a36fd39b702e61200c63ff44080b59b706c6fcbaf36dfc7c6dfc8ad33bbddd4fbbe76ccb706c39f63b5c663f9459d81bc268fd946ca3bc';

export async function loginAction(
  prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get('email');
  const password = formData.get('password');

  // FormData entries are string | File — a File here means a malformed post.
  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: GENERIC_ERROR };
  }

  const normalisedEmail = email.trim().toLowerCase();
  if (!normalisedEmail || !password) {
    return { error: GENERIC_ERROR };
  }

  // A database that is down is not a rejected credential, and saying
  // "invalid email or password" when the truth is "nothing is reachable"
  // sends whoever is debugging it in exactly the wrong direction. Only the
  // query is guarded — redirect() below must stay outside any try/catch.
  let user: { id: string; passwordHash: string } | null;
  try {
    user = await prisma.user.findUnique({
      where: { email: normalisedEmail },
      select: { id: true, passwordHash: true },
    });
  } catch (error) {
    console.error('[loginAction] user lookup failed', error);
    return { error: 'Could not reach the database. Try again in a moment.' };
  }

  const passwordMatches = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !passwordMatches) {
    return { error: GENERIC_ERROR };
  }

  await createSession(user.id);

  // redirect() signals by throwing. Inside a try/catch it would be caught and
  // reported as a failed login, so it stays last and uncaught.
  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await destroySession();

  redirect('/login');
}
