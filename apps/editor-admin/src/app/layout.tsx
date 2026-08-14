import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './global.css';

export const metadata: Metadata = {
  title: {
    default: 'ACIP Admin',
    template: '%s · ACIP Admin',
  },
  description: 'Administration console for the ACIP editor.',
};

/**
 * HeroUI's theme variables only switch on `.dark` / `[data-theme="dark"]` — there
 * is no `prefers-color-scheme` fallback for them — so without this a dark-mode
 * visitor gets a white page. It runs before first paint, and deliberately writes
 * only the attribute: `useTheme` remembers the *class* it applied itself, so a
 * `dark` class it did not add would survive the next toggle and win over `light`.
 */
const THEME_INIT = `try{var s=localStorage.getItem('heroui-theme')||'system';var r=s==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s;document.documentElement.setAttribute('data-theme',r)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
