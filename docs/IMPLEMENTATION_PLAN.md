# Implementation Plan

This plan splits the architecture into reviewable, dependency-ordered pull requests. Each PR must pass its own tests and keep the plugin buildable.

## PR 1 — Plugin foundation and typed runtime boundary

**Goal:** Establish a working Figma plugin shell and stable shared contracts.

- Add pnpm, TypeScript, Vite, Vitest, ESLint, and formatting configuration.
- Add `manifest.json` with create/edit/reflow commands and local-only network access.
- Build `dist/code.js` and a single-file `dist/ui.html`.
- Add minimal controller and React UI entry points.
- Define document, typography, settings, rendered-math, persistence, and message types.
- Add runtime message guards so iframe messages are not trusted by shape alone.
- Add CI-ready scripts for typecheck, test, lint, and build.

**Acceptance:** install, typecheck, tests, lint, and production build pass; the plugin opens its UI and exchanges a typed initialization message.

## PR 2 — Markdown parser and application document model

**Goal:** Convert supported Markdown into the renderer-independent application AST.

- Integrate `unified`, `remark-parse`, and `remark-math`.
- Support paragraphs, inline math, display math, bold, italic, and explicit breaks.
- Normalize adjacent compatible text runs.
- Return structured errors for unsupported nodes.
- Add parser and AST conversion unit tests.

**Acceptance:** architecture examples produce the expected application AST; math spans remain atomic.

## PR 3 — Source editor and MathJax SVG pipeline

**Goal:** Let the UI edit source and render every math run through bundled MathJax.

- Add CodeMirror 6 Markdown editing.
- Extract math work from the application AST.
- Render inline and display TeX to serialized SVG with ascent/descent metrics.
- Add deterministic cache keys and an in-memory math cache.
- Show parse/TeX errors without sending a destructive render request.
- Add focused renderer/cache tests where the DOM boundary permits.

**Acceptance:** mixed source produces a typed render request containing one SVG payload per contiguous math expression; no network is used.

## PR 4 — Selection, typography, and Figma text measurement

**Goal:** Make prose inherit and measure with Figma typography.

- Read supported typography, width, source, and placement from the current selection.
- Handle mixed or unavailable properties explicitly.
- Load fonts before setting characters.
- Implement temporary-node text measurement and a typography-sensitive cache.
- Add selection and measurement tests with a mocked Figma API.

**Acceptance:** selecting a text node initializes the UI with its source, width, and supported typography; prose measurements come only from Figma.

## PR 5 — Pure paragraph compositor

**Goal:** Implement deterministic word wrapping and baseline-aware layout independently of Figma node creation.

- Tokenize prose at valid break opportunities while preserving whitespace and marks.
- Treat math as atomic boxes.
- Implement exact-fit, overflow, forced-break, and over-wide-token behavior.
- Compute line ascent/descent and child baseline offsets.
- Merge adjacent compatible prose tokens on each final line.
- Add comprehensive unit tests for boundaries, punctuation, marks, and math.

**Acceptance:** the compositor consumes measured boxes and produces stable line plans with no renderer/Figma dependencies.

## PR 6 — Figma document rendering and versioned persistence

**Goal:** Compile a parsed and measured document into a readable Figma layer tree.

- Create paragraph, line, prose, inline-math, and display-math nodes.
- Import SVG with predictable sizing and explicit baseline placement.
- Use readable, truncated layer names.
- Persist versioned canonical source/settings on the top-level frame.
- Register relaunch data.
- Render transactionally: preserve the old node until the replacement succeeds.
- Add controller integration tests with mocked Figma APIs.

**Acceptance:** Create produces native prose plus vector math, with canonical source recoverable from plugin data.

## PR 7 — Edit, replace, reflow, and typography sync workflows

**Goal:** Complete the core Figma editing lifecycle.

- Implement Create, Edit Selected, Reflow Selected, and Sync Typography flows.
- Replace selected text while preserving parent, order, position, width, and rotation where supported.
- Migrate and validate persisted state.
- Rebuild generated children from canonical source rather than patching geometry.
- Handle invalid selections and stale/corrupt metadata safely.
- Add workflow integration tests.

**Acceptance:** generated content can be reopened, edited, and reflowed without reconstructing source from children.

## PR 8 — UX hardening, performance, and release checks

**Goal:** Make the MVP safe and pleasant for normal use.

- Finish typography/width/math-scale controls and useful status/error states.
- Add render cancellation/stale-response protection.
- Bound caches and batch expensive operations where useful.
- Add representative visual fixture documents and a manual Figma QA checklist.
- Test missing fonts, malformed LaTeX, oversized SVG, long equations, and 100+ repeated inline equations.
- Document local development, plugin import, validation, and release steps.

**Acceptance:** all automated checks pass and the architecture's MVP success criteria pass the manual QA checklist.

## Delivery rules

1. Implement PRs in order unless a PR explicitly has no dependency on unfinished work.
2. Use a fresh Terra subagent for each implementation PR.
3. Review the diff and run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before accepting each PR.
4. Keep generated `dist/` files out of source control unless Figma distribution requires a release artifact.
5. Do not weaken the architectural invariants: prose is native Figma text, all delimited math is MathJax SVG, source is canonical, and layout consumes measured boxes.
