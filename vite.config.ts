import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, type Plugin } from 'vite';

const root = __dirname;
const dist = resolve(root, 'dist');

function findHtmlFile(directory: string): string | undefined {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findHtmlFile(path);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      return path;
    }
  }
  return undefined;
}

function inlineUiAssets(): Plugin {
  return {
    name: 'inline-figma-ui-assets',
    writeBundle(outputOptions) {
      const outputDirectory = outputOptions.dir ?? dist;
      const sourceHtmlPath = findHtmlFile(outputDirectory);
      if (!sourceHtmlPath) throw new Error('Expected Vite to emit a UI HTML file.');

      const usedAssets: string[] = [];
      const inlineAsset = (assetPath: string): string => {
        const localPath = resolve(outputDirectory, assetPath.replace(/^\//, ''));
        usedAssets.push(localPath);
        return readFileSync(localPath, 'utf8');
      };

      let html = readFileSync(sourceHtmlPath, 'utf8');
      html = html.replace(
        /<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)><\/script>/g,
        (_match: string, before: string, source: string, after: string) =>
          `<script${before}${after}>${inlineAsset(source)}</script>`,
      );
      html = html.replace(
        /<link([^>]*)\srel=["']stylesheet["']([^>]*)\shref=["']([^"']+)["']([^>]*)>/g,
        (_match: string, before: string, middle: string, source: string) =>
          `<style${before}${middle}>${inlineAsset(source)}</style>`,
      );

      writeFileSync(resolve(outputDirectory, 'ui.html'), html);
      if (sourceHtmlPath !== resolve(outputDirectory, 'ui.html')) rmSync(sourceHtmlPath);
      for (const assetPath of usedAssets) rmSync(assetPath);
      // Vite leaves these empty staging folders after inline assembly; Figma only needs two files.
      rmSync(resolve(outputDirectory, 'assets'), { recursive: true, force: true });
      rmSync(resolve(outputDirectory, 'src'), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'code') {
    const uiHtml = readFileSync(resolve(dist, 'ui.html'), 'utf8');

    return {
      define: {
        __html__: JSON.stringify(uiHtml),
      },
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(root, 'src/code.ts'),
          formats: ['iife'],
          name: 'MathTextPlugin',
          fileName: () => 'code.js',
        },
      },
    };
  }

  return {
    plugins: [inlineUiAssets()],
    build: {
      emptyOutDir: true,
      outDir: dist,
      // The one-file Figma iframe deliberately embeds MathJax and local SVG font tables.
      chunkSizeWarningLimit: 13_000,
      rollupOptions: {
        input: resolve(root, 'src/ui.html'),
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
          entryFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
  };
});
