# Figma Markdown + LaTeX Text Plugin — Architecture

## 1. Overview

This document defines the architecture for a Figma plugin that renders mixed Markdown prose and LaTeX mathematics as a visually coherent paragraph while preserving practical editability.

The central requirement is:

- **Normal prose** uses native Figma `TextNode`s and inherits the typography configured in Figma.
- **Anything inside LaTeX delimiters** (`$...$` or `$$...$$`) is rendered using a TeX math engine and imported into Figma as vector geometry.
- The original Markdown/LaTeX source is preserved so the generated result can be reopened, edited, and reflowed.

Example source:

```md
The coefficients $\alpha$, $\beta$, and $\gamma$ determine
$y = \alpha x^2 + \beta x + \gamma$.
```

Conceptual Figma result:

```text
Math Paragraph
├─ Text: "The coefficients "          ← native Figma font
├─ Math: "\alpha"                    ← TeX-rendered SVG/vector
├─ Text: ", "
├─ Math: "\beta"
├─ Text: ", and "
├─ Math: "\gamma"
├─ Text: " determine "
├─ Math: "y = \alpha x^2 + \beta x + \gamma"
└─ Text: "."
```

The plugin should feel like a mixed typography engine rather than a simple LaTeX-to-SVG converter.

---

## 2. Product Goals

### Primary goals

1. Render Markdown paragraphs containing inline and display LaTeX.
2. Preserve the Figma-selected font, size, line height, fill, and other prose typography.
3. Render **all math**, including simple symbols such as `\alpha`, `\beta`, `x`, `+`, and `=`, using one consistent TeX renderer.
4. Support inline math inside full paragraphs.
5. Preserve the original Markdown/LaTeX source.
6. Allow generated paragraphs to be reopened and edited.
7. Reflow paragraphs when content, typography, or width changes.
8. Produce vector math that remains sharp at any scale.
9. Work without a backend for the MVP.

### Secondary goals

- Bold and italic Markdown.
- Display equations.
- Lists and other basic Markdown constructs.
- Typography synchronization from selected Figma text.
- Caching for repeated math expressions.
- Fast re-rendering of existing generated content.

---

## 3. Non-Goals for MVP

The first version should **not** attempt to:

- Implement complete CommonMark.
- Make complex TeX equations directly editable as native Figma text.
- Keep the plugin permanently active in the background.
- Build a custom TeX typesetting engine.
- Implement a custom font renderer for normal prose.
- Depend on a cloud backend.
- Support arbitrary HTML.
- Maintain automatic live synchronization after the plugin is closed.
- Reproduce every advanced TeX package.

The MVP should focus on excellent mixed prose/math composition.

---

## 4. Core Architectural Decision

The source syntax determines the rendering system.

```text
Outside $...$ / $$...$$
        ↓
Native Figma TextNode

Inside $...$ / $$...$$
        ↓
TeX renderer
        ↓
SVG
        ↓
Figma vector geometry
```

There is deliberately **no "simple math as Figma text" optimization**.

For example:

```md
$x$
$\alpha$
$\alpha + \beta = \gamma$
$\frac{x^2}{y}$
```

all use the same TeX rendering pipeline.

This provides consistent:

- glyph design,
- mathematical italics,
- operator spacing,
- superscript/subscript behavior,
- symbol sizing,
- baseline metrics,
- fraction layout,
- root layout,
- mathematical spacing.

---

# 5. High-Level System Architecture

```text
                         FIGMA DESIGN

                              │
                              │ selection / commands
                              ▼

                    ┌─────────────────────┐
                    │ Plugin Controller   │
                    │       code.ts       │
                    │                     │
                    │ Figma Plugin API    │
                    │ typography reading  │
                    │ text measurement    │
                    │ node creation       │
                    │ paragraph layout    │
                    │ persistence         │
                    └──────────┬──────────┘
                               │
                        postMessage
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Plugin UI iframe    │
                    │                     │
                    │ React               │
                    │ CodeMirror          │
                    │ remark              │
                    │ remark-math         │
                    │ MathJax             │
                    │ preview/errors      │
                    └──────────┬──────────┘
                               │
                     AST / SVG / metrics
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Layout / Render     │
                    │                     │
                    │ text runs           │
                    │ math boxes          │
                    │ line breaking       │
                    │ baseline alignment  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Figma Layer Tree    │
                    │                     │
                    │ native TextNodes    │
                    │ + SVG/vector math   │
                    └─────────────────────┘
```

