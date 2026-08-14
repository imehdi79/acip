import { Avatar, Button, Chip, Separator } from '@heroui/react';
import type { ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { MainNav } from '@/components/main-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { logoutAction } from '@/lib/actions';
import { requireSession } from '@/lib/auth';

/** "Ada Lovelace" -> "AL", "admin@acip.local" -> "AD". */
function initialsOf(name: string | null, email: string) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase();
  }

  return email.slice(0, 2).toUpperCase();
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireSession();
  const displayName = user.name?.trim() || user.email;

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-7 border-e border-separator bg-surface px-4 py-6 lg:flex">
        <Brand className="px-2" />
        <MainNav className="flex-col" />
        <p className="mt-auto px-2 text-xs text-muted">
          Signed in to the editor console
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex flex-col gap-2 border-b border-separator bg-background/85 px-4 py-3 backdrop-blur-sm sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Brand className="lg:hidden" withWordmark={false} />

            <div className="ms-auto flex items-center gap-2 sm:gap-3">
              <ThemeToggle />

              <Separator
                className="hidden h-6 sm:block"
                orientation="vertical"
              />

              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar color="accent" size="sm">
                  <Avatar.Fallback className="bg-accent-soft">
                    {initialsOf(user.name, user.email)}
                  </Avatar.Fallback>
                </Avatar>
                <div className="hidden min-w-0 flex-col leading-tight sm:flex">
                  <span className="truncate text-sm font-medium text-foreground">
                    {displayName}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {user.email}
                  </span>
                </div>
                <Chip
                  className="hidden capitalize md:inline-flex"
                  color="accent"
                  size="sm"
                  variant="soft"
                >
                  {user.role}
                </Chip>
              </div>

              <form action={logoutAction}>
                <Button size="sm" type="submit" variant="outline">
                  Sign out
                </Button>
              </form>
            </div>
          </div>

          <MainNav className="-mx-1 overflow-x-auto px-1 pb-0.5 lg:hidden" />
        </header>

        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
