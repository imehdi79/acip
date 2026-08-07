import { createContext, useContext } from 'react';
import { EditorSession } from '@acip/editor-core';

/**
 * Supplied by <EditorProvider>, which sits above the whole signed-in shell so
 * chrome outside the viewport (the footer) can read the session too.
 */
export const SessionContext = createContext<EditorSession | null>(null);

export function useSession(): EditorSession {
  const session = useContext(SessionContext);
  if (!session)
    throw new Error('useSession must be used inside <EditorProvider>');
  return session;
}
