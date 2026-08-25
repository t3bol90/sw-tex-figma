# Paragraph compositor contract

`src/layout` is renderer-independent. It takes the application AST, PR 3
`RenderedMathPayload` objects, and an injected async native text measurement
function. It does not create Figma nodes and does not import Figma, React, DOM,
canvas, remark, or MathJax engine APIs.

## Public API

- `tokenizeParagraph(paragraph)` emits prose, separator, atomic math, and hard
  break tokens in source order.
- `measureParagraph` / `measureDocument` invoke `NativeTextMeasurer` for prose
  and validate occurrence-ordered math payloads. A callback can receive marks
  and a host-supplied `FontResolution`; the compositor never invents a bold or
  italic font.
- `composeParagraph` returns `ParagraphPlan` / `LinePlan` / `LineChild` with
  x/y, width, ascent, descent, height, and baseline. `composeMeasuredParagraph`
  supplies the calibrated empty-line fallback. `measureDocument.blocks` preserves
  paragraph/display-math AST order for renderer traversal; filtered arrays remain
  convenience views.
- `validateRenderedMathPayloads` fails with `MathPayloadValidationError` for a
  missing, extra, mismatched latex/display payload, or invalid metric.

## Whitespace and wrapping

Legal soft breaks occur only at actual ordinary whitespace: tab, CR/LF, U+0020,
U+1680, U+2000–U+200A, U+2028, U+2029, U+205F, and U+3000. NBSP (U+00A0), narrow
NBSP (U+202F), and word joiner are content, not separators. Parser-normalized
soft Markdown newlines are therefore ordinary U+0020 separators.

Separator runs retain exact source text and marks when they remain inside a
line. They are held pending while wrapping, then dropped at a line end and at a
wrapped (or initial) line start. This prevents a trailing separator width from
rejecting a word that fits and never begins a line with collapsible whitespace.
The MVP does not CSS-collapse multiple ordinary spaces/tabs inside a line:
native text receives their exact source sequence. A CommonMark `break` always
emits a forced line, including leading, trailing, and consecutive empty lines.

No whitespace means no legal break, across application run or mark boundaries.
Thus text adjacent to math and punctuation immediately after math remain glued.
Math is one indivisible box. An over-wide glued group, word, or math box is
placed alone (or remains with its glued neighbors) as deterministic overflow;
it is never split.

The breaker is greedy and accepts `candidateWidth <= width + 1e-6` by default.
The tolerance can be configured only to absorb floating-point noise.

## Vertical calibration and math scale

PR 4 returns only native prose width/height. `DEFAULT_PROSE_BASELINE_CALIBRATION`
is expressly an estimate, not a Figma-measured ascent/descent. Its 0.8em ascent
ratio uses `emHeight = min(measuredHeight, fontSize)`,
`leading = max(0, measuredHeight - fontSize)`, and:

```text
ascent  = emHeight * 0.8 + leading / 2
descent = measuredHeight - ascent
```

The ratio is validated to be strictly between zero and one and can be replaced
by future visual calibration. Empty forced lines use configured line height, or
`1.2 * fontSize` for AUTO, through the same estimate.

PR 3 payload metrics and normalized SVG dimensions are already in a 16px-em
coordinate system and already include `mathScale`. The compositor converts once
to selected prose coordinates with `svgScale = typography.fontSize / 16`:

```text
layoutMathMetric = payload.metrics * svgScale
importedSvgScale = svgScale
```

PR 6 must import the PR 3 SVG at `importedSvgScale`; it must not apply
`mathScale` again. Line ascent/descent are maxima of child values; each child
uses `y = lineTop + lineAscent - child.ascent`.

## Merge / kerning contract

After break decisions, adjacent compatible prose and separator fragments merge
only with equal marks and font resolution. A math child is always a merge
barrier. Plan widths remain the deterministic sum of the independently measured
parts. If a renderer remeasures merged text to account for cross-fragment
kerning, it must retain compositor x positions/break decisions (or request a
new composition with measurements at its chosen granularity); it must not
silently use remeasured widths to shift later plan children.
