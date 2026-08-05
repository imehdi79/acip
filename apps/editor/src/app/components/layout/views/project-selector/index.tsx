import { ReactNode, useId } from 'react';
import { Card, cn, ListBox, ScrollShadow } from '@heroui/react';
import { IconChevronRight } from '@tabler/icons-react';
import { useSettingsStore } from '@/app/stores/global/settings.store';

type Project = {
  id: string;
  title: string;
  component: ReactNode;
};

/** Plan thumbnail: graph-paper board, walls as strokes, floor as a faint fill. */
const Plan = ({ children }: { children: ReactNode }) => {
  const gridId = useId();

  return (
    <svg
      viewBox="0 0 120 80"
      className="h-full w-full text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth={5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={gridId}
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
        >
          <path d="M10 0H0v10" strokeWidth={0.5} strokeOpacity={0.25} />
        </pattern>
      </defs>
      <rect width="120" height="80" fill={`url(#${gridId})`} stroke="none" />
      {children}
    </svg>
  );
};

/** Floor slab: filled, never stroked — walls are drawn separately. */
const floor = { fill: 'currentColor', fillOpacity: 0.08, stroke: 'none' };

/** Door swings and other trim sit lighter than the walls. */
const trim = { strokeWidth: 2.5, strokeOpacity: 0.65 };

const projects: Project[] = [
  {
    id: 'p11',
    title: 'Blank',
    component: (
      <Plan>
        <rect
          x="22"
          y="12"
          width="76"
          height="56"
          rx="6"
          strokeDasharray="9 10"
          strokeOpacity={0.7}
        />
        <path d="M60 30v20M50 40h20" strokeWidth={4} />
      </Plan>
    ),
  },
  {
    id: 'p1',
    title: 'Free Draw',
    component: (
      <Plan>
        {/* an outline mid-draw: solid so far, dashed where it is still headed */}
        <path d="M22 62V22h44v22" />
        <path d="M66 44h32v18H80" strokeDasharray="7 8" strokeOpacity={0.7} />
        {/* drafting handles on the vertices already placed */}
        <g fill="currentColor" stroke="none">
          <circle cx="22" cy="62" r="3.5" />
          <circle cx="22" cy="22" r="3.5" />
          <circle cx="66" cy="22" r="3.5" />
          <circle cx="66" cy="44" r="3.5" />
        </g>
      </Plan>
    ),
  },
  {
    id: 'p2',
    title: 'Square Room',
    component: (
      <Plan>
        <rect x="36" y="10" width="48" height="48" rx="2" {...floor} />
        <path d="M52 58H36V10h48v48H68" />
        <path d="M52 58v-16a16 16 0 0 1 16 16" {...trim} />
      </Plan>
    ),
  },
  {
    id: 'p3',
    title: 'Rectangular Room',
    component: (
      <Plan>
        <rect x="16" y="18" width="88" height="40" rx="2" {...floor} />
        <path d="M34 58H16V18h88v40H50" />
        <path d="M34 58v-16a16 16 0 0 1 16 16" {...trim} />
      </Plan>
    ),
  },
  {
    id: 'p4',
    title: 'L-Shape Room',
    component: (
      <Plan>
        <path d="M22 10h44v28h32v28H22z" {...floor} />
        <path d="M46 66H22V10h44v28h32v28H62" />
        <path d="M46 66v-16a16 16 0 0 1 16 16" {...trim} />
      </Plan>
    ),
  },
  {
    id: 'p5',
    title: 'Two Room',
    component: (
      <Plan>
        <rect x="16" y="14" width="88" height="48" rx="2" {...floor} />
        <path d="M16 14h88v48H16z" />
        {/* divider, broken for the door between the two rooms */}
        <path d="M58 14v16M58 46v16" />
        <path d="M58 30h16a16 16 0 0 1-16 16" {...trim} />
      </Plan>
    ),
  },
];

const recentProjects = Array.from({ length: 0 }, (_, index) => ({
  id: `project-${index + 1}`,
  title: `Project ${index + 1}`,
}));

type TemplateCardProps = {
  project: Project;
  onSelect: (id: string) => void;
  /** Compact tiles fill a grid cell; the wide variant rides the carousel. */
  compact?: boolean;
};

const TemplateCard = ({ project, onSelect, compact }: TemplateCardProps) => (
  <Card
    variant="default"
    role="button"
    tabIndex={0}
    onClick={() => onSelect(project.id)}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(project.id);
      }
    }}
    className={cn(
      'relative cursor-pointer overflow-hidden rounded-2xl border',
      'outline-none transition-transform duration-150 active:scale-[0.97]',
      compact ? 'aspect-[4/3] w-full' : 'h-48 w-80 shrink-0 snap-center',
    )}
  >
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center',
        compact ? 'px-5 pb-9 pt-4' : 'px-8 pb-12 pt-6',
      )}
    >
      {project.component}
    </div>
    <span
      className={cn(
        'absolute font-semibold leading-tight',
        compact ? 'bottom-3 left-3 text-sm' : 'bottom-4 left-4 text-base',
      )}
    >
      {project.title}
    </span>
  </Card>
);

const ProjectSelector = () => {
  const setView = useSettingsStore((state) => state.setView);

  const handleSelect = (id: string) => {
    console.log({ id });
    setView('editor');
  };

  const hasRecentProjects = recentProjects.length > 0;

  // Nothing to come back to: give the templates the whole screen as a grid so
  // every option is visible at once instead of a long stack to scroll through.
  if (!hasRecentProjects) {
    return (
      <div className="mt-14 h-[calc(100dvh-3.5rem)] min-h-0 w-full overflow-y-auto">
        <div className="px-4 pb-8 pt-6">
          <h1 className="text-2xl font-semibold leading-tight text-foreground">
            Start a new plan
          </h1>
          <p className="mt-1 text-sm text-muted">
            Pick a room to start from, or draw your own.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {projects.map((project) => (
              <TemplateCard
                key={project.id}
                project={project}
                onSelect={handleSelect}
                compact
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-14 flex h-[calc(100dvh-3.5rem)] min-h-0 w-full flex-col overflow-hidden">
      {/* Project templates */}
      <ScrollShadow
        orientation="horizontal"
        hideScrollBar
        className="w-full shrink-0"
      >
        <div className="flex snap-x snap-mandatory gap-3 px-4 py-4">
          {projects.map((project) => (
            <TemplateCard
              key={project.id}
              project={project}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </ScrollShadow>

      {/* Recent projects */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <h2 className="shrink-0 px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Recent
        </h2>
        <ScrollShadow
          orientation="vertical"
          size={24}
          className="min-h-0 w-full flex-1 overflow-y-auto"
        >
          <ListBox
            aria-label="Recent projects"
            selectionMode="single"
            onSelectionChange={(keys) => {
              if (keys === 'all') return;

              const [first] = [...keys];

              if (first != null) {
                console.log(String(first));
              }
            }}
            className="gap-1 p-2"
          >
            {recentProjects.map((project) => (
              <ListBox.Item
                key={project.id}
                id={project.id}
                textValue={project.title}
                className="rounded-xl px-2 py-2"
              >
                <div className="flex w-full min-w-0 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {project.title}
                    </p>
                  </div>

                  <IconChevronRight
                    className="size-4 shrink-0 text-muted"
                    stroke={2}
                  />
                </div>
              </ListBox.Item>
            ))}
          </ListBox>
        </ScrollShadow>
      </div>
    </div>
  );
};

export default ProjectSelector;
