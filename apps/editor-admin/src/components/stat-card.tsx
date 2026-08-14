import { Card, Chip } from '@heroui/react';
import type { ReactNode } from 'react';

export type StatCardProps = {
  /** Small caps label above the figure. */
  label: string;
  value: ReactNode;
  /** One line of provenance — where the figure comes from. */
  hint?: string;
  /**
   * Marks the figure as not-yet-wired. It is rendered with a visible badge so a
   * stand-in is never mistaken for a measurement.
   */
  isPlaceholder?: boolean;
};

export function StatCard({
  hint,
  isPlaceholder = false,
  label,
  value,
}: StatCardProps) {
  return (
    <Card className="gap-2">
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Title className="text-xs font-medium tracking-wider text-muted uppercase">
          {label}
        </Card.Title>
        {isPlaceholder ? (
          <Chip color="warning" size="sm" variant="soft">
            Placeholder
          </Chip>
        ) : null}
      </Card.Header>
      <Card.Content>
        <p className="text-3xl leading-9 font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </p>
      </Card.Content>
      {hint ? (
        <Card.Footer>
          <Card.Description className="text-xs">{hint}</Card.Description>
        </Card.Footer>
      ) : null}
    </Card>
  );
}