---

# 6. Runtime Split

A Figma plugin has two relevant execution environments.

## 6.1 Plugin controller

File:

```text
src/code.ts
```

Responsibilities:

- access `figma.currentPage`,
- inspect the current selection,
- inspect text styles,
- load Figma fonts,
- create native text nodes,
- measure prose using Figma itself,
- import SVG math,
- calculate paragraph line layout,
- create/update Figma layers,
- store plugin metadata,
- handle relaunch/edit/reflow commands.

Typical APIs:

```ts
figma.currentPage.selection
figma.createText()
figma.loadFontAsync()
figma.createNodeFromSvg()
figma.showUI()
figma.ui.postMessage()
figma.ui.onmessage
node.setPluginData()
node.getPluginData()
node.setRelaunchData()
```

The controller should contain no React or DOM-dependent rendering logic.

---

## 6.2 Plugin UI iframe

Files:

```text
src/ui/*
```

Responsibilities:

- Markdown/LaTeX source editing,
- syntax highlighting,
- Markdown parsing,
- math parsing,
- MathJax execution,
- SVG generation,
- render errors,
- user settings,
- editing existing generated paragraphs,
- optional preview.

Recommended libraries:

- React
- CodeMirror 6
- `unified`
- `remark-parse`
- `remark-math`
- MathJax 4

The UI communicates with `code.ts` through structured messages.

---

# 7. Recommended Technology Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Figma integration | Figma Plugin API |
| Type definitions | `@figma/plugin-typings` |
| UI | React + TypeScript |
| Source editor | CodeMirror 6 |
| Markdown parser | `unified` + `remark-parse` |
| Math parser | `remark-math` |
| TeX renderer | MathJax 4 |
| Math output | SVG |
| Prose renderer | Native Figma `TextNode` |
| Layout engine | Custom TypeScript module |
| Build | Vite |
| Tests | Vitest |
| Package manager | pnpm |
| Persistence | Figma `pluginData` |
| Backend | None for MVP |

---

# 8. Source Document Model

The Markdown AST should **not** become the plugin's permanent internal document model.

Convert parsed Markdown into a small application-specific intermediate representation.

```ts
type DocumentNode =
  | ParagraphNode
  | DisplayMathNode;

interface ParagraphNode {
  type: "paragraph";
  children: InlineRun[];
}

type InlineRun =
  | TextRun
  | MathRun;

interface TextRun {
  type: "text";
  value: string;
  marks?: TextMark[];
}

type TextMark =
  | "bold"
  | "italic";

interface MathRun {
  type: "math";
  latex: string;
  display: false;
}

interface DisplayMathNode {
  type: "display-math";
  latex: string;
}
```

Example:

```md
The value $\alpha + \beta$ is **important**.
```

becomes:

```ts
{
  type: "paragraph",
  children: [
    {
      type: "text",
      value: "The value "
    },
    {
      type: "math",
      latex: "\\alpha + \\beta",
      display: false
    },
    {
      type: "text",
      value: " is "
    },
    {
      type: "text",
      value: "important",
      marks: ["bold"]
    },
    {
      type: "text",
      value: "."
    }
  ]
}
```

This model isolates the layout engine from remark, React, MathJax, and Figma implementation details.

---

# 9. Parsing Pipeline

Input:

```md
The expected value is $\mathbb{E}[X]$.

$$
\mathbb{E}[X] = \int_{-\infty}^{\infty} x f(x)\,dx
$$
```

Pipeline:

```text
Markdown source
      ↓
remark-parse
      ↓
remark-math
      ↓
mdast
      ↓
application AST
```

Initially supported Markdown:

- paragraphs,
- inline math,
- display math,
- bold,
- italic,
- explicit line breaks.

Later:

- unordered lists,
- ordered lists,
- inline code,
- headings,
- links.

The plugin should walk the syntax tree directly instead of converting Markdown to HTML.

