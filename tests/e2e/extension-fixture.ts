import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test as base, expect } from '@playwright/test';
import type { Canvas, CanvasOptions, JoinSessionConfig } from '@github/copilot-sdk/extension';
import {
  createInMemoryViewerAssetProvider,
  startViewerHost,
  type ViewerAsset,
  type ViewerAssetManifest,
} from '@manifold3d/viewer-host/viewer-host.js';
import { Runner } from '@manifold3d/modeling/runner/host.js';
import { toViewerModelFrame } from '@manifold3d/modeling/runner/model-artifact.js';
import { startCopilotExtension, MANIFOLD_CANVAS_ID } from '../../apps/copilot-extension/src/composition.js';
import type { CopilotExtensionSession, CopilotSdkBoundary } from '../../apps/copilot-extension/src/sdk-boundary.js';

export const MODEL_DESCRIPTION = 'E2E union bracket';
const BRACKET = `
result = Manifold.union([
  Manifold.cube([80, 50, 8], true).translate([0, 0, 4]),
  Manifold.cube([80, 8, 42], true).translate([0, 21, 25]),
  Manifold.cylinder(18, 12, 12, 48, true).translate([-18, -8, 15]),
  Manifold.cylinder(26, 4, 4, 32, true).translate([22, -10, 19]),
]);`;

type AttachmentRequest = Parameters<CopilotExtensionSession['rpc']['extensions']['sendAttachmentsToMessage']>[0];
type SendRequest = Parameters<CopilotExtensionSession['send']>[0];

export interface ExtensionHarness {
  url: string;
  attachments: AttachmentRequest[];
  messages: SendRequest[];
  holdNextAttachment(): { succeed(): void; fail(message: string): void };
  replaceModel(code?: string): Promise<void>;
}

async function productionAssets(): Promise<ViewerAssetManifest> {
  const root = resolve('apps/copilot-extension/build/viewer');
  try {
    await readFile(resolve(root, 'index.html'));
  } catch (cause) {
    throw new Error('Production Viewer assets missing. Use npm run test:e2e to prepare them.', { cause });
  }
  const assets = new Map<string, ViewerAsset>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = resolve(entry.parentPath, entry.name);
      assets.set(relative(root, path).split(sep).join('/'), { bytes: await readFile(path) });
    }
  }
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [resolve('apps/copilot-extension/dist/extension.mjs'), '--self-test'],
    { timeout: 30_000 },
  );
  const report: unknown = JSON.parse(stdout);
  if (
    !report ||
    typeof report !== 'object' ||
    !('verified' in report) ||
    report.verified !== true ||
    !('assets' in report) ||
    !Array.isArray(report.assets)
  ) {
    throw new Error('The built Extension did not verify its embedded Viewer asset manifest.');
  }
  const expected = report.assets.map((asset: unknown) => {
    if (
      !asset ||
      typeof asset !== 'object' ||
      !('path' in asset) ||
      typeof asset.path !== 'string' ||
      !('sha256' in asset) ||
      typeof asset.sha256 !== 'string'
    ) {
      throw new Error('The built Extension returned an invalid Viewer asset digest.');
    }
    return [asset.path, asset.sha256];
  });
  const actual = [...assets].map(([path, asset]) => [path, createHash('sha256').update(asset.bytes).digest('hex')]);
  expect(actual.sort(), 'Viewer assets differ from the shipped Extension; run npm run build:extension.').toEqual(
    expected.sort(),
  );
  return assets;
}

// Same explicit SDK boundary as extension.integration.test.ts, without its stub
// runner/renderer or placeholder HTML. All app, HTTP and WS handlers are real.
export const test = base.extend<
  { extension: ExtensionHarness; localViewer: { url: string } },
  { viewerAssets: ViewerAssetManifest }
