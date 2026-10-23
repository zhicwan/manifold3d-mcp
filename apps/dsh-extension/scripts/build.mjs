import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { bundleApplication } from '../../../scripts/bundle-application.mjs';

const appRoot = resolve(import.meta.dirname, '..');
const result = await bundleApplication({
  entryFile: resolve(appRoot, 'src/entry.ts'),
  outputFile: resolve(appRoot, 'dist/index.js'),
  viewerRoot: resolve(appRoot, 'build/viewer'),
  minify: process.env.MANIFOLD_EXTENSION_DEBUG_BUNDLE !== '1',
});
await rm(resolve(appRoot, 'build'), { force: true, recursive: true });
process.stdout.write(`${JSON.stringify({ output: 'apps/dsh-extension/dist/index.js', ...result })}\n`);
