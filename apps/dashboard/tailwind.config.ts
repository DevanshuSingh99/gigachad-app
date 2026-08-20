import { createRequire } from 'node:module';
import path from 'node:path';

import { heroui } from '@heroui/react';
import type { Config } from 'tailwindcss';

/**
 * Token discipline, from docs/15-frontend-and-widget.md: a component library
 * removes the need to build components, not the need to make decisions. One font
 * stack, HeroUI's default spacing scale unmodified, one neutral ramp plus one
 * accent, two shadow levels, one radius — constrained up front so the UI stays
 * coherent under time pressure.
 *
 * Status colors are semantic and fixed: open, snoozed, resolved, and error each
 * get exactly one color, reused everywhere they appear.
 */

/**
 * HeroUI's component class names live in @heroui/theme's dist, not in our source,
 * so Tailwind has to scan that package or every component ships unstyled. The path
 * is resolved rather than hard-coded because npm may or may not hoist the package
 * to the workspace root: a literal `./node_modules/...` glob works locally and
 * then silently produces an unstyled dashboard on a differently-hoisted install.
 * If resolution fails this throws at build time, which is the right failure mode —
 * loud, not invisible.
 */
const require = createRequire(import.meta.url);
const heroUiThemeDir = path.dirname(require.resolve('@heroui/theme'));

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    `${heroUiThemeDir}/**/*.{js,mjs}`,
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Exactly two levels.
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        overlay: '0 10px 24px -6px rgb(0 0 0 / 0.18)',
      },
    },
  },
  plugins: [heroui()],
};

export default config;
