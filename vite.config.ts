import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, lazyPlugins, type Plugin, type UserConfig } from 'vite-plus';

const root = __dirname;
const dist = resolve(root, 'dist');
const uiStage = resolve(root, '.ui-stage');

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
      // Stage the UI then atomically replace only ui.html. Existing code.js remains
      // available to an already-open Figma plugin throughout the UI build.
      mkdirSync(dist, { recursive: true });
      renameSync(resolve(outputDirectory, 'ui.html'), resolve(dist, 'ui.html'));
      rmSync(outputDirectory, { recursive: true, force: true });
    },
  };
}

const lint = {
  plugins: ['oxc', 'typescript', 'unicorn'],
  categories: {
    correctness: 'warn',
  },
  env: {
    builtin: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
  rules: {
    'constructor-super': 'error',
    'for-direction': 'error',
    'getter-return': 'error',
    'no-async-promise-executor': 'error',
    'no-case-declarations': 'error',
    'no-class-assign': 'error',
    'no-compare-neg-zero': 'error',
    'no-cond-assign': 'error',
    'no-const-assign': 'error',
    'no-constant-binary-expression': 'error',
    'no-constant-condition': 'error',
    'no-control-regex': 'error',
    'no-debugger': 'error',
    'no-delete-var': 'error',
    'no-dupe-class-members': 'error',
    'no-dupe-else-if': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-empty': 'error',
    'no-empty-character-class': 'error',
    'no-empty-pattern': 'error',
    'no-empty-static-block': 'error',
    'no-ex-assign': 'error',
    'no-extra-boolean-cast': 'error',
    'no-fallthrough': 'error',
    'no-func-assign': 'error',
    'no-global-assign': 'error',
    'no-import-assign': 'error',
    'no-invalid-regexp': 'error',
    'no-irregular-whitespace': 'error',
    'no-loss-of-precision': 'error',
    'no-misleading-character-class': 'error',
    'no-new-native-nonconstructor': 'error',
    'no-nonoctal-decimal-escape': 'error',
    'no-obj-calls': 'error',
    'no-prototype-builtins': 'error',
    'no-redeclare': 'error',
    'no-regex-spaces': 'error',
    'no-self-assign': 'error',
    'no-setter-return': 'error',
    'no-shadow-restricted-names': 'error',
    'no-sparse-arrays': 'error',
    'no-this-before-super': 'error',
    'no-undef': 'error',
    'no-unexpected-multiline': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'no-unsafe-optional-chaining': 'error',
    'no-unused-labels': 'error',
    'no-unused-private-class-members': 'error',
    'no-unused-vars': 'error',
    'no-useless-backreference': 'error',
    'no-useless-catch': 'error',
    'no-useless-escape': 'error',
    'no-with': 'error',
    'require-yield': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    'no-array-constructor': 'error',
    'no-unused-expressions': 'error',
    'typescript/ban-ts-comment': 'error',
    'typescript/no-duplicate-enum-values': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-extra-non-null-assertion': 'error',
    'typescript/no-misused-new': 'error',
    'typescript/no-namespace': 'error',
    'typescript/no-non-null-asserted-optional-chain': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/no-this-alias': 'error',
    'typescript/no-unnecessary-type-constraint': 'error',
    'typescript/no-unsafe-declaration-merging': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-wrapper-object-types': 'error',
    'typescript/prefer-as-const': 'error',
    'typescript/prefer-namespace-keyword': 'error',
    'typescript/triple-slash-reference': 'error',
    'vite-plus/prefer-vite-plus-imports': 'error',
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
      rules: {
        'constructor-super': 'off',
        'getter-return': 'off',
        'no-class-assign': 'off',
        'no-const-assign': 'off',
        'no-dupe-class-members': 'off',
        'no-dupe-keys': 'off',
        'no-func-assign': 'off',
        'no-import-assign': 'off',
        'no-new-native-nonconstructor': 'off',
        'no-obj-calls': 'off',
        'no-redeclare': 'off',
        'no-setter-return': 'off',
        'no-this-before-super': 'off',
        'no-undef': 'off',
        'no-unreachable': 'off',
        'no-unsafe-negation': 'off',
        'no-var': 'error',
        'no-with': 'off',
        'prefer-const': 'error',
        'prefer-rest-params': 'error',
        'prefer-spread': 'error',
      },
    },
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        'typescript/consistent-type-imports': 'error',
      },
      env: {
        browser: true,
        node: true,
      },
      globals: {
        figma: 'readonly',
        __html__: 'readonly',
      },
    },
  ],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  jsPlugins: [
    {
      name: 'vite-plus',
      specifier: 'vite-plus/oxlint-plugin',
    },
  ],
} satisfies UserConfig['lint'];

const fmt = {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  sortPackageJson: false,
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/'],
} satisfies UserConfig['fmt'];

export default defineConfig(({ mode }) => {
  if (mode === 'code') {
    return {
      lint,
      fmt,
      // Figma controller runs in a worker-like VM. Prefer packages' worker/default exports,
      // never the browser conditional exports that may evaluate DOM code at module load.
      // Figma supplies __html__ from manifest.ui when it starts this controller. Do not define
      // it here: embedding dist/ui.html duplicates the UI in code.js and exceeds Figma's limit.
      resolve: {
        conditions: ['worker'],
      },
      build: {
        emptyOutDir: false,
        // Figma documents ES2020 for the plugin sandbox. Pin it so the minifier never emits
        // newer syntax (for example ES2021 logical assignment) into the controller.
        target: 'es2020',
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
    lint,
    fmt,
    plugins: lazyPlugins(() => [inlineUiAssets()]),
    build: {
      emptyOutDir: true,
      outDir: uiStage,
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
