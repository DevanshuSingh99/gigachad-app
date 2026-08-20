'use client';

import { Button, Input } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthLayout } from '@/components/AuthLayout';
import { fieldError, formError, useSignup } from '@/lib/session';

export default function SignupPage() {
  const router = useRouter();
  const signup = useSignup();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    signup.mutate(form, { onSuccess: () => router.replace('/members') });
  };

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="You become its Admin. Nothing is pre-seeded."
      footer={
        <>
          Already have an account? <Link href="/login" className="text-primary">Sign in</Link>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Input label="Your name" autoComplete="name" value={form.name} onValueChange={set('name')} isRequired
          isInvalid={Boolean(fieldError(signup.error, 'name'))} errorMessage={fieldError(signup.error, 'name')} />
        <Input label="Work email" type="email" autoComplete="email" value={form.email} onValueChange={set('email')} isRequired
          isInvalid={Boolean(fieldError(signup.error, 'email'))} errorMessage={fieldError(signup.error, 'email')} />
        <Input label="Password" type="password" autoComplete="new-password" value={form.password} onValueChange={set('password')} isRequired
          description="At least 10 characters."
          isInvalid={Boolean(fieldError(signup.error, 'password'))} errorMessage={fieldError(signup.error, 'password')} />
        <Input label="Workspace name" value={form.workspaceName} onValueChange={set('workspaceName')} isRequired
          description="Becomes your support address and knowledge base address."
          isInvalid={Boolean(fieldError(signup.error, 'workspaceName'))} errorMessage={fieldError(signup.error, 'workspaceName')} />

        {formError(signup.error) ? (
          <p className="text-danger text-sm" role="alert">{formError(signup.error)}</p>
        ) : null}

        <Button type="submit" color="primary" isLoading={signup.isPending}>
          Create workspace
        </Button>
      </form>
    </AuthLayout>
  );
}
