import { gzipSync } from 'node:zlib';

export function gzipSizeSync(buffer) {
  return gzipSync(buffer, { level: 9 }).length;
}
