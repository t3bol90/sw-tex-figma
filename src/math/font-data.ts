/**
 * MathJax v4 normally lazy-loads these font tables. The Figma iframe has no
 * server or network access, so this module statically bundles every NewCM SVG
 * table. `installBundledFontData` applies those tables to one local font.
 */
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/PUA.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/accents.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/accents-b-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/arabic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/arrows.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/braille.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/braille-d.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/cherokee.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic-ss.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/devanagari.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/greek-ss.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/hebrew.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-bi.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/marrows.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-ex.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-l.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/mshapes.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics-ss.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-b.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-bi.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-ex.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-r.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols-b-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js';

import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';

interface DynamicFile {
  readonly setup: (font: MathJaxNewcmFont) => void;
}

interface DynamicFontClass {
  readonly dynamicFiles: Record<string, DynamicFile>;
}

export function installBundledFontData(font: MathJaxNewcmFont): void {
  const fontClass = MathJaxNewcmFont as unknown as DynamicFontClass;
  for (const file of Object.values(fontClass.dynamicFiles)) file.setup(font);
}