>({
  viewerAssets: [
    async ({ browserName: _browserName }, use) => {
      await use(await productionAssets());
    },
    { scope: 'worker' },
  ],
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(page);
    expect(errors, 'Unhandled browser errors').toEqual([]);
  },
  localViewer: async ({ viewerAssets }, use) => {
    const runner = new Runner();
    const host = await startViewerHost({
      assetProvider: createInMemoryViewerAssetProvider(viewerAssets),
      preferredPort: 0,
    });
    try {
      const result = await runner.run({ mode: 'execute', code: BRACKET, description: MODEL_DESCRIPTION });
      expect(result.report.errors).toEqual([]);
      if (!result.artifact) {
        throw new Error('Fixture compilation did not produce a model.');
      }
      const room = host.createRoom();
      room.pushModel(toViewerModelFrame(result.artifact));
      await use({ url: room.url });
    } finally {
      await host.close();
      await runner.dispose();
    }
  },
  extension: async ({ viewerAssets }, use, testInfo) => {
    const attachments: AttachmentRequest[] = [];
    const messages: SendRequest[] = [];
    let nextAttachment: Promise<void> | undefined;
    const pending = new Set<() => void>();
    let canvas: CanvasOptions | undefined;
    let joined: JoinSessionConfig | undefined;
    const workspacePath = testInfo.outputPath('workspace');
    await mkdir(workspacePath, { recursive: true });
    const session: CopilotExtensionSession = {
      workspacePath,
      send(message) {
        messages.push(message);
        return Promise.resolve(`captured-message-${messages.length}`);
      },
      log: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      rpc: {
        extensions: {
          sendAttachmentsToMessage(input) {
            attachments.push(input);
            const response = nextAttachment ?? Promise.resolve();
            nextAttachment = undefined;
            return response;
          },
        },
      },
    };
    const sdk: CopilotSdkBoundary = {
      createCanvas(options) {
        canvas = options;
        return {
          declaration: {
            id: options.id,
            displayName: options.displayName,
            description: options.description,
          },
          open: options.open,
        } as Canvas;
      },
      joinSession(config) {
        joined = config;
        return Promise.resolve(session);
      },
    };
    const application = await startCopilotExtension({
      sdk,
      viewerAssets,
      preferredPort: 0,
      launchExternalUrl: () => Promise.reject(new Error('External navigation is forbidden in browser E2E.')),
    });
    try {
      const execute = async (description: string, code = BRACKET) => {
        const toolName = 'manifold_execute_script';
        const handler = joined?.tools?.find(tool => tool.name === toolName)?.handler;
        if (!handler) {
          throw new Error('Production execute tool was not registered.');
        }
        const result = await handler(
          { code, description },
          { sessionId: 'e2e', toolCallId: description, toolName, arguments: {} },
        );
        expect(result).toMatchObject({ resultType: 'success' });
      };
      if (!canvas) {
        throw new Error('Production Canvas was not registered.');
      }
      const opened = await canvas.open({
        sessionId: 'e2e',
        extensionId: 'test:manifold3d',
        canvasId: MANIFOLD_CANVAS_ID,
        instanceId: 'isolated-e2e',
        host: {},
      });
      if (!opened.url) {
        throw new Error('Production Canvas did not return its Viewer URL.');
      }
      await execute(MODEL_DESCRIPTION);
      await use({
        url: opened.url,
        attachments,
        messages,
        holdNextAttachment() {
          if (nextAttachment) {
            throw new Error('An attachment gate is already queued.');
          }
          let succeed!: () => void;
          let fail!: (reason: Error) => void;
          nextAttachment = new Promise<void>((resolvePromise, reject) => {
            succeed = resolvePromise;
            fail = reject;
          });
          pending.add(succeed);
          return {
            succeed() {
              pending.delete(succeed);
              succeed();
            },
            fail(message) {
              pending.delete(succeed);
              fail(new Error(message));
            },
          };
        },
        replaceModel: code => execute('E2E replacement bracket', code),
      });
    } finally {
      for (const release of pending) {
        release();
      }
      await application.shutdown();
    }
  },
});

export { expect } from '@playwright/test';
