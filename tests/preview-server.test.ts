import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

import type * as PreviewModuleNs from '../src/server/preview/preview-server.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distPreview = join(repoRoot, 'dist', 'server', 'preview', 'preview-server.js');
const distPublic = join(repoRoot, 'dist', 'public', 'index.html');

const skipUnlessBuilt = !existsSync(distPreview) || !existsSync(distPublic);

// Import the COMPILED preview-server (not the TS source). PUBLIC_DIR is
// computed relative to the file's own location at import-time; under
// vitest with esbuild, the TS source path is src/server/preview/ which
// has no sibling public/ dir. Pointing at dist keeps PUBLIC_DIR aligned
// with dist/public/ where vite emits the viewer bundle.
type PreviewModule = typeof PreviewModuleNs;
let previewModule: PreviewModule;
let handle: PreviewModule extends { startPreviewServer: (...args: never[]) => Promise<infer H> } ? H : never;

describe.skipIf(skipUnlessBuilt)('preview server', () => {
  beforeAll(async () => {
    previewModule = (await import(pathToFileURL(distPreview).href)) as PreviewModule;
    // `startPreviewServer(0)` is awkward: findFreePort returns 0 (a free
    // OS-assigned ephemeral binds successfully then gets released), but
    // the actual listening socket binds to a different ephemeral port,
    // leaving handle.url pointing at port 0. Use a high fixed port and
    // rely on the built-in 50-port walk for collision recovery.
    handle = await previewModule.startPreviewServer(47371);
  }, 15_000);

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
  });

  it('serves index.html at /', async () => {
    const res = await fetch(handle.url);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<!doctype html>/i);
  });

  it('serves index.html at /index.html', async () => {
    const res = await fetch(`${handle.url}index.html`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for missing files', async () => {
    const res = await fetch(`${handle.url}missing-file.js`);
    expect(res.status).toBe(404);
  });

  it('ignores annotation messages tagged with a stale model version', async () => {
    const wsUrl = `${handle.url.replace(/^http/, 'ws')}ws`;
    const origin = new URL(handle.url).origin;
    const host = new URL(handle.url).host;
    const ws = new WebSocket(wsUrl, { headers: { Origin: origin, Host: host } });

    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });

      // Send an annotations payload with a model version the server has
      // never seen (the server starts with modelVersion = 'none' and only
      // changes after push()). Model-version filter is at preview-server.ts:103.
      ws.send(
        JSON.stringify({
          kind: 'annotations',
          modelVersion: 'v-stale-12345',
          items: [
            {
              id: 'a1',
              modelVersion: 'v-stale-12345',
              kind: 'point',
              partLabel: 'point#1',
              note: 'should be dropped',
              worldCoord: [0, 0, 0],
            },
          ],
        }),
      );

      // Give the server a moment to process the (rejected) message.
      await new Promise<void>(resolve => setTimeout(resolve, 50));

      const snap = handle.getAnnotations();
      expect(snap.modelVersion).toBe('none');
      expect(snap.items).toEqual([]);
    } finally {
      await new Promise<void>(resolve => {
        ws.once('close', () => resolve());
        ws.close();
        setTimeout(() => {
          if (ws.readyState !== WebSocket.CLOSED) {
            ws.terminate();
          }
          resolve();
        }, 500);
      });
    }
  });
});
