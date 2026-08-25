# Paragraph compositor contract

`src/layout` is renderer-independent. It takes the application AST,
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

## Vertical calibration and typography-coupled math size

Native Figma text measurement returns only prose width/height.
`DEFAULT_PROSE_BASELINE_CALIBRATION`
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

Math payload metrics and normalized SVG dimensions are already in a 16px-em
coordinate system at the fixed current `mathScale: 1`. The compositor converts once
to selected prose coordinates with `svgScale = typography.fontSize / 16`:

```text
layoutMathMetric = payload.metrics * svgScale
importedSvgScale = svgScale
```

The renderer imports the normalized SVG at `importedSvgScale`; it must not
apply an additional scale again. Line ascent/descent are maxima of child values; each child
uses `y = lineTop + lineAscent - child.ascent`.

## Merge / kerning contract

Ordinary U+0020 spaces are special only when a final merged native TextNode ends
before math: Figma can report their standalone/terminal ink width as zero. The
controller measures U+00A0 (NBSP) in the exact effective Figma font, size, and
letter spacing as an advance-preserving probe. If NBSP also reports zero, it
uses measured `H H` minus `HH`; no fixed gap is invented. This per-space result
replaces the separator token's native width rather than adding to it, so letter
spacing is applied once. Tabs and other breakable whitespace retain their native
measurement. NBSP in source is non-breakable prose content, not a probe or
separator.

After break decisions, adjacent compatible prose and separator fragments merge
only with equal marks, font resolution, and effective-font baseline calibration.
A math child is always a merge barrier. Plan widths remain deterministic fragment
sums for break decisions. The final renderer deliberately remeasures each merged
native TextNode and advances later siblings from its actual Figma width, so
kerning and letter spacing cannot create a gap or overlap. This reconciliation
never changes the selected break, source order, or math/mark boundaries.

## Final-node reconciliation

Break decisions still use Figma measurements of tokenizer fragments, so a render cannot silently reflow source order. After each compatible merged prose segment is created, the renderer uses that final native `TextNode.width` (including Figma kerning and letter spacing) as the line cursor advance. Every later math/prose child on that line is positioned from that actual cursor. The Line, Paragraph, and root frame widths are then resized from actual child extents and persisted as `compiledWidth`; transparent frames never clip overflow.

Vertical placement uses each exact MathJax ascent and a typography-keyed reference-glyph calibration for prose. The final native text height is recalibrated before a line's max ascent/descent is taken. This changes later line coordinates only through their actual preceding line height, never through a fixed centering offset.

## MathJax fragment normalization

The lite MathJax adaptor may serialize adjacent SVG siblings separated by `mjx-break`; they are one delimiter span, not independent layers. The math pipeline composes them into one SVG/viewBox before measuring or Figma import. This prevents a greedy first-SVG extraction from rendering only `\alpha` from `\alpha + \beta`.

For a final prose node ending in ordinary source whitespace immediately before math, Figma may omit the trailing whitespace advance from its ink-bound `width`. The renderer adds only the independently Figma-measured final separator advance to the actual merged visible-ink width. This explicitly assumes the observed Figma auto-width behavior that omits terminal separators from ink bounds; it never restores the whole planned segment, so kerning reconciliation remains intact.

## Justified alignment

`justify` is the fourth `TextAlignment` mode. It applies only to non-final,
soft-wrapped paragraph lines that are narrower than the requested paragraph
width and contain retained source separator tokens. Each separator run is one
expandable gap, including a source space next to inline math. The compositor
keeps those gaps at native-text boundaries; after Figma has reported every
merged TextNode width, the renderer divides the positive remainder equally
across the eligible gaps. It never scales glyphs or SVG math.

Final paragraph lines, CommonMark hard-break terminal lines, blank lines,
over-wide lines, lines without separators, and display math keep natural width.
`justify` is a valid v3 persistence value, so the schema version remains 3;
v1/v2 migration still explicitly defaults to `left`.
