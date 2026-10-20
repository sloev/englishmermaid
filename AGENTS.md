# Notes for coding agents

Plainpath is a static Vite + React app, an installable offline PWA.

- `src/lib/plainpath.ts` holds the language: line classifier, indentation-tree
  parser and Mermaid output for both views. It is pure, so test it with
  `npm test`.
- `src/App.tsx` is the whole UI: the map layer behind a translucent editor layer.
- `src/lib/files.ts` covers save/open (File System Access API with download
  fallback), PNG export and share links (`#text=`, `#s=`).
- `src/lib/embed.ts` stores the script in exported SVGs (`<metadata>`) and
  PNGs (an `iTXt` chunk) and reads it back when one is opened or dropped.
- `src/lib/mermaid.ts` renders, then tidies the SVG: it top-aligns and orders
  standalone screens, and turns round the links that `Writer.edge` wrote
  backwards so they don't drag earlier screens down.
- `src/sw.js` is the service worker template. The `serviceWorker()` plugin in
  `vite.config.ts` fills in the version and precache list.
- `public/agents.md` is the user-facing guide for AI agents. Update it whenever
  the syntax changes.

`npm run build` writes the site to `docs/`, which GitHub Pages serves. Commit
`docs/` together with source changes.

Before pushing, run `npm run typecheck && npm test && npm run build`.
