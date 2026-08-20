/**
 * Reads one cookie's value out of a raw `Cookie` request header.
 *
 * Socket.IO's handshake exposes headers as a plain object with no cookie
 * parsing of its own (unlike Express, which cookie-parser already handles), and
 * pulling in a whole cookie-parsing package for this one read added a
 * moduleResolution mismatch not worth chasing this late in the build — this is
 * a handful of lines doing exactly what's needed, no more.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
