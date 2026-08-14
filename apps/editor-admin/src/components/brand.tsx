import { cn } from '@heroui/react';

/**
 * The product mark on its own — a plan-view glyph, no photography, no gradient.
 * Sized by its container so the sidebar and the login card can differ.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground',
        className
      )}
    >
      <svg
        aria-hidden="true"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path d="M4 20V7l8-4 8 4v13" />
        <path d="M4 13h6" />
        <path d="M14 20v-7h6" />
      </svg>
    </span>
  );
}

/**
 * Mark + wordmark. Rendered on the login card and in the dashboard shell, which
 * is the whole reason it lives here rather than inline in either one.
 */
export function Brand({
  className,
  withWordmark = true,
}: {
  className?: string;
  /** @default true */
  withWordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark />
      {withWordmark ? (
        <span className="flex items-baseline gap-1.5">
          <span className="text-base font-semibold tracking-tight text-foreground">
            ACIP
          </span>
          <span className="text-xs font-medium tracking-wider text-muted uppercase">
            Admin
          </span>
        </span>
      ) : null}
    </span>
  );
}
