// Tailwind 4 ships its own PostCSS plugin, which also handles vendor prefixing —
// autoprefixer is no longer a separate step.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
