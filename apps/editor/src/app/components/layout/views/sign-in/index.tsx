import { FormEvent, useState } from 'react';
import { Button, FieldError, Input, Label, TextField } from '@heroui/react';

export type SignInCredentials = {
  email: string;
  password: string;
};

type SignInProps = {
  /** Parent owns the actual auth call; throwing rejects the form back to the user. */
  onSignIn: (credentials: SignInCredentials) => void | Promise<void>;
  /** Signed-out is a valid state here — let people straight through to a plan. */
  onGuest: () => void;
};

/** Which slot the current error belongs to; 'form' is a failed submit. */
type ErrorField = 'email' | 'password' | 'form';

type FieldIssue = {
  field: ErrorField;
  message: string;
};

/** Deliberately loose: only catches the obviously-not-an-email cases. */
const looksLikeEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value);

const validate = (email: string, password: string): FieldIssue | null => {
  if (!email.trim()) {
    return { field: 'email', message: 'Enter your email address.' };
  }

  if (!looksLikeEmail(email.trim())) {
    return {
      field: 'email',
      message: 'That does not look like an email address.',
    };
  }

  if (!password) {
    return { field: 'password', message: 'Enter your password.' };
  }

  return null;
};

const SignIn = ({ onSignIn, onGuest }: SignInProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [issue, setIssue] = useState<FieldIssue | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isPending) return;

    const nextIssue = validate(email, password);
    setIssue(nextIssue);

    if (nextIssue) return;

    setIsPending(true);

    try {
      await onSignIn({ email: email.trim(), password });
    } catch {
      setIssue({
        field: 'form',
        message: 'Could not sign you in. Check your details and try again.',
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex min-h-dvh w-full flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold leading-tight text-foreground">
        Sign in
      </h1>
      <p className="mt-1 text-sm text-muted">
        Draw a plan and watch what it costs, as you go.
      </p>

      {/* noValidate: our own messages, not the browser's native bubbles. */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-6 flex flex-col gap-4"
      >
        <TextField
          fullWidth
          isRequired
          type="email"
          name="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          inputMode="email"
          isInvalid={issue?.field === 'email'}
          isDisabled={isPending}
        >
          <Label>Email</Label>
          <Input placeholder="you@example.com" />
          <FieldError>
            {issue?.field === 'email' ? issue.message : null}
          </FieldError>
        </TextField>

        <TextField
          fullWidth
          isRequired
          type="password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          isInvalid={issue?.field === 'password'}
          isDisabled={isPending}
        >
          <Label>Password</Label>
          <Input placeholder="Your password" />
          <FieldError>
            {issue?.field === 'password' ? issue.message : null}
          </FieldError>
        </TextField>

        {issue?.field === 'form' && (
          <p role="alert" className="px-1 text-xs text-danger">
            {issue.message}
          </p>
        )}

        <Button type="submit" fullWidth isPending={isPending} className="mt-2">
          {isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <Button
        type="button"
        variant="ghost"
        fullWidth
        isDisabled={isPending}
        onPress={onGuest}
        className="mt-3"
      >
        Continue as guest
      </Button>
    </div>
  );
};

export default SignIn;