---

# 10. Math Rendering Pipeline

All LaTeX expressions use MathJax.

```text
LaTeX source
    ↓
MathJax TeX input
    ↓
MathJax SVG output
    ↓
serialized SVG
    ↓
Figma createNodeFromSvg()
```

Example:

```latex
\alpha + \beta = \gamma
```

is treated identically to:

```latex
\frac{x^2+1}{\sqrt{y}}
```

from an architectural perspective.

Each contiguous `$...$` span should produce **one math object**.

Do not split:

```latex
$y = \alpha x + \beta$
```

into individual glyph objects.

Instead create:

```text
Math SVG: "y = αx + β"
```

This preserves TeX spacing and keeps the Figma layer tree manageable.

---

# 11. Math Metrics

Every rendered math run needs layout metrics.

```ts
interface MathMetrics {
  width: number;
  height: number;
  ascent: number;
  descent: number;
  baseline: number;
}
```

The math renderer should return:

```ts
interface RenderedMath {
  latex: string;
  svg: string;
  width: number;
  height: number;
  ascent: number;
  descent: number;
}
```

The exact extraction method can be refined during implementation, but the layout engine must treat baseline metrics as first-class data.

Vertical centering is not sufficient for high-quality inline math.

---

# 12. Prose Rendering

Normal text should always be rendered by Figma itself.

Example:

```text
"The parameters "
```

becomes:

```ts
const node = figma.createText();

await figma.loadFontAsync(fontName);

node.fontName = fontName;
node.fontSize = fontSize;
node.characters = "The parameters ";
```

The prose should inherit as much typography as practical from the selected Figma text node:

```ts
interface TypographyContext {
  fontName: FontName;
  fontSize: number;
  lineHeight: LineHeight;
  letterSpacing: LetterSpacing;
  fills: readonly Paint[];
  textStyleId?: string;
}
```

Potential later additions:

- paragraph spacing,
- OpenType features where available,
- variable font axes,
- text case,
- decoration.

---

# 13. Text Measurement

Do **not** use browser DOM measurement for prose.

The selected Figma font may not be installed or available to the plugin iframe, and browser measurement may differ from Figma.

Use Figma as the text measurement engine.

Conceptual implementation:

```ts
async function measureTextRun(
  value: string,
  style: TypographyContext
): Promise<TextMetrics> {
  await figma.loadFontAsync(style.fontName);

  const node = figma.createText();

  node.fontName = style.fontName;
  node.fontSize = style.fontSize;
  node.characters = value;

  const metrics = {
    width: node.width,
    height: node.height
  };

  node.remove();

  return metrics;
}
```

Production code should introduce caching to avoid repeatedly creating identical temporary nodes.

---

# 14. Measured Layout Model

Before line composition, convert source runs into measured boxes.

```ts
type MeasuredRun =
  | MeasuredTextRun
  | MeasuredMathRun;

interface MeasuredTextRun {
  type: "text";
  value: string;
  width: number;
  height: number;
  ascent: number;
  descent: number;
  style: TypographyContext;
}

interface MeasuredMathRun {
  type: "math";
  latex: string;
  svg: string;
  width: number;
  height: number;
  ascent: number;
  descent: number;
}
```

The layout engine should care only about:

```text
width
ascent
descent
break opportunities
```

---

# 15. Paragraph Layout Engine

This is the highest-complexity subsystem.

Given:

```text
paragraph width = 480px
```

and:

```text
[TextRun][MathRun][TextRun][MathRun]...
```

the compositor must:

1. identify valid break opportunities,
2. measure each candidate segment,
3. fit runs into the current line,
4. create a new line when needed,
5. preserve TeX expressions as atomic inline boxes,
6. calculate line ascent/descent,
7. align all children to the shared baseline.

Simplified pseudocode:

```ts
for (const paragraph of document) {
  let line = createLine();

  for (const token of paragraph.tokens) {
    if (line.width + token.width > paragraphWidth) {
      flush(line);
      line = createLine();
    }

    line.add(token);
  }

  flush(line);
}
```

Real implementation requires splitting prose at word/break boundaries rather than treating entire text runs as indivisible.

---

