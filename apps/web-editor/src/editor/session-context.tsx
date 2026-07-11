import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { EditorSession } from '@acip/editor-core';

const SessionContext = createContext<EditorSession | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new EditorSession());
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): EditorSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
