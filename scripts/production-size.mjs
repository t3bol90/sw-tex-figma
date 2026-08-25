import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import console from 'node:console';

const dist = resolve('dist');
const expectedFiles = ['code.js', 'ui.html'];
const maxTotalBytes = 15_000_000;
const maxControllerBytes = 1_000_000;
const files = readdirSync(dist).sort();

if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `Expected dist to contain exactly ${expectedFiles.join(', ')}; found ${files.join(', ')}.`,
  );
}

const sizes = Object.fromEntries(
  expectedFiles.map((file) => {
    const path = resolve(dist, file);
    if (!statSync(path).isFile()) throw new Error(`Expected ${file} to be a regular file.`);
    return [file, statSync(path).size];
  }),
);
const totalBytes = sizes['code.js'] + sizes['ui.html'];

if (sizes['code.js'] >= maxControllerBytes) {
  throw new Error(
    `dist/code.js is ${sizes['code.js']} bytes; must stay below ${maxControllerBytes}.`,
  );
}
if (totalBytes >= maxTotalBytes) {
  throw new Error(`dist totals ${totalBytes} bytes; must stay below ${maxTotalBytes}.`);
}

console.log(
  `Production size gate passed: code.js ${sizes['code.js']} bytes, ui.html ${sizes['ui.html']} bytes, total ${totalBytes} bytes.`,
);
