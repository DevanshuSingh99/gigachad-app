import { RESERVED_SLUGS, slug as slugSchema } from '@gigachad/shared';

/**
 * Workspace slug derivation.
 *
 * A slug is more exposed than it looks: it is the email local part
 * (`<slug>@inbound.<domain>`) and a public KB path segment. So it has to be
 * globally unique, safe in both positions, and never collide with a platform name.
 */

/** Best-effort transliteration of the workspace name into slug shape. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    // Strip combining marks so "Café" becomes "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');

  // A name of only punctuation or non-Latin script leaves nothing usable.
  return base.length >= 2 ? base : 'workspace';
}

/**
 * Candidate slugs in preference order: the derived slug, then short suffixes.
 *
 * Uniqueness is global, so collisions happen for ordinary names like "support".
 * The caller tries these in order against the database; the last few are random so
 * a popular name cannot walk a long sequence of taken candidates.
 */
export function slugCandidates(name: string, attempts = 6): string[] {
  const base = slugify(name);
  const candidates: string[] = [];

  const push = (value: string) => {
    const parsed = slugSchema.safeParse(value);
    if (parsed.success && !candidates.includes(parsed.data)) candidates.push(parsed.data);
  };

  push(base);
  // A reserved or too-short base still needs a usable first candidate.
  if (candidates.length === 0) push(`${base}-1`);

  for (let i = 2; i <= 3 && candidates.length < attempts; i++) push(`${base}-${i}`);
  while (candidates.length < attempts) {
    push(`${base}-${Math.random().toString(36).slice(2, 6)}`);
  }

  return candidates;
}

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.has(value);
}
