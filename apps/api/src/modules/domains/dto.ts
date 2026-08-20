import type { DomainDto, DomainStatus } from '@gigachad/shared';

import { env } from '../../env';

export interface DomainRow {
  id: string;
  hostname: string;
  status: DomainStatus;
  verificationToken: string;
  lastCheckedAt: Date | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function domainDto(row: DomainRow): DomainDto {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    cnameTarget: env.KB_CNAME_TARGET,
    verificationToken: row.verificationToken,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
