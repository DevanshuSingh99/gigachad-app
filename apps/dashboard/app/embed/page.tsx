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
  useDisclosure,
} from '@heroui/react';
import type { EmbedTokenDto } from '@gigachad/shared';
import { useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { ApiError } from '@/lib/api';
import { useActiveWorkspace } from '@/lib/session';
import {
  useCreateEmbedToken,
  useEmbedTokens,
  useRevokeEmbedToken,
} from '@/lib/embed-tokens';

const WIDGET_ASSET_URL =
  process.env.NEXT_PUBLIC_WIDGET_ASSET_URL ?? 'https://gigachad-app.devjs.in/widget';

function scriptSnippet(token: string) {
  return `<script
  src="${WIDGET_ASSET_URL}/widget.js"
  data-widget-key="${token}"
  async></script>`;
}

function InstallSnippet({ token }: { token: string }) {
  const code = scriptSnippet(token);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="border-divider bg-default-100 min-w-0 overflow-hidden rounded-medium border">
      <pre className="m-0 max-h-56 overflow-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
        {code}
      </pre>
      <div className="border-divider flex justify-end border-t px-3 py-2">
        <Button size="sm" variant="flat" onPress={() => void copy()}>
          {copied ? 'Copied' : 'Copy snippet'}
        </Button>
      </div>
    </div>
  );
}

