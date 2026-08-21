'use client';

import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Textarea,
  useDisclosure,
} from '@heroui/react';
import type { CannedResponseDto } from '@gigachad/shared';
import { useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { ApiError } from '@/lib/api';
import {
  useCannedResponses,
  useCreateCannedResponse,
  useDeleteCannedResponse,
  usePatchCannedResponse,
} from '@/lib/canned-responses';
import { useActiveWorkspace } from '@/lib/session';

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  content: string;
  shortcut: string;
  tags: string;
}

const EMPTY: FormState = { name: '', content: '', shortcut: '', tags: '' };

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function CannedResponsesScreen() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;

  const [search, setSearch] = useState('');
  const list = useCannedResponses(workspaceId, search ? { search } : {});
  const create = useCreateCannedResponse(workspaceId);
  const patch = usePatchCannedResponse(workspaceId);
  const del = useDeleteCannedResponse(workspaceId);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<CannedResponseDto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CannedResponseDto | null>(null);
  const formModal = useDisclosure();
  const deleteConfirm = useDisclosure();

  const field = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    formModal.onOpen();
  };

  const openEdit = (r: CannedResponseDto) => {
    setEditing(r);
    setForm({
      name: r.name,
      content: r.content,
      shortcut: r.shortcut ?? '',
      tags: r.tags.join(', '),
    });
    formModal.onOpen();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      content: form.content.trim(),
      shortcut: form.shortcut.trim() || undefined,
      tags: parseTags(form.tags),
    };

    if (editing) {
      patch.mutate(
        { id: editing.id, ...payload, shortcut: payload.shortcut ?? null },
        { onSuccess: () => formModal.onClose() },
      );
    } else {
      create.mutate(payload, { onSuccess: () => { formModal.onClose(); setForm(EMPTY); } });
    }
  };

  const rows = list.data ?? [];
  const isMutating = create.isPending || patch.isPending;
  const mutateError = create.error ?? patch.error;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Canned Responses</h1>
          <p className="text-default-500 text-sm">
            Saved replies for fast insertion in conversations. Type{' '}
            <code className="bg-default-100 rounded px-1">/shortcut</code> in the reply box to
            trigger one.
          </p>
        </div>
        <Button color="primary" size="sm" onPress={openCreate}>
          New response
        </Button>
      </header>

      <Input
        placeholder="Search by name, shortcut, or content…"
        value={search}
        onValueChange={setSearch}
        isClearable
        onClear={() => setSearch('')}
        size="sm"
      />

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-large" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-default-500 text-sm">
          {search ? 'No responses match that search.' : 'No canned responses yet. Create one to get started.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Card key={r.id} shadow="none" className="shadow-card">
              <CardBody className="gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {r.shortcut ? (
                        <code className="bg-default-100 text-default-600 rounded px-1.5 py-0.5 text-xs">
                          /{r.shortcut}
                        </code>
                      ) : null}
                      {r.tags.map((tag) => (
                        <Chip key={tag} size="sm" variant="flat">{tag}</Chip>
                      ))}
                    </div>
                    <p className="text-default-500 mt-1 line-clamp-2 text-sm">{r.content}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="light" onPress={() => openEdit(r)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      onPress={() => { setPendingDelete(r); deleteConfirm.onOpen(); }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        isOpen={formModal.isOpen}
        onOpenChange={formModal.onOpenChange}
        placement="center"
        size="lg"
      >
        <ModalContent>
          <form onSubmit={handleSubmit}>
            <ModalHeader>{editing ? 'Edit response' : 'New canned response'}</ModalHeader>
            <ModalBody className="gap-3">
              <Input
                label="Name"
                placeholder="e.g. Greeting"
                value={form.name}
                onValueChange={field('name')}
                isRequired
                maxLength={100}
              />
              <Input
                label="Shortcut (optional)"
                placeholder="e.g. greet"
                value={form.shortcut}
                onValueChange={(v) => field('shortcut')(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                description="Type /shortcut in the reply box to insert this response."
                startContent={<span className="text-default-400 text-sm">/</span>}
                maxLength={50}
              />
              <Textarea
                label="Content"
                placeholder="Write the reply text…"
                value={form.content}
                onValueChange={field('content')}
                isRequired
                minRows={3}
                maxRows={10}
                maxLength={8000}
                description={`${form.content.length}/8000`}
              />
              <Input
                label="Tags (optional)"
                placeholder="billing, refund, greeting"
                value={form.tags}
                onValueChange={field('tags')}
                description="Comma-separated. Use to filter responses."
              />
              {mutateError ? (
                <p className="text-danger text-sm" role="alert">
                  {mutateError instanceof ApiError ? mutateError.message : 'Save failed.'}
                </p>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={formModal.onClose}>Cancel</Button>
              <Button type="submit" color="primary" isLoading={isMutating}>
                {editing ? 'Save changes' : 'Create'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Delete confirm modal */}
      <Modal isOpen={deleteConfirm.isOpen} onOpenChange={deleteConfirm.onOpenChange} placement="center">
        <ModalContent>
          <ModalHeader>Delete &ldquo;{pendingDelete?.name}&rdquo;?</ModalHeader>
          <ModalBody>
            <p className="text-default-500 text-sm">This action cannot be undone.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={deleteConfirm.onClose}>Cancel</Button>
            <Button
              color="danger"
              isLoading={del.isPending}
              onPress={() => {
                if (!pendingDelete) return;
                del.mutate(pendingDelete.id, { onSuccess: () => { deleteConfirm.onClose(); setPendingDelete(null); } });
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </main>
  );
}

export default function CannedResponsesPage() {
  return (
    <AppShell>
      <CannedResponsesScreen />
    </AppShell>
  );
}
