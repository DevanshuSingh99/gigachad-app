// Copies non-TypeScript runtime assets into dist/ after tsc.
// Today that is the public KB's Eta templates; tsc only emits .js, so anything
// read from disk at runtime (the `views` path in modules/kb/public.ts) has to
// be copied here explicitly. The built kb-web stylesheet is NOT copied here —
// `npm run build:css` writes it straight to dist/kb-web/styles.css, so copying
// it a second time from src would just overwrite the compiled CSS with the
// unprocessed Tailwind input file.
//
// The actual layout is flat — `src/kb-web/*.eta` — not the `templates/`/
// `public/` subdirectories this script used to assume (those never existed;
// referencing them made this a silent no-op and left `dist/kb-web` empty in
// every production build).
import { access, cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const assets = [
  // [source dir (relative to apps/api), dest dir (relative to apps/api), file filter]
  ['src/kb-web', 'dist/kb-web', (name) => name.endsWith('.eta')],
];

for (const [from, to, matches] of assets) {
  const srcDir = join(apiRoot, from);
  try {
    await access(srcDir);
  } catch {
    continue; // nothing to copy
  }

  const destDir = join(apiRoot, to);
  await mkdir(destDir, { recursive: true });

  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !matches(entry.name)) continue;
    await cp(join(srcDir, entry.name), join(destDir, entry.name));
    console.log(`copied ${from}/${entry.name} -> ${to}/${entry.name}`);
  }
}
