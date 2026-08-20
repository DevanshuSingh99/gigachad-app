'use client';

import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
  Skeleton,
  Snippet,
  Spinner,
  useDisclosure,
} from '@heroui/react';
import type { DomainDto } from '@gigachad/shared';
import { Suspense, useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { useAddDomain, useDeleteDomain, useDomains, useVerifyDomain } from '@/lib/domains';
import { useActiveWorkspace } from '@/lib/session';

const STATUS_COLOR = {
  PENDING: 'warning',
  VERIFIED: 'success',
  ERROR: 'danger',
} as const;

const STATUS_LABEL = {
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  ERROR: 'Error',
} as const;

function DomainCard({ domain }: { domain: DomainDto }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const verify = useVerifyDomain(workspaceId);
  const remove = useDeleteDomain(workspaceId);

  return (
    <div className="border-divider rounded-large border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
          {domain.hostname}
        </span>
        <Chip size="sm" color={STATUS_COLOR[domain.status]} variant="flat">
          {STATUS_LABEL[domain.status]}
        </Chip>
        <Button
          size="sm"
          variant="flat"
          isLoading={verify.isPending}
          onPress={() => verify.mutate(domain.id)}
        >
          Verify
        </Button>
        <Button
          size="sm"
          variant="light"
          color="danger"
          isLoading={remove.isPending}
          onPress={() => remove.mutate(domain.id)}
        >
          Remove
        </Button>
      </div>

      {domain.status === 'ERROR' && domain.errorCode ? (
        <p className="text-danger mb-3 text-xs">{domain.errorCode}</p>
      ) : null}

      {domain.status !== 'VERIFIED' ? (
        <div className="space-y-3">
          <p className="text-default-500 text-xs font-medium uppercase tracking-wide">
            Required DNS records
          </p>

          <div className="space-y-1">
            <p className="text-default-500 text-xs">
              1. CNAME — point <code className="text-foreground">{domain.hostname}</code> at:
            </p>
            <Snippet size="sm" symbol="" classNames={{ base: 'w-full' }}>
              {domain.cnameTarget}
            </Snippet>
            <p className="text-warning text-xs">
              Use DNS-only (grey cloud) in Cloudflare — proxied CNAMEs block TLS issuance.
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-default-500 text-xs">
              2. TXT — add a record at{' '}
              <code className="text-foreground">_gigachad.{domain.hostname}</code> with value:
            </p>
            <Snippet size="sm" symbol="" classNames={{ base: 'w-full' }}>
              {domain.verificationToken}
            </Snippet>
          </div>

          {domain.lastCheckedAt ? (
            <p className="text-default-400 text-xs">
              Last checked {new Date(domain.lastCheckedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-success text-xs">
          Certificate will be issued automatically on first HTTPS request.
        </p>
      )}
    </div>
  );
}

function DomainsScreen() {
  const { workspace, isAdmin } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const domains = useDomains(workspaceId);
  const addDomain = useAddDomain(workspaceId);
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [hostname, setHostname] = useState('');

  const submit = (onClose: () => void) => {
    if (!hostname.trim()) return;
    addDomain.mutate(
      { hostname: hostname.trim() },
      {
        onSuccess: () => {
          setHostname('');
          onClose();
        },
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-divider flex items-center gap-3 border-b p-4">
        <h1 className="flex-1 text-lg font-semibold">Custom Domains</h1>
        {isAdmin ? (
          <Button color="primary" size="sm" onPress={onOpen}>
            Add domain
          </Button>
        ) : null}
      </header>

      <ScrollShadow className="min-h-0 flex-1 p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <p className="text-default-500 text-sm">
            Custom domains let your public Knowledge Base be served at your own hostname over HTTPS.
            Certificate issuance is automatic once the domain is verified.
          </p>

          {domains.isPending ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-32 w-full rounded-large" />
              ))}
            </div>
          ) : !domains.data || domains.data.length === 0 ? (
            <div className="border-divider rounded-large border p-8 text-center">
              <p className="text-default-500 text-sm">No custom domains yet.</p>
              {isAdmin ? (
                <Button
                  color="primary"
                  variant="flat"
                  size="sm"
                  className="mt-3"
                  onPress={onOpen}
                >
                  Add your first domain
                </Button>
              ) : null}
            </div>
          ) : (
            domains.data.map((d) => <DomainCard key={d.id} domain={d} />)
          )}
        </div>
      </ScrollShadow>

      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>Add custom domain</ModalHeader>
              <ModalBody>
                <Input
                  label="Hostname"
                  placeholder="help.yourdomain.com"
                  value={hostname}
                  onValueChange={setHostname}
                  description="The hostname where your Help Center will be served."
                  autoFocus
                />
                {addDomain.isError ? (
                  <p className="text-danger text-sm">
                    {addDomain.error instanceof Error
                      ? addDomain.error.message
                      : 'Failed to add domain.'}
                  </p>
                ) : null}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="primary"
                  isLoading={addDomain.isPending}
                  isDisabled={!hostname.trim()}
                  onPress={() => submit(onClose)}
                >
                  Add
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default function DomainsPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center">
            <Spinner aria-label="Loading" />
          </div>
        }
      >
        <DomainsScreen />
      </Suspense>
    </AppShell>
  );
}
