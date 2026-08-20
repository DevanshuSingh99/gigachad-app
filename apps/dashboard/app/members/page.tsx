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
  Select,
  SelectItem,
  Skeleton,
  Snippet,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  useDisclosure,
} from '@heroui/react';
import type { MemberDto, WorkspaceRole } from '@gigachad/shared';
import { useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { ApiError } from '@/lib/api';
import {
  fieldError,
  formError,
  useActiveWorkspace,
  useInviteMember,
  useMembers,
  useMe,
  useRemoveMember,
  useSetMemberRole,
} from '@/lib/session';

function RoleChip({ role }: { role: WorkspaceRole }) {
  // Status is never conveyed by colour alone — each chip carries its label.
  return (
    <Chip size="sm" variant="flat" color={role === 'ADMIN' ? 'primary' : 'default'}>
      {role === 'ADMIN' ? 'Admin' : 'Agent'}
    </Chip>
  );
}

function MembersScreen() {
  const { workspace, isAdmin } = useActiveWorkspace();
  const me = useMe();
  const workspaceId = workspace?.workspaceId;
  const members = useMembers(workspaceId);
  const setRole = useSetMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const invite = useInviteMember(workspaceId);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('AGENT');
  const [pendingRemoval, setPendingRemoval] = useState<MemberDto | null>(null);
  const confirm = useDisclosure();

  const rows = members.data ?? [];
  const adminCount = rows.filter((m) => m.role === 'ADMIN').length;

  /**
   * The server enforces the last-Admin rule inside a transaction; disabling the
   * control here is only so the UI does not offer an action it knows will fail.
   * It is not the guard.
   */
  const isLastAdmin = (member: MemberDto) => member.role === 'ADMIN' && adminCount <= 1;

  const actionError = setRole.error ?? removeMember.error;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        <p className="text-default-500 text-sm">
          {isAdmin
            ? 'Invite teammates and manage their roles.'
            : 'Everyone with access to this workspace.'}
        </p>
      </header>

      {/* Admin-only, and genuinely absent for an Agent rather than merely disabled. */}
      {isAdmin ? (
        <Card shadow="none" className="shadow-card">
          <CardBody className="gap-3">
            <h2 className="text-sm font-medium">Invite a teammate</h2>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-start"
              onSubmit={(event) => {
                event.preventDefault();
                invite.mutate(
                  { email: inviteEmail, role: inviteRole },
                  { onSuccess: () => setInviteEmail('') },
                );
              }}
            >
              <Input
                label="Email"
                type="email"
                value={inviteEmail}
                onValueChange={setInviteEmail}
                isRequired
                className="sm:flex-1"
                isInvalid={Boolean(fieldError(invite.error, 'email'))}
                errorMessage={fieldError(invite.error, 'email')}
              />
              <Select
                label="Role"
                selectedKeys={[inviteRole]}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                className="sm:w-40"
              >
                <SelectItem key="AGENT">Agent</SelectItem>
                <SelectItem key="ADMIN">Admin</SelectItem>
              </Select>
              <Button type="submit" color="primary" isLoading={invite.isPending} className="sm:mt-3">
                Send invite
              </Button>
            </form>

            {formError(invite.error) ? (
              <p className="text-danger text-sm" role="alert">{formError(invite.error)}</p>
            ) : null}

            {/* Invitation email delivery arrives with the email channel in Phase E;
                until then the Admin passes this link on directly. */}
            {invite.data ? (
              <div className="flex flex-col gap-1">
                <p className="text-default-500 text-sm">
                  Invitation for <span className="font-medium">{invite.data.email}</span>. Send them
                  this link — it works once and expires.
                </p>
                <Snippet size="sm" variant="flat" symbol="" className="max-w-full">
                  {invite.data.inviteUrl}
                </Snippet>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {actionError ? (
        <p className="text-danger text-sm" role="alert">
          {actionError instanceof ApiError ? actionError.message : 'That action failed.'}
        </p>
      ) : null}

      {members.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-large" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-default-500 text-sm">No members yet.</p>
      ) : (
        <>
          {/* A four-column table is unreadable at 375px, so below md it becomes
              stacked cards rather than a horizontally scrolling table. */}
          <div className="hidden md:block">
            <Table aria-label="Workspace members" removeWrapper>
              <TableHeader>
                <TableColumn>NAME</TableColumn>
                <TableColumn>EMAIL</TableColumn>
                <TableColumn>ROLE</TableColumn>
                <TableColumn align="end">{isAdmin ? 'ACTIONS' : ''}</TableColumn>
              </TableHeader>
              <TableBody>
                {rows.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <span className="font-medium">{member.name}</span>
                      {member.userId === me.data?.user.id ? (
                        <span className="text-default-400 text-xs"> (you)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate">{member.email}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Select
                          aria-label={`Role for ${member.name}`}
                          size="sm"
                          className="w-32"
                          selectedKeys={[member.role]}
                          isDisabled={isLastAdmin(member) || setRole.isPending}
                          onChange={(e) =>
                            setRole.mutate({
                              memberId: member.id,
                              role: e.target.value as WorkspaceRole,
                            })
                          }
                        >
                          <SelectItem key="AGENT">Agent</SelectItem>
                          <SelectItem key="ADMIN">Admin</SelectItem>
                        </Select>
                      ) : (
                        <RoleChip role={member.role} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant="light"
                          color="danger"
                          isDisabled={isLastAdmin(member)}
                          onPress={() => {
                            setPendingRemoval(member);
                            confirm.onOpen();
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-2 md:hidden">
            {rows.map((member) => (
              <Card key={member.id} shadow="none" className="shadow-card">
                <CardBody className="gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{member.name}</p>
                      <p className="text-default-400 truncate text-xs">{member.email}</p>
                    </div>
                    <RoleChip role={member.role} />
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-wrap gap-2">
                      <Select
                        aria-label={`Role for ${member.name}`}
                        size="sm"
                        className="w-32"
                        selectedKeys={[member.role]}
                        isDisabled={isLastAdmin(member) || setRole.isPending}
                        onChange={(e) =>
                          setRole.mutate({
                            memberId: member.id,
                            role: e.target.value as WorkspaceRole,
                          })
                        }
                      >
                        <SelectItem key="AGENT">Agent</SelectItem>
                        <SelectItem key="ADMIN">Admin</SelectItem>
                      </Select>
                      <Button
                        size="sm"
                        variant="light"
                        color="danger"
                        isDisabled={isLastAdmin(member)}
                        onPress={() => {
                          setPendingRemoval(member);
                          confirm.onOpen();
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                  {isLastAdmin(member) ? (
                    <p className="text-default-400 text-xs">
                      The only Admin — promote someone else first.
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Below md HeroUI renders this as a bottom sheet. */}
      <Modal isOpen={confirm.isOpen} onOpenChange={confirm.onOpenChange} placement="center">
        <ModalContent>
          <ModalHeader>Remove {pendingRemoval?.name}?</ModalHeader>
          <ModalBody>
            <p className="text-default-500 text-sm">
              They lose access to {workspace?.workspaceName} on their next request. Conversations
              they handled stay in the inbox.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={confirm.onClose}>
              Cancel
            </Button>
            <Button
              color="danger"
              isLoading={removeMember.isPending}
              onPress={() => {
                if (!pendingRemoval) return;
                removeMember.mutate(pendingRemoval.id, { onSuccess: () => confirm.onClose() });
              }}
            >
              Remove
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </main>
  );
}

export default function MembersPage() {
  return (
    <AppShell>
      <MembersScreen />
    </AppShell>
  );
}