# 16. Tokenization for Line Breaking

A prose run such as:

```text
"The expected value of the variable is "
```

cannot be treated as one indivisible layout object.

It needs break opportunities.

Conceptually:

```ts
[
  "The ",
  "expected ",
  "value ",
  "of ",
  "the ",
  "variable ",
  "is "
]
```

However, the final Figma layer structure should avoid creating one `TextNode` for every word.

Recommended strategy:

1. tokenize prose for measurement,
2. calculate line breaks,
3. merge adjacent prose tokens that fall on the same line and share the same style,
4. create one final `TextNode` per merged line segment.

Thus measurement granularity and final layer granularity are independent.

---

# 17. Baseline Alignment

Inline equations must align to the prose baseline.

Bad approach:

```text
vertical center
```

Correct approach:

```text
                        math ascent
                            ↑
       prose ascent         │
            ↑               │
            │        ┌─────────────┐
            │        │   equation  │
────────────┼────────┼─────────────┼──── baseline
            │        │             │
            ↓        └─────────────┘
       prose descent        ↓
                       math descent
```

For each line:

```ts
lineAscent = max(child.ascent);
lineDescent = max(child.descent);
lineHeight = lineAscent + lineDescent;
```

Each child is positioned so that:

```ts
childY = lineTop + lineAscent - child.ascent;
```

This gives consistent visual alignment between prose and TeX.

---

# 18. Recommended Figma Layer Structure

Do not create one giant horizontal wrap frame containing every individual word.

Recommended output:

```text
Math Paragraph
│
├── Line 1
│   ├── Text  "The coefficients "
│   ├── Math  "\alpha"
│   ├── Text  ", "
│   ├── Math  "\beta"
│   ├── Text  " and "
│   └── Math  "\gamma"
│
└── Line 2
    ├── Text  "determine "
    ├── Math  "y = \alpha x^2 + \beta x + \gamma"
    └── Text  "."
```

Suggested hierarchy:

```text
Paragraph Frame
  layoutMode = VERTICAL

Line Frame
  layoutMode = HORIZONTAL
  baseline alignment where useful
```

The layout engine may still use explicit positioning if Figma Auto Layout is not sufficiently predictable for TeX baseline offsets.

The line-oriented hierarchy keeps generated layers readable.

---

# 19. Display Math

Display equations should be separate block nodes.

Input:

```md
The loss is

$$
L = \frac{1}{N}\sum_{i=1}^{N}(y_i-\hat y_i)^2
$$

and is minimized during training.
```

Output:

```text
Document Frame
├── Paragraph
│   └── Text "The loss is"
│
├── Display Math
│   └── vector equation
│
└── Paragraph
    └── Text "and is minimized during training."
```

Display math should support configurable:

- alignment,
- scale,
- top spacing,
- bottom spacing.

---

# 20. Figma Selection Integration

The normal entry flow should be selection-aware.

If the user selects a `TextNode`, the plugin should inspect:

- font family/style,
- font size,
- line height,
- letter spacing,
- fills,
- text style,
- node width,
- node position.

Then initialize the plugin with those values.

Example:

```ts
const selection = figma.currentPage.selection;

if (selection.length === 1 && selection[0].type === "TEXT") {
  const node = selection[0];

  // derive style and initial content
}
```

Possible flows:

### Create from selected text

1. Select existing text.
2. Launch plugin.
3. Existing text becomes initial Markdown source.
4. Typography is inherited.
5. Add LaTeX.
6. Apply.
7. Replace original text with generated paragraph.

### Create without selection

1. Launch plugin.
2. Use plugin defaults.
3. Enter source.
4. Insert result near viewport center.

---

# 21. Replacing Existing Text

A strong workflow is:

```text
Existing Figma TextNode
        ↓
select
        ↓
launch Math Text plugin
        ↓
edit Markdown + LaTeX
        ↓
Apply
        ↓
replace node with generated paragraph
```

When replacing, preserve where appropriate:

- x,
- y,
- width,
- rotation,
- parent,
- ordering,
- typography,
- fills.

Avoid unexpectedly changing layout hierarchy unless necessary.

---

# 22. Editing Existing Generated Content

The generated paragraph is a compiled representation.

