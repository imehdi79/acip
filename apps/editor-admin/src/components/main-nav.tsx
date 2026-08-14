'use client';

import { Chip, cn } from '@heroui/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Sections without a route yet are shown, but never as a link to a 404. */
  isReady: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: <OverviewIcon />, isReady: true },
  { href: '/dashboard/users', label: 'Users', icon: <UsersIcon />, isReady: false },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: <SettingsIcon />,
    isReady: false,
  },
];

const ITEM_BASE =
  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none';

/**
 * Uses `next/link` rather than HeroUI's `Link`: the HeroUI/react-aria one needs a
 * `RouterProvider` to do client-side navigation, which is a lot of wiring for a
 * three-item nav.
 */
export function MainNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className={cn('flex gap-1', className)}>
      {NAV_ITEMS.map((item) => {
        if (!item.isReady) {
          return (
            <span
              aria-disabled="true"
              className={cn(ITEM_BASE, 'cursor-default text-muted opacity-70')}
              key={item.href}
            >
              {item.icon}
              {item.label}
              <Chip size="sm" variant="soft">
                Soon
              </Chip>
            </span>
          );
        }

        const isActive = pathname === item.href;

        return (
          <Link
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              ITEM_BASE,
              'focus-visible:focus-ring',
              isActive
                ? 'bg-accent-soft text-accent-soft-foreground'
                : 'text-muted hover:bg-surface-secondary hover:text-foreground'
            )}
            href={item.href}
            key={item.href}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

const ICON_PROPS = {
  'aria-hidden': true,
  className: 'size-4 shrink-0',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: 2,
  viewBox: '0 0 24 24',
} as const;

function OverviewIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect height="7" rx="1.5" width="7" x="3" y="3" />
      <rect height="7" rx="1.5" width="7" x="14" y="3" />
      <rect height="7" rx="1.5" width="7" x="3" y="14" />
      <rect height="7" rx="1.5" width="7" x="14" y="14" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16.5 5.3a3.5 3.5 0 0 1 0 6.4M18 15a6 6 0 0 1 3 5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}
