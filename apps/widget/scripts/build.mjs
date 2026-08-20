// Builds the widget loader and panel with esbuild, then the panel's Tailwind
// stylesheet, then mirrors the output into the dashboard's public/ directory so
// `npm run dev --workspace @gigachad/dashboard` serves it locally exactly the
// way Cloudflare Pages serves it in production — the same relative path
// (`/widget/widget.js`, `/widget/panel/...`), just from a different static host.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const watch = process.argv.includes('--watch');

// Node 20.6+ ships loadEnvFile; this is a build script, not runtime app code,
// so reaching for it here doesn't affect the "no dotenv in the app" posture
// elsewhere in the repo.
const envPath = join(root, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const apiUrl = process.env.WIDGET_API_URL;
const wsUrl = process.env.WIDGET_WS_URL;
if (!apiUrl || !wsUrl) {
  console.error('WIDGET_API_URL and WIDGET_WS_URL must be set. See apps/widget/.env.example');
  process.exit(1);
}

const distDir = join(root, 'dist');
rmSync(distDir, { recursive: true, force: true });
mkdirSync(join(distDir, 'panel'), { recursive: true });

const define = {
  WIDGET_API_URL: JSON.stringify(apiUrl),
  WIDGET_WS_URL: JSON.stringify(wsUrl),
};

const loaderConfig = {
  entryPoints: [join(root, 'src/loader.ts')],
  outfile: join(distDir, 'widget.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  define,
  legalComments: 'none',
};

const panelConfig = {
  entryPoints: [join(root, 'src/panel/main.ts')],
  outfile: join(distDir, 'panel/main.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  define,
  legalComments: 'none',
};

function buildCss() {
  execFileSync(
    'npx',
    [
      '@tailwindcss/cli',
      '-i',
      join(root, 'src/panel/panel.css'),
      '-o',
      join(distDir, 'panel/panel.css'),
      '--minify',
    ],
    { stdio: 'inherit' },
  );
}

function copyStaticAndSync() {
  cpSync(join(root, 'src/panel/index.html'), join(distDir, 'panel/index.html'));

  // Mirror into the dashboard's public/widget so its dev server (and its own
  // Pages build) serve the same files at the same path production uses.
  const dashboardPublicWidget = join(root, '../dashboard/public/widget');
  rmSync(dashboardPublicWidget, { recursive: true, force: true });
  cpSync(distDir, dashboardPublicWidget, { recursive: true });
}

async function buildOnce() {
  await esbuild.build(loaderConfig);
  await esbuild.build(panelConfig);
  buildCss();
  copyStaticAndSync();

  const { gzipSizeSync } = await import('./gzipSize.mjs');
  const loaderBytes = readFileSync(join(distDir, 'widget.js'));
  const gzipped = gzipSizeSync(loaderBytes);
  console.log(`widget.js: ${loaderBytes.length}B raw, ${gzipped}B gzipped`);
  if (gzipped > 15 * 1024) {
    console.error(`✗ loader exceeds the 15KB gzipped budget (${gzipped}B)`);
    process.exitCode = 1;
  } else {
    console.log(`✓ within the 15KB gzipped budget`);
  }
}

if (watch) {
  const loaderCtx = await esbuild.context(loaderConfig);
  const panelCtx = await esbuild.context(panelConfig);
  await loaderCtx.watch();
  await panelCtx.watch();
  buildCss();
  copyStaticAndSync();
  console.log('watching for changes…');
} else {
  await buildOnce();
}