The Markdown/LaTeX source remains the canonical source.

```text
Markdown/LaTeX
     ↓
compiled
     ↓
Figma layer structure
```

Store source metadata on the top-level generated frame.

```ts
paragraph.setPluginData(
  "math-text-document",
  JSON.stringify(documentState)
);
```

Example state:

```json
{
  "version": 1,
  "source": "The coefficient $\\alpha$ controls...",
  "width": 480,
  "inheritTypography": true,
  "mathScale": 1,
  "renderer": "mathjax-svg"
}
```

---

# 23. Relaunch Integration

Generated nodes should expose an edit action through Figma's relaunch mechanism.

Example:

```ts
paragraph.setRelaunchData({
  edit: "Edit Math Text"
});
```

This gives the user a direct path back into the source editor after selecting the generated paragraph.

The manifest has no `menu` property, so Figma Run opens the default create workflow directly.
Generated nodes expose editing through the separate `Edit Math Text` relaunch action. Its Apply operation reflows when source or layout settings change. `sync-typography` is reserved for internal/controller use and is not exposed in the direct-Run UX.

---

# 24. Reflow

Reflow should rebuild line composition from canonical source.

Triggers:

- changed paragraph width,
- changed prose font,
- changed font size,
- changed line height,
- edited source,
- changed prose font size (math follows it).

Recommended architecture:

```text
existing generated paragraph
          ↓
read pluginData
          ↓
read current typography / width
          ↓
parse source
          ↓
measure
          ↓
re-layout
          ↓
replace generated children
```

Do not try to patch individual vector coordinates when a full reflow is needed.

---

# 25. Typography Synchronization

A generated paragraph should support a command such as:

```text
Sync Typography
```

Possible behavior:

1. inspect the first prose `TextNode`,
2. derive its current Figma typography,
3. update stored paragraph typography,
4. remeasure text,
5. reflow all lines,
6. resize/reposition math as required.

This gives designers a Figma-native way to restyle prose after creation.

---

# 26. Message Protocol

Define explicit typed messages between UI and controller.

```ts
type UIToPluginMessage =
  | {
      type: "RENDER_DOCUMENT";
      source: string;
      math: RenderedMathPayload[];
      settings: RenderSettings;
    }
  | {
      type: "REQUEST_SELECTION_STYLE";
    }
  | {
      type: "CLOSE";
    };

type PluginToUIMessage =
  | {
      type: "INITIALIZE";
      source?: string;
      typography?: TypographyContext;
      width?: number;
    }
  | {
      type: "SELECTION_CHANGED";
      typography?: TypographyContext;
    }
  | {
      type: "RENDER_ERROR";
      message: string;
    };
```

Avoid untyped arbitrary message objects.

---

# 27. Suggested Folder Structure

```text
src/
├── code.ts
│
├── shared/
│   ├── messages.ts
│   ├── document-model.ts
│   ├── types.ts
│   └── constants.ts
│
├── parser/
│   ├── markdown.ts
│   ├── mdast-to-document.ts
│   └── marks.ts
│
├── math/
│   ├── mathjax.ts
│   ├── metrics.ts
│   ├── svg.ts
│   └── cache.ts
│
├── layout/
│   ├── tokenizer.ts
│   ├── measure.ts
│   ├── line-break.ts
│   ├── baseline.ts
│   └── compositor.ts
│
├── figma/
│   ├── typography.ts
│   ├── text-measurement.ts
│   ├── render-text.ts
│   ├── render-math.ts
│   ├── render-paragraph.ts
│   ├── selection.ts
│   ├── persistence.ts
│   └── relaunch.ts
│
└── ui/
    ├── main.tsx
    ├── App.tsx
    ├── Editor.tsx
    ├── TypographyPanel.tsx
    ├── Preview.tsx
    └── styles.css
```

---

# 28. Math Rendering Cache

Inline math frequently repeats:

```latex
$x$
$y$
$\alpha$
$\beta$
```

Cache the rendered MathJax result.

Suggested key:

```ts
const key = JSON.stringify({
  latex,
  display,
  mathScale,
  rendererVersion
});
```

Cache value:

