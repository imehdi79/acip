import { Card } from '@heroui/react';
import type { Metadata } from 'next';

import { StatCard } from '@/components/stat-card';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const metadata: Metadata = { title: 'Overview' };

/**
 * Counts are read per request, and the build machine has no database — never
 * prerender this at build time.
 */
export const dynamic = 'force-dynamic';

type Accounts = {
  total: number;
  newest: Date | null;
};

async function readAccounts(): Promise<Accounts | null> {
  try {
    const [total, newest] = await Promise.all([
      prisma.user.count(),
      prisma.user.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return { total, newest: newest?.createdAt ?? null };
  } catch (error) {
    // A console that renders "Unavailable" beats a 500 when the database is
    // simply not up yet.
    console.error('[dashboard] could not read accounts', error);
    return null;
  }
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

export default async function DashboardPage() {
  const [user, accounts] = await Promise.all([requireSession(), readAccounts()]);
  const firstName = user.name?.trim().split(/\s+/)[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-tight text-foreground">
          Welcome back{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-muted">
          Accounts and access for the ACIP editor.
        </p>
      </header>

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2
          className="text-xs font-medium tracking-wider text-muted uppercase"
          id="stats-heading"
        >
          At a glance
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            hint="Rows in the users table"
            label="Admin accounts"
            value={accounts ? accounts.total : '—'}
          />
          <StatCard
            hint="Most recent account created"
            label="Newest account"
            value={
              accounts?.newest ? DATE_FORMAT.format(accounts.newest) : '—'
            }
          />
          <StatCard
            hint="editor_admin on Postgres"
            label="Database"
            value={
              <span className={accounts ? 'text-success' : 'text-danger'}>
                {accounts ? 'Connected' : 'Unavailable'}
              </span>
            }
          />
          <StatCard
            hint="No session store to count yet"
            isPlaceholder
            label="Active sessions"
            value="—"
          />
        </div>
      </section>

      <section aria-labelledby="account-heading" className="flex flex-col gap-3">
        <h2
          className="text-xs font-medium tracking-wider text-muted uppercase"
          id="account-heading"
        >
          Your account
        </h2>
        <Card>
          <Card.Content>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name" value={user.name?.trim() || 'Not set'} />
              <Field label="Email" value={user.email} />
              <Field className="capitalize" label="Role" value={user.role} />
              <Field className="font-mono text-xs" label="User ID" value={user.id} />
            </dl>
          </Card.Content>
        </Card>
      </section>
    </div>
  );
}

function Field({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium tracking-wider text-muted uppercase">
        {label}
      </dt>
      <dd className={`truncate text-sm text-foreground ${className ?? ''}`}>
        {value}
      </dd>
    </div>
  );
}
