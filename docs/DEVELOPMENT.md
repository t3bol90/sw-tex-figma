# Development and import

Use Node/pnpm specified by `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` stages the UI and atomically replaces `dist/ui.html`, so the old `dist/code.js` stays available while Figma may have the plugin open. The final `dist/` directory contains exactly `code.js` and self-contained `ui.html`; the controller smoke executes `code.js` in a DOM-less worker-like VM.

In Figma, use **Plugins → Development → Import plugin from manifest…** and select this repository's `manifest.json`. Figma issues and maintains the plugin ID; retain that ID when rebuilding or sharing a local development copy. Reload the plugin after each build.

The controller cannot use DOM, canvas, browser font measurement, or `TextEncoder`. Native text measurements, final-width reconciliation, and optional reference-glyph baseline probes run only through typed Figma APIs. See `visual-qa-fixture.md` for manual release checks and calibrated-baseline limits.