```ts
interface CachedMath {
  svg: string;
  width: number;
  height: number;
  ascent: number;
  descent: number;
}
```

Caching can initially live in plugin memory.

Persistent caching can be evaluated later.

---

# 29. Text Measurement Cache

Text measurement may also be expensive.

Suggested key:

```ts
const key = JSON.stringify({
  value,
  fontFamily,
  fontStyle,
  fontSize,
  letterSpacing
});
```

Cache:

```ts
{
  width,
  height,
  ascent,
  descent
}
```

Invalidate when typography changes.

---

# 30. Build Setup

Recommended:

```text
pnpm
TypeScript
Vite
Vitest
```

Outputs:

```text
dist/
├── code.js
└── ui.html
```

The UI bundle may inline its JavaScript/CSS into `ui.html` depending on the chosen Figma build setup.

---

# 31. Example package Dependencies

Approximate dependency set:

```json
{
  "dependencies": {
    "react": "...",
    "react-dom": "...",
    "unified": "...",
    "remark-parse": "...",
    "remark-math": "...",
    "mathjax": "...",
    "@codemirror/state": "...",
    "@codemirror/view": "...",
    "@codemirror/lang-markdown": "..."
  },
  "devDependencies": {
    "typescript": "...",
    "@figma/plugin-typings": "...",
    "vite": "...",
    "vitest": "..."
  }
}
```

Exact package versions should be selected when implementation begins.

---

# 32. Manifest Shape

Conceptual example:

```json
{
  "name": "Math Text",
  "id": "PLUGIN_ID",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["none"]
  },
  "relaunchButtons": [
    {
      "command": "edit",
      "name": "Edit Math Text"
    }
  ]
}
```

Bundling MathJax locally allows the MVP to avoid external network access.

---

# 33. UI Design

The UI should be source-first rather than WYSIWYG-first.

Suggested layout:

```text
┌──────────────────────────────────────────┐
│ Math Text                                │
├──────────────────────────────────────────┤
│ Source                                   │
│                                          │
│ The coefficient $\alpha$ determines...   │
│                                          │
│ $$                                       │
│ y = \frac{x^2}{\sqrt{z}}                 │
│ $$                                       │
│                                          │
├──────────────────────────────────────────┤
│ Typography                               │
│ Inter Regular · 16 / 24 · From selection │
│                                          │
│ Width: 480                               │
│ Alignment: Left / Center / Right / Justify · Math follows font size  │
├──────────────────────────────────────────┤
│ Error / preview                          │
├──────────────────────────────────────────┤
│ Cancel                            Apply  │
└──────────────────────────────────────────┘
```

The Figma canvas itself can serve as the final rendering preview.

---

# 34. Error Handling

The plugin must tolerate malformed LaTeX without destroying the existing paragraph.

Recommended behavior:

```text
user edits source
      ↓
parse / MathJax render
      ↓
error?
 ┌────┴────┐
 yes       no
 │          │
show       update
error      Figma
```

Never delete or replace the existing generated paragraph until a new render succeeds.

Possible errors:

- invalid LaTeX,
- unavailable Figma font,
- mixed unsupported typography,
- malformed stored plugin state,
- unsupported Markdown node,
- oversized SVG,
- unexpected MathJax failure.

---

# 35. Versioned Persistence

Stored plugin state should be versioned from day one.

```json
{
  "version": 1,
  "source": "...",
  "width": 480,
  "mathScale": 1
}
```

Future migrations:

```ts
function migrateDocument(
  value: unknown
): MathTextDocument {
  // v1 → v2 → ...
}
```

This prevents future plugin updates from breaking older Figma files.

---


## Current v3 workflow and persistence contract

Current output persists an exact-key **v3** record. It requires canonical source, width,
typography, `inheritTypography`, `mathScale: 1`, `textAlignment`, renderer identity, and a
positive `compiledWidth`. Strict v1 records have neither compiled width nor alignment; strict v2
records have compiled width but no alignment. Both migrate only in memory to v3 with
`textAlignment: "left"` and `mathScale: 1`. v3 also accepts `"justify"` without a version bump. The old node is never written before its replacement
commits.

