/**
 * Allow importing stylesheet files (e.g. `import "./globals.css"`) under a bare
 * `tsc --noEmit` typecheck. Next.js handles these imports at build time; this
 * declaration only keeps the standalone `npm run typecheck` script green.
 */
declare module "*.css";
