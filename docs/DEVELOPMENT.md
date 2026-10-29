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

The controller cannot use DOM, canvas, browser font measurement, or `TextEncoder`. Native text measurements, final-width reconciliation, and optional reference-glyph baseline probes run only through typed Figma APIs. Live Figma checks remain necessary because mocked APIs cannot fully reproduce native font geometry and SVG import behavior.

## Verify Slides before publishing

Reload the development plugin after changing the manifest. If Slides does not list
the plugin, import the root `manifest.json` again.

1. In single-slide view, apply prose with inline and display LaTeX. Check that the generated document is centered inside the slide. Repeat on a later slide in the deck at 16px and 32px, and check that bold labels and prose stay on their intended lines.
2. In grid view, select a slide or a shape inside it and apply. Check that the result belongs to that slide.
3. Select content on two slides and apply. Check that an error appears and neither slide gains a result.
4. Convert a selected text layer, then use **Edit Math Text** on the generated document. Check that editing preserves its slide, layer order, position, and rotation.
5. Repeat creation and editing in Figma Design. Check that the existing workflows still work.