Create captures the selection once when the command opens, then applies submitted controls; later canvas selection changes do not retarget or overwrite the open editor. Edit keeps its locked replacement target and canonical source,
but uses submitted width, typography, color, and alignment. Reflow initializes persisted settings,
does not auto-render, and only applies after **Apply reflow**. Sync Typography can auto-render: it
reads native prose typography fresh, uses its font, size, and color, and preserves submitted width
and alignment. MathJax is rendered at its 16px em mapping and layout scales it once by
`fontSize / 16`; there is no independent current math scale.

Font inventory is obtained only from `figma.listAvailableFontsAsync()`. Exact pairs are cached;
deduplicated family names arrive asynchronously first, then exact styles are requested only for the
selected family. This avoids globally truncating later alphabetic families such as Roboto. A failed
or empty list leaves the inherited current pair selectable, and inventory messages cannot change
the locked context/token. RGB input
clamps channel conversion, rejects malformed hex, and preserves first-fill opacity.

After native TextNode width reconciliation, every line/display uses final root width `W`: left is
`0`, center is `(W - w) / 2`, and right is `W - w`. Over-wide content is at `0`. The non-clipping
root expands for actual overflow, then all blocks are positioned against that final width.

# 36. Generated Node Metadata

Top-level frame:

```text
pluginData:
  math-text-document
  math-text-version
```

Individual math nodes may optionally store:

```text
latex
display-mode
render-cache-key
```

However, the canonical source should remain on the top-level document/paragraph frame.

Do not rely on reconstructing Markdown by walking generated Figma children.

---

# 37. Layer Naming

Use predictable layer names.

```text
Math Paragraph
├── Line 1
│   ├── Text
│   ├── Math · \alpha
│   └── Text
└── Line 2
    ├── Math · y = \alpha x + \beta
    └── Text
```

For long formulas, truncate names rather than storing the entire formula as the visible layer name.

Example:

```text
Math · \frac{x^2 + ...
```

Full source remains in plugin metadata.

---

# 38. Performance Targets

The plugin should aim for interactive performance for normal design-document workloads.

Typical target:

- 1 paragraph: effectively immediate.
- 10–20 equations: comfortably interactive.
- 100+ small inline equations: handled through caching.
- large documents: render progressively or batch work if needed later.

Important optimization areas:

1. MathJax result caching.
2. Figma text measurement caching.
3. Merging adjacent prose runs.
4. Avoiding unnecessary full document re-renders.
5. Avoiding one node per word.

---

# 39. Security and Privacy

MVP can be fully local.

No source text needs to leave Figma.

Benefits:

- no account required,
- no document upload,
- no cloud storage,
- no LaTeX API,
- no server cost,
- no server latency.

If analytics are added later, they should avoid collecting document content.

---

# 40. Testing Strategy

## Unit tests

### Parser

Test:

```md
$x$
$$x$$
**bold**
*italic*
mixed $\alpha$ text
```

### AST conversion

Ensure remark nodes convert correctly to the application model.

### Line breaking

Test:

- exact-width fits,
- one-word overflow,
- math at line boundary,
- long inline equation,
- punctuation after math,
- mixed bold and normal prose.

### Cache

Verify stable keys and invalidation.

---

## Integration tests

Test controller behavior with mocked Figma APIs where practical.

Flows:

1. select text → initialize plugin,
2. create paragraph,
3. edit existing paragraph,
4. reflow,
5. sync typography,
6. invalid LaTeX,
7. missing font.

---

## Visual regression tests

Particularly important for:

- baseline alignment,
- math scale,
- line spacing,
- inline fractions,
- superscripts,
- subscripts,
- summations,
- roots,
- punctuation around inline math.

---

# 41. MVP Scope

## MVP 1 — Basic renderer

Support:

- Figma plugin shell,
- Markdown editor,
- `$inline math$`,
- `$$display math$$`,
- normal paragraphs,
- selected Figma font inheritance,
- MathJax SVG rendering,
- basic paragraph output.

Success criterion:

> A designer can create a paragraph containing native Figma prose and correctly typeset TeX math.

---

## MVP 2 — Editable generated content

Add:

- pluginData,
- Edit Selected,
- relaunch button,
- source restoration,
- update existing generated nodes.