function TokenCard({ token }: { token: EmbedTokenDto }) {
  const { workspace } = useActiveWorkspace();
  const revoke = useRevokeEmbedToken(workspace?.workspaceId);
  const snippet = useDisclosure();

  return (
    <div className="border-divider rounded-large border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{token.label}</p>
          <p className="text-default-400 truncate text-xs">{token.allowedOrigin}</p>
        </div>
        <Chip
          size="sm"
          variant="flat"
          color={token.isActive ? 'success' : 'default'}
        >
          {token.isActive ? 'Active' : 'Revoked'}
        </Chip>
        {token.isActive ? (
          <>
            <Button size="sm" variant="flat" onPress={snippet.onOpen}>
              View snippet
            </Button>
            <Button
              size="sm"
              variant="light"
              color="danger"
              isLoading={revoke.isPending}
              onPress={() => revoke.mutate(token.id)}
            >
              Revoke
            </Button>
          </>
        ) : null}
      </div>

      <p className="text-default-400 text-xs">
        Created {new Date(token.createdAt).toLocaleDateString()}
      </p>

      {/* Snippet modal — only shown on demand so the key isn't always visible. */}
      <Modal isOpen={snippet.isOpen} onOpenChange={snippet.onOpenChange} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>Install snippet — {token.label}</ModalHeader>
              <ModalBody>
                <p className="text-default-500 text-sm">
                  Paste this script tag into the{' '}
                  <code className="text-foreground">&lt;head&gt;</code> or just
                  before the closing{' '}
                  <code className="text-foreground">&lt;/body&gt;</code> tag of{' '}
                  <span className="font-medium">{token.allowedOrigin}</span>. The
                  widget will only load on that exact origin.
                </p>
                <InstallSnippet token={token.token} />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Close
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

function EmbedScreen() {
  const { workspace, isAdmin } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const tokens = useEmbedTokens(workspaceId);
  const create = useCreateEmbedToken(workspaceId);
  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
  const [label, setLabel] = useState('');
  const [allowedOrigin, setAllowedOrigin] = useState('');

  const [newToken, setNewToken] = useState<EmbedTokenDto | null>(null);

  const submit = () => {
    if (!label.trim() || !allowedOrigin.trim()) return;
    create.mutate(
      { label: label.trim(), allowedOrigin: allowedOrigin.trim() },
      {
        onSuccess: (token) => {
          setNewToken(token);
          setLabel('');
          setAllowedOrigin('');
        },
      },
    );
  };

  const handleOpenChange = (open: boolean) => {
    onOpenChange();
    if (!open) {
      setNewToken(null);
      setLabel('');
      setAllowedOrigin('');
      create.reset();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-divider flex items-center gap-3 border-b p-4">
        <h1 className="flex-1 text-lg font-semibold">Widget Embed</h1>
        {isAdmin ? (
          <Button color="primary" size="sm" onPress={onOpen}>
            New embed token
          </Button>
        ) : null}
      </header>

      <ScrollShadow className="min-h-0 flex-1 p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <p className="text-default-500 text-sm">
            Each embed token is tied to a single allowed origin. The chat widget
            will only load when the{' '}
            <code className="text-foreground">Origin</code> header of the request
            matches exactly — any other site will be rejected.
          </p>
          <p className="text-default-500 text-sm">
            To test against the hosted demo page, set the origin to{' '}
            <code className="text-foreground">https://gigachad-demo.devjs.in</code>
            , then open{' '}
            <code className="text-foreground">
              https://gigachad-demo.devjs.in/?key=&lt;your-token&gt;
            </code>
            .
          </p>

          {tokens.isPending ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-large" />
              ))}
            </div>
          ) : !tokens.data || tokens.data.length === 0 ? (
            <div className="border-divider rounded-large border p-8 text-center">
              <p className="text-default-500 text-sm">No embed tokens yet.</p>
              {isAdmin ? (
                <Button
                  color="primary"
                  variant="flat"
                  size="sm"
                  className="mt-3"
                  onPress={onOpen}
                >
                  Create your first token
                </Button>
              ) : null}
            </div>
          ) : (
            tokens.data.map((t) => <TokenCard key={t.id} token={t} />)
          )}
        </div>
      </ScrollShadow>

      <Modal isOpen={isOpen} onOpenChange={handleOpenChange} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>
                {newToken ? 'Token created — copy your snippet' : 'New embed token'}
              </ModalHeader>
              <ModalBody>
                {newToken ? (
                  <div className="space-y-3">
                    <p className="text-default-500 text-sm">
                      This is the only time the full token is shown here. Copy the
                      snippet and paste it into{' '}
                      <span className="font-medium">{newToken.allowedOrigin}</span>.
                    </p>
                    <InstallSnippet token={newToken.token} />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Input
                      label="Label"
                      placeholder="Marketing site"
                      value={label}
                      onValueChange={setLabel}
                      description="A name to identify this token in the list."
                      autoFocus
                      isInvalid={Boolean(
                        create.error instanceof ApiError &&
                          create.error.fieldErrors?.label,
                      )}
                      errorMessage={
                        create.error instanceof ApiError
                          ? create.error.fieldErrors?.label
                          : undefined
                      }
                    />
                    <Input
                      label="Allowed origin"
                      placeholder="https://chat.example.com"
                      value={allowedOrigin}
                      onValueChange={setAllowedOrigin}
                      description="The exact https origin where the widget will be embedded. No trailing slash."
                      isInvalid={Boolean(
                        create.error instanceof ApiError &&
                          create.error.fieldErrors?.allowedOrigin,
                      )}
                      errorMessage={
                        create.error instanceof ApiError
                          ? create.error.fieldErrors?.allowedOrigin
                          : undefined
                      }
                    />
                    {create.isError &&
                    !(create.error instanceof ApiError && create.error.fieldErrors) ? (
                      <p className="text-danger text-sm">
                        {create.error instanceof Error
                          ? create.error.message
                          : 'Failed to create token.'}
                      </p>
                    ) : null}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                {newToken ? (
                  <Button color="primary" onPress={onClose}>
                    Done
                  </Button>
                ) : (
                  <>
                    <Button variant="light" onPress={onClose}>
                      Cancel
                    </Button>
                    <Button
                      color="primary"
                      isLoading={create.isPending}
                      isDisabled={!label.trim() || !allowedOrigin.trim()}
                      onPress={submit}
                    >
                      Create
                    </Button>
                  </>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <AppShell>
      <EmbedScreen />
    </AppShell>
  );
}
