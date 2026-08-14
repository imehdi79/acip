'use client';

import { Alert, Button, Card, Input, Label, Spinner, TextField } from '@heroui/react';
import { useActionState } from 'react';

import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { loginAction, type LoginState } from '@/lib/actions';

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    loginAction,
    {}
  );

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <ThemeToggle className="absolute end-4 top-4" />

      <div className="w-full max-w-sm">
        <Card className="gap-6 p-6 sm:p-7">
          <Card.Header className="gap-5">
            <Brand />
            <div className="flex flex-col gap-1">
              <Card.Title
                className="text-lg leading-7 font-semibold"
                render={(props) => <h1 {...props} />}
              >
                Sign in
              </Card.Title>
              <Card.Description>
                Administrator access to the ACIP editor console.
              </Card.Description>
            </div>
          </Card.Header>

          <Card.Content>
            <form action={formAction} className="flex flex-col gap-4">
              <TextField
                autoComplete="email"
                fullWidth
                isDisabled={isPending}
                isRequired
                name="email"
                type="email"
              >
                <Label>Email</Label>
                <Input autoFocus placeholder="you@example.com" />
              </TextField>

              <TextField
                autoComplete="current-password"
                fullWidth
                isDisabled={isPending}
                isRequired
                name="password"
                type="password"
              >
                <Label>Password</Label>
                <Input placeholder="••••••••" />
              </TextField>

              {/* Always in the tree so the alert lands in a live region that
                  assistive tech is already watching. */}
              <div aria-live="assertive" className="empty:hidden" role="alert">
                {state.error ? (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Could not sign you in</Alert.Title>
                      <Alert.Description>{state.error}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
              </div>

              <Button
                className="mt-1"
                fullWidth
                isDisabled={isPending}
                type="submit"
                variant="primary"
              >
                {isPending ? <Spinner color="current" size="sm" /> : null}
                {isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </Card.Content>

          {/* Convenience for local work only. NODE_ENV is inlined at build
              time, so a production bundle does not contain the credentials at
              all — printing working admin credentials on a public sign-in page
              would hand them to everyone who loads it. */}
          {process.env.NODE_ENV === 'production' ? null : (
            <Card.Footer className="flex-col items-start gap-1.5 border-t border-separator pt-4">
              <p className="text-xs font-medium text-muted">
                Development seed account
              </p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <code className="rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-foreground">
                  admin@acip.local
                </code>
                <span aria-hidden="true">/</span>
                <code className="rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-foreground">
                  admin1234
                </code>
              </p>
            </Card.Footer>
          )}
        </Card>
      </div>
    </main>
  );
}