Success criterion:

> Generated math paragraphs can be reopened and edited without recreating them manually.

---

## MVP 3 — High-quality paragraph compositor

Add:

- proper word wrapping,
- measured Figma typography,
- math baseline metrics,
- merged prose segments,
- consistent line height,
- paragraph width control.

Success criterion:

> Inline equations visually sit inside prose like a professional typesetting system.

---

## MVP 4 — Design workflow quality

Add:

- replace selected text,
- Reflow,
- Sync Typography,
- selection change handling,
- better errors,
- render caching.

Success criterion:

> The tool feels integrated into normal Figma typography workflows.

---

# 42. Main Technical Risks

## 42.1 Baseline mismatch

This is the largest visual risk.

A mathematically correct SVG can still look wrong if its baseline does not align with the surrounding Figma text.

Mitigation:

- treat ascent/descent as first-class metrics,
- build visual regression fixtures,
- calibrate math scale against prose font size.

---

## 42.2 Text metric differences

Browser metrics cannot be assumed to match Figma.

Mitigation:

- use native Figma text measurement,
- cache results.

---

## 42.3 Layer explosion

Breaking every word into a Figma `TextNode` would make files unpleasant.

Mitigation:

- tokenize for measurement,
- merge adjacent final prose fragments per line.

---

## 42.4 Editing semantics

Complex SVG math cannot behave like native Figma editable text.

Mitigation:

- source-based editing,
- clear `Edit Math Text` relaunch action,
- preserve source in pluginData.

---

## 42.5 MathJax bundle size

MathJax is larger than simple renderers.

Mitigation:

- begin with bundled MathJax for correctness,
- later create a custom MathJax build if bundle size becomes important.

---

# 43. Key Architectural Invariants

The implementation should preserve these rules.

### Invariant 1

```text
Outside math delimiters = Figma typography
Inside math delimiters  = TeX typography
```

### Invariant 2

The original Markdown/LaTeX source is canonical.

### Invariant 3

Generated Figma layers are compiled output and may be regenerated.

### Invariant 4

Figma measures prose.

### Invariant 5

MathJax measures and renders math.

### Invariant 6

The layout engine works on measured boxes, not renderer-specific objects.

### Invariant 7

A contiguous LaTeX expression remains one math run.

### Invariant 8

Do not optimize simple LaTeX into Unicode/Figma text if it changes typography consistency.

---

# 44. Architecture Summary

The complete pipeline is:

```text
                 Markdown + LaTeX source
                           │
                           ▼
                  remark / remark-math
                           │
                           ▼
                   application AST
                           │
             ┌─────────────┴─────────────┐
             │                           │
          prose                        math
             │                           │
             ▼                           ▼
      Figma TextNode                 MathJax
       measurement                     │
             │                          ▼
             │                         SVG
             │                          │
             └──────────┬───────────────┘
                        │
                        ▼
                  measured boxes
                        │
                        ▼
                paragraph compositor
                        │
               line break + baseline
                        │
                        ▼
                  Figma layer tree
               ┌────────┴────────┐
               │                 │
         native prose       TeX vectors
               │                 │
               └────────┬────────┘
                        │
                source in pluginData
                        │
                Edit / Reflow later
```

The highest-value and highest-complexity component is the **paragraph compositor**, not the LaTeX renderer or Figma API integration.

The system should therefore optimize architecture and testing around:

- text measurement,
- line breaking,
- baseline alignment,
- source preservation,
- deterministic re-rendering.

---

# 45. Recommended First Implementation Order

1. Create Figma plugin controller + UI messaging.
2. Add source editor.
3. Parse `$...$` and `$$...$$`.
4. Render MathJax SVG in the UI.
5. Import SVG into Figma.
6. Read typography from selected Figma text.
7. Create native prose TextNodes.
8. Store canonical source in pluginData.
9. Implement Edit Selected / relaunch.
10. Build proper text measurement.
11. Build word-level line breaking.
12. Build baseline-aware line composition.
13. Add Reflow.
14. Add Sync Typography.
15. Add caching.
16. Add richer Markdown.

This ordering proves the product concept before spending most of the engineering effort on typography quality.
