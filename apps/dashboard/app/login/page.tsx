'use client';

import { Button, Input } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthLayout } from '@/components/AuthLayout';
import { fieldError, formError, useLogin } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => router.replace('/members') });
  };

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          No account? <Link href="/signup" className="text-primary">Create one</Link>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onValueChange={setEmail}
          isRequired
          isInvalid={Boolean(fieldError(login.error, 'email'))}
          errorMessage={fieldError(login.error, 'email')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onValueChange={setPassword}
          isRequired
          isInvalid={Boolean(fieldError(login.error, 'password'))}
          errorMessage={fieldError(login.error, 'password')}
        />

        {/* One message for both unknown email and wrong password: the server
            returns the same error for each, and repeating it verbatim keeps the
            UI from reconstructing the distinction the API refuses to make. */}
        {formError(login.error) ? (
          <p className="text-danger text-sm" role="alert">
            {formError(login.error)}
          </p>
        ) : null}

        <Button type="submit" color="primary" isLoading={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
