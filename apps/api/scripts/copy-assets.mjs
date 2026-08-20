// Copies non-TypeScript runtime assets into dist/ after tsc.
// Today that is the public KB's Eta templates and its built stylesheet; tsc
// only emits .js, so anything read from disk at runtime has to be copied here.
import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const assets = [
  ['src/kb-web/templates', 'dist/kb-web/templates'],
  ['src/kb-web/public', 'dist/kb-web/public'],
];

for (const [from, to] of assets) {
  const src = join(apiRoot, from);
  try {
    await access(src);
  } catch {
    continue; // not created yet — Phase F adds these
  }
  await mkdir(dirname(join(apiRoot, to)), { recursive: true });
  await cp(src, join(apiRoot, to), { recursive: true });
  console.log(`copied ${from} -> ${to}`);
}
