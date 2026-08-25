# Native Figma prose measurement

`measureTextWithFigma` measures unwrapped prose with a temporary native Figma
`TextNode`. It loads the effective font, applies font name, font size, line
height, letter spacing, fills, and `WIDTH_AND_HEIGHT` auto resize, then sets the
characters. Its `width` and `height` are exactly the bounds reported by that
node. The node is always removed in `finally`.

This is deliberately not a browser/canvas measurement. It has no baseline,
ascent, or descent result because Figma does not expose those as a reliable
native prose measurement API. Consumers must not treat a heuristic as measured
fact. Baseline calibration and paragraph-compositor policy are explicit
contracts.

`FigmaTextMeasurer` caches successful bounds with a bounded LRU cache. The key
contains text, effective font family/style, size, line height, letter spacing,
and the optional marked-run font-resolution input. Failed measurements are not
cached. Call `clear()` after an external typography invalidation.
