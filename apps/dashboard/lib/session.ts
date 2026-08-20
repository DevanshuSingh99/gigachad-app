'use client';

import type {
  AcceptInvitationInput,
  CreateInvitationInput,
  CreatedInvitationDto,
  LoginInput,
  MeDto,
  MemberDto,
  MembershipDto,
  SignupInput,
  WorkspaceRole,
} from '@gigachad/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { ApiError, apiFetch } from './api';

/**
 * Session and workspace state.
 *
 * There is no client-side token to manage: the session is an HttpOnly cookie the
 * browser attaches automatically, so "am I signed in?" is answered by asking the
 * server. A 401 from /auth/me is the signed-out state, which means revocation and
 * member removal take effect here as immediately as they do on the API.
 */

export const meKey = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => apiFetch<MeDto>('/api/v1/auth/me'),
    retry: false,
    staleTime: 0,
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignupInput) =>
      apiFetch<MeDto>('/api/v1/auth/signup', { method: 'POST', body: input }),
    onSuccess: (me) => queryClient.setQueryData(meKey, me),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<MeDto>('/api/v1/auth/login', { method: 'POST', body: input }),
    onSuccess: (me) => queryClient.setQueryData(meKey, me),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/v1/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      // Clear everything, not just the session: query keys are namespaced by
      // workspace and none of it belongs to the next person to sign in here.
      queryClient.clear();
    },
  });
}

// ─── Active workspace ─────────────────────────────────────────────────────────

export interface ActiveWorkspace {
  workspace: MembershipDto | null;
  memberships: MembershipDto[];
  setWorkspaceId: (workspaceId: string) => void;
  isAdmin: boolean;
}

export const ActiveWorkspaceContext = createContext<ActiveWorkspace | null>(null);

export function useActiveWorkspace(): ActiveWorkspace {
  const value = useContext(ActiveWorkspaceContext);
  if (!value) throw new Error('useActiveWorkspace must be used inside WorkspaceProvider');
  return value;
}

export const WORKSPACE_STORAGE_KEY = 'gc.workspaceId';

// ─── Members and invitations ──────────────────────────────────────────────────

/**
 * Query keys are namespaced by workspace, so switching workspaces cannot surface
 * the previous workspace's cached list (docs/17-caching.md).
 */
export const membersKey = (workspaceId: string) => ['workspace', workspaceId, 'members'] as const;
export const invitationsKey = (workspaceId: string) =>
  ['workspace', workspaceId, 'invitations'] as const;

export function useMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: membersKey(workspaceId ?? 'none'),
    queryFn: () => apiFetch<MemberDto[]>(`/api/v1/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
  });
}

export function useInviteMember(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationInput) =>
      apiFetch<CreatedInvitationDto>(`/api/v1/workspaces/${workspaceId}/invitations`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: invitationsKey(workspaceId) });
      }
    },
  });
}

export function useSetMemberRole(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WorkspaceRole }) =>
      apiFetch<MemberDto>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => {
      if (workspaceId) void queryClient.invalidateQueries({ queryKey: membersKey(workspaceId) });
    },
  });
}

export function useRemoveMember(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      apiFetch<void>(`/api/v1/workspaces/${workspaceId}/members/${memberId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      if (workspaceId) void queryClient.invalidateQueries({ queryKey: membersKey(workspaceId) });
    },
  });
}

export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiFetch<{ email: string; role: WorkspaceRole; workspaceName: string; expiresAt: string }>(
      `/api/v1/invitations/${encodeURIComponent(token ?? '')}`,
    ),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvitation(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptInvitationInput) =>
      apiFetch<MeDto>(`/api/v1/invitations/${encodeURIComponent(token ?? '')}/accept`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (me) => queryClient.setQueryData(meKey, me),
  });
}

/** Pulls the inline message for one field out of a failed request. */
export function fieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiError ? error.fieldErrors?.[field] : undefined;
}

/** The form-level message: everything not attributable to a single field. */
export function formError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.fieldErrors && Object.keys(error.fieldErrors).length > 0) return null;
    return error.message;
  }
  return 'Something went wrong. Try again.';
}
