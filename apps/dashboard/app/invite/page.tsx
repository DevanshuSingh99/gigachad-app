'use client';

import { Button, Chip, Input, Spinner } from '@heroui/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { AuthLayout } from '@/components/AuthLayout';
import { ApiError } from '@/lib/api';
import {
  fieldError,
  formError,
  useAcceptInvitation,
  useInvitationPreview,
  useMe,
} from '@/lib/session';

/**
 * Invitation acceptance.
 *
 * The token is a query parameter rather than a path segment because a static
 * export cannot serve an arbitrary dynamic path. The email is never collected
 * here: it comes from the invitation record, so this screen cannot be used to
 * accept someone else's invitation.
 */
function InviteScreen() {
  const params = useSearchParams();
  const token = params.get('token');
  const router = useRouter();
  const me = useMe();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation(token);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  if (!token) {
    return (
      <AuthLayout title="Invitation link is incomplete">
        <p className="text-default-500 text-sm">
          This link is missing its token. Ask an Admin to send you a new invitation.
        </p>
      </AuthLayout>
    );
  }

  if (preview.isPending) {
    return (
      <AuthLayout title="Checking your invitation">
        <div className="flex justify-center py-4">
          <Spinner aria-label="Checking invitation" />
        </div>
      </AuthLayout>
    );
  }

  if (preview.isError) {
    const error = preview.error;
    return (
      <AuthLayout title="This invitation cannot be used">
        <p className="text-default-500 text-sm">
          {error instanceof ApiError ? error.message : 'The invitation could not be loaded.'}
        </p>
        {error instanceof ApiError && error.requestId ? (
          <p className="text-default-400 text-xs">Request ID {error.requestId}</p>
        ) : null}
      </AuthLayout>
    );
  }

  const invitation = preview.data;
  // Signed in as the invited person: nothing left to collect but consent.
  const signedInAsInvitee = me.data?.user.email === invitation.email;

  return (
    <AuthLayout
      title={`Join ${invitation.workspaceName}`}
      subtitle={
        <>
          Invited as <Chip size="sm" variant="flat">{invitation.role === 'ADMIN' ? 'Admin' : 'Agent'}</Chip>{' '}
          for <span className="font-medium">{invitation.email}</span>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          accept.mutate(
            signedInAsInvitee ? {} : { name, password },
            { onSuccess: () => router.replace('/members') },
          );
        }}
      >
        {signedInAsInvitee ? (
          <p className="text-default-500 text-sm">
            You are signed in as {invitation.email}. Accept to join the workspace.
          </p>
        ) : (
          <>
            <Input label="Your name" autoComplete="name" value={name} onValueChange={setName}
              description="Skip if you already have an account — just enter your password."
              isInvalid={Boolean(fieldError(accept.error, 'name'))}
              errorMessage={fieldError(accept.error, 'name')} />
            <Input label="Password" type="password" autoComplete="current-password" value={password}
              onValueChange={setPassword}
              isInvalid={Boolean(fieldError(accept.error, 'password'))}
              errorMessage={fieldError(accept.error, 'password')} />
          </>
        )}

        {formError(accept.error) ? (
          <p className="text-danger text-sm" role="alert">{formError(accept.error)}</p>
        ) : null}

        <Button type="submit" color="primary" isLoading={accept.isPending}>
          Accept invitation
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function InvitePage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <Spinner aria-label="Loading" />
        </div>
      }
    >
      <InviteScreen />
    </Suspense>
  );
}
