import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { EditorSession } from '@acip/editor-core';
import { setupAutosave } from './files';

const SessionContext = createContext<EditorSession | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => {
    const s = new EditorSession();
    setupAutosave(s);
    return s;
  });
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): EditorSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
