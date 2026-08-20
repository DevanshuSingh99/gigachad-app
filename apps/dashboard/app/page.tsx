'use client';

import { Spinner } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useMe } from '@/lib/session';

/** Entry point: send people to the app or to sign-in based on the session cookie. */
export default function IndexPage() {
  const me = useMe();
  const router = useRouter();

  useEffect(() => {
    if (me.isPending) return;
    // Phase C moves this to the inbox, which is the application's real centre of
    // gravity; the team screen is the only authenticated screen that exists yet.
    router.replace(me.data ? '/members' : '/login');
  }, [me.isPending, me.data, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner aria-label="Loading" />
    </div>
  );
}
