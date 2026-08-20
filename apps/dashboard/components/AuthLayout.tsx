import { Card, CardBody, CardHeader } from '@heroui/react';

/** Shared frame for the signed-out screens: signup, login, invitation accept. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
      <div className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight">Gigachad</h1>
      </div>
      <Card shadow="none" className="shadow-card">
        <CardHeader className="flex flex-col items-start gap-1 pb-0">
          <h2 className="text-lg font-medium">{title}</h2>
          {subtitle ? (
            // A div, not a <p>: callers (the invite screen) pass a Chip, which
            // renders a <div> — nesting block content in a <p> is invalid HTML
            // and triggers a hydration mismatch.
            <div className="text-default-500 text-sm">{subtitle}</div>
          ) : null}
        </CardHeader>
        <CardBody className="gap-3">{children}</CardBody>
      </Card>
      {footer ? <div className="text-default-500 px-1 text-center text-sm">{footer}</div> : null}
    </main>
  );
}
