import { z } from 'zod';

import type { DomainStatus } from '../enums';
import { hostname } from '../primitives';

/**
 * Custom domain contracts — shared between the API and the dashboard client.
 */

export const addDomainInput = z.object({ hostname });
export type AddDomainInput = z.infer<typeof addDomainInput>;

export interface DomainDto {
  id: string;
  hostname: string;
  status: DomainStatus;
  /** The CNAME target the customer must configure. */
  cnameTarget: string;
  /** TXT record value for ownership proof. */
  verificationToken: string;
  lastCheckedAt: string | null;
  /** Human-readable reason when status is ERROR. */
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
