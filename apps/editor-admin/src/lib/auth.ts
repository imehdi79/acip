import { cache } from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { readSessionUserId } from '@/lib/session';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

// cache() dedupes per request, not across them. A protected route asks for the
// session in its layout and again in its page; without this that is two cookie
// reads and two queries to render one screen.
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const userId = await readSessionUserId();
  if (!userId) {
    return null;
  }

  // Only the four SessionUser fields. passwordHash must never be selected —
  // a SessionUser is handed to page components and can end up serialised to
  // the client.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });

  // A signed, unexpired cookie can still name a user who has since been
  // deleted, so an absent row is a missing session rather than an error.
  return user;
});

export async function requireSession(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) {
    redirect('/login');
  }

  return user;
}
