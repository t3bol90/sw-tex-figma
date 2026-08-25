import { unified } from 'unified';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';

import type { MathTextDocument } from '../shared/document-model';
import { mdastToDocument } from './mdast-to-document';

const markdownParser = unified().use(remarkParse).use(remarkMath);

/** Parse supported Markdown and TeX delimiters into the application document model. */
export const parseMarkdown = (source: string): MathTextDocument =>
  mdastToDocument(markdownParser.parse(source), source);
