import { redirect } from 'next/navigation';

/**
 * There is no marketing surface here — the root is just a door into the console.
 * Middleware bounces the request on to `/login` when there is no session.
 */
export default function Index() {
  redirect('/dashboard');
}
