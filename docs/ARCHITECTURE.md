# Architecture

Math Text is a local-first Figma plugin that typesets Markdown prose and LaTeX
mathematics into one generated Figma document. It stores the canonical source
and settings on that document so it can be edited and reflowed later.

## Rendering contract

```text
Markdown prose       -> native Figma TextNode
$...$ and $$...$$    -> local MathJax SVG -> one atomic Figma vector
```

Every delimited math span is one MathJax SVG. Math is never substituted with
native text or split into individual glyph layers. MathJax supplies exact SVG
box metrics: width, height, ascent, descent, and baseline (`baseline ===
ascent`). The layout layer scales its normalized 16px-em metrics once to the
selected prose size; SVG import applies that scale once.

## Runtime boundary

The plugin controller (`src/code.ts` and `src/figma/`) runs with the Figma Plugin
API. It owns selection, fonts, native text measurement, scene creation,
persistence, replacement, and relaunch workflows. It has no DOM, canvas, or
browser font measurement dependency.

The UI (`src/ui/`) runs in Figma's iframe. It edits source, parses Markdown,
and renders MathJax SVG payloads. Figma provides the controller's `__html__`
value from the manifest UI entry at runtime; the production controller does not
embed UI HTML.

The two runtimes exchange typed messages from `src/shared/messages.ts`. Incoming
messages are structurally validated and size-bounded. The controller reparses
source and validates occurrence-ordered math payloads before rendering. Node
identities and workflow targets remain controller-owned.

## Source and math model

`src/parser/` uses `remark-parse` and `remark-math`, then converts mdast into
the small application model in `src/shared/document-model.ts`: paragraphs,
prose runs with marks, inline math, hard breaks, and display math. The renderer
walks this model in source order.

`src/math/` runs bundled MathJax locally and normalizes every result into a
self-contained SVG plus metrics. Repeated expressions use bounded caches, while
the returned payload sequence still has one entry per source occurrence. No
network, backend, CDN, remote font, image, or foreign SVG resource is required.
SVG import rejects external image, `foreignObject`, and URL references.

## Typography and layout

Only Figma discovers available fonts, loads effective fonts, and measures prose.
Temporary auto-sized native text nodes provide prose width and height; they are
removed after measurement. The controller uses a bounded LRU measurement cache.
Figma exposes no reliable prose baseline API. A reference-glyph calibration is
used when available; a documented em-based fallback is used otherwise.

`src/layout/` is renderer-independent. It tokenizes prose, separators, atomic
math, and hard breaks; measures prose through an injected native callback; and
composes line plans. Soft wrapping is greedy and can occur only at ordinary
source whitespace. Nonbreaking spaces and word joiners remain content. Pending
separators are dropped at line edges, hard breaks preserve empty lines, and math
or glued text is never split. Overflow is deterministic.

Justification applies only to non-final soft-wrapped paragraph lines with
retained source separators. It expands eligible gaps after native widths are
known; it never stretches glyphs or math geometry. Compatible prose fragments
may merge, but math and mark boundaries remain barriers.

Final native `TextNode.width` values are authoritative. The renderer advances
later siblings from actual widths, preserves a separately measured trailing
ordinary-space advance when Figma omits it from ink bounds, recalculates line
vertical placement from calibrated metrics, and expands non-clipping frames to
actual extents. Center and right alignment use the final root width.

## Rendering, persistence, and editing

Rendering validates and measures before scene mutation. Created nodes are
tracked and removed in reverse order if construction fails. A completed root
stores a strict, versioned persistence record containing canonical source,
settings, renderer identity, and actual compiled width. Persistence has explicit
legacy migrations and assigns the `Edit Math Text` relaunch action.

Running the plugin creates a document or replaces a supported selected text
layer. The **Edit Math Text** relaunch action opens the saved document for
direct editing. Reflow and typography-sync workflows operate on a validated,
controller-locked generated document.

## Source tree

```text
src/code.ts              controller entry point
src/ui/                  React editor and UI message handling
src/parser/              Markdown and mdast-to-document conversion
src/math/                local MathJax SVG rendering, metrics, and caches
src/layout/              renderer-independent measurement and composition
src/figma/               Figma API adapters, rendering, persistence, workflows
src/shared/              document, message, persistence, and settings contracts
tests/                   Vitest unit and controller/rendering tests
scripts/                 production size and controller smoke checks
docs/                    published architecture and development references
assets/                  plugin and usage images
```
