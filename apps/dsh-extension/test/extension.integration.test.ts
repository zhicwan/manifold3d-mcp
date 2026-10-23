import { Buffer } from 'node:buffer';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import {
  ModelingEngine,
  ModelingSession,
  type ModelArtifact,
  type PreviewRenderer,
  type RenderResult,
  type RenderViewOptions,
} from '@manifold3d/modeling/modeling.js';
import { Runner, type RunnerOptions } from '@manifold3d/modeling/runner/host.js';
import type { RunRequest, RunResult } from '@manifold3d/modeling/runner/protocol.js';
import { emptyReport } from '@manifold3d/modeling/validation/report.js';
import { parseAnnotationAttachment } from '@manifold3d/protocol/wire/annotation-attachment.js';
import { createAnnotationsMessage, type WireAnnotation } from '@manifold3d/protocol/wire/annotations.js';
import { createHostActionInvocation } from '@manifold3d/protocol/wire/host-actions.js';
import { startViewerHost } from '@manifold3d/viewer-host/viewer-host.js';

import {
  ATTACH_ANNOTATION_BATCH_ACTION_ID,
  ATTACH_LOCATION_SELECTION_ACTION_ID,
  FIX_ANNOTATION_BATCH_ACTION_ID,
  FIX_ANNOTATION_BATCH_PROMPT,
  FIX_SOURCE_KIND,
  MODEL_EXPORT_ACTION_ID,
  createDshExtension,
  type DshExtension,
} from '../src/composition.js';
import type {
  DshAgent,
  DshHostPorts,
  DshInboxMessage,
  DshToolDefinition,
  DshToolExecution,
} from '../src/dsh-boundary.js';
import { DshToolFailure } from '../src/tools.js';

const testWorkspace = resolve('apps/dsh-extension/.test-workspace');

describe('DeepSeek Harness Extension composition', () => {
  let extension: DshExtension | undefined;

  beforeEach(async () => {
    await rm(testWorkspace, { force: true, recursive: true });
    await mkdir(testWorkspace, { recursive: true });
  });

  afterEach(async () => {
    await extension?.shutdown();
    extension = undefined;
    await rm(testWorkspace, { force: true, recursive: true });
  });

  it('isolates modeling and rooms per session and publishes before commit', async () => {
    const harness = createHarness();
    extension = harness.extension;
    const roomA = await harness.openRoom('session-a', 'tab-1');
    const roomB = await harness.openRoom('session-b', 'tab-1');
    expect((await harness.post('/rooms', { sessionId: 'session-a', tabId: 'tab-1' })).body).toEqual({
      url: roomA.url,
    });
    const clientA = await connect(roomA.url);
    const clientB = await connect(roomB.url);
    try {
      const value = await harness
        .tool('manifold_execute_script')
        .execute({ code: 'result = Manifold.cube(1);', description: 'first' }, harness.exec('session-a'));
      expect(value).toMatchObject({ ok: true, modelRevision: 1 });
      expect((await clientA.messages.waitFor(message => message.kind === 'mesh')).description).toBe('first');
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
      expect(clientB.messages.items.some(message => message.kind === 'mesh')).toBe(false);
      expect(harness.modelingSessions).toHaveLength(1);

      const rendered = harness.tool('manifold_execute_script').output.render({}, value);
      expect(JSON.parse((rendered[0] as { text: string }).text)).toMatchObject({ ok: true });
    } finally {
      clientA.socket.close();
      clientB.socket.close();
    }
  });

  it('reports failed validation as a tool failure without replacing the model', async () => {
    const harness = createHarness({ failValidation: true });
    extension = harness.extension;
    const failure = await harness
      .tool('manifold_validate_script')
      .execute({ code: 'result = 1;' }, harness.exec('session-a'))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DshToolFailure);
    expect((failure as DshToolFailure).body).toMatchObject({ ok: false });
    await expect(
      harness.tool('manifold_validate_script').execute({ code: 'x', filePath: 'a.ts' }, harness.exec('session-a')),
    ).rejects.toThrow(/unsupported field `filePath`/);
  });

  it('returns captures as admitted images, or saved files when the model refuses images', async () => {
    const harness = createHarness();
    extension = harness.extension;
    const capture = harness.tool('manifold_capture_view');
    await expect(capture.execute({}, harness.exec('session-a'))).rejects.toThrow(/NO_MODEL/);

    await harness
      .tool('manifold_execute_script')
      .execute({ code: 'result = Manifold.cube(1);' }, harness.exec('session-a'));
    const exec = harness.exec('session-a');
    const value = await capture.execute({ view: 'front', width: 128, height: 256 }, exec);
    expect(value).toMatchObject({ ok: true, image: 'attached', view: 'front', width: 128, height: 256 });
    const content = capture.projectContent?.(exec, { content: [{ type: 'text', text: JSON.stringify(value) }] });
    expect(content?.[1]).toEqual({ type: 'image', attachment: 'image-ref-1' });

    harness.imageAdmission = { unavailable: 'model "text-only" does not declare image input' };
    const saved = (await capture.execute({}, harness.exec('session-a'))) as { filePath: string; image: string };
    expect(saved.image).toBe('file');
    expect(saved.filePath.startsWith(resolve(testWorkspace, '.manifold3d/captures'))).toBe(true);
    expect((await readFile(saved.filePath)).toString()).toBe('png');
  });

  it('guards room routes by session activity, owner locality and identifier shape', async () => {
    const harness = createHarness();
    extension = harness.extension;
    expect((await harness.post('/rooms', { sessionId: 'unknown', tabId: 'tab-1' })).status).toBe(409);
    expect((await harness.post('/rooms', { sessionId: '../x', tabId: 'tab-1' })).status).toBe(400);
    harness.remote = true;
    expect((await harness.post('/rooms', { sessionId: 'session-a', tabId: 'tab-1' })).status).toBe(403);
    harness.remote = false;
    const room = await harness.openRoom('session-a', 'tab-1');
    expect((await harness.request('DELETE', '/rooms', { sessionId: 'session-a', tabId: 'tab-1' })).status).toBe(204);
    expect((await fetch(room.url)).status).toBe(404);
    expect((await harness.request('GET', '/insertions', { sessionId: 'session-a', tabId: 'tab-1' })).status).toBe(404);
  });

  it('closes a room whose tab was deleted while the Viewer Host was starting', async () => {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>(resolvePromise => {
      started = resolvePromise;
    });
    const harness = createHarness({
      startViewerHost: async hostOptions => {
        started?.();
        await new Promise<void>(resolvePromise => {
          release = resolvePromise;
        });
        return startViewerHost(hostOptions);
      },
    });
    extension = harness.extension;
    const opening = harness.post('/rooms', { sessionId: 'session-a', tabId: 'tab-1' });
    await startedPromise;
    expect((await harness.request('DELETE', '/rooms', { sessionId: 'session-a', tabId: 'tab-1' })).status).toBe(204);
    release?.();
    expect((await opening).status).toBe(409);
    expect((await harness.post('/rooms', { sessionId: 'session-a', tabId: 'tab-1' })).status).toBe(200);
  });

  it('queues Fix once as a follow-up and never inserts composer content', async () => {
    const harness = createHarness();
    extension = harness.extension;
    await harness
      .tool('manifold_execute_script')
      .execute({ code: 'result = Manifold.cube(1);' }, harness.exec('session-a'));
    const room = await harness.openRoom('session-a', 'tab-1');
    const client = await connect(room.url);
    try {
      const modelVersion = await currentModelVersion(client);
      await commitAnnotations(client, modelVersion, [pointAnnotation('a1', modelVersion, 'Make it taller')]);
      const invocation = {
        requestId: 'fix-1',
        actionId: FIX_ANNOTATION_BATCH_ACTION_ID,
        modelVersion,
        annotationRevision: 1,
        annotationIds: ['a1'],
        input: { batchId: 'batch-1', markerNumbers: [1] },
      };
      expect(await invokeAction(client, invocation, 'succeeded')).toMatchObject({
        message: 'Fix for 1 annotation was queued for the agent.',
      });
      client.socket.send(JSON.stringify(createHostActionInvocation(invocation)));
      await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
      expect(harness.followups).toHaveLength(1);
      const message = harness.followups[0]!;
      expect(message.source).toEqual({ kind: FIX_SOURCE_KIND });
      const text = message.content[0]!.text;
      expect(text.startsWith(FIX_ANNOTATION_BATCH_PROMPT)).toBe(true);
      expect(parseAnnotationAttachment(JSON.parse(text.slice(FIX_ANNOTATION_BATCH_PROMPT.length)))).toMatchObject({
        mode: 'annotation-batch',
        batchId: 'batch-1',
      });
      expect(await readdirOrEmpty(resolve(testWorkspace, '.manifold3d'))).toEqual([]);

      harness.agents.delete('session-a');
      expect(await invokeAction(client, { ...invocation, requestId: 'fix-2' }, 'failed')).toMatchObject({
        message: expect.stringMatching(/not active/),
      });
    } finally {
      client.socket.close();
    }
  });

  it('attaches a static snapshot file through one acknowledged composer insertion', async () => {
    const harness = createHarness();
    extension = harness.extension;
    await harness
      .tool('manifold_execute_script')
      .execute({ code: 'result = Manifold.cube(1);' }, harness.exec('session-a'));
    const room = await harness.openRoom('session-a', 'tab-1');
    const client = await connect(room.url);
    try {
      const modelVersion = await currentModelVersion(client);
      await commitAnnotations(client, modelVersion, [
        pointAnnotation('a1', modelVersion, 'Use this face'),
        pointAnnotation('loc', modelVersion, ''),
      ]);
      const address = { sessionId: 'session-a', tabId: 'tab-1' };
      // Numbering continues after existing snapshots instead of overwriting them.
      await mkdir(resolve(testWorkspace, '.manifold3d'), { recursive: true });
      await writeFile(resolve(testWorkspace, '.manifold3d/notes-0.json'), '{}\n');
      const poll = harness.request('GET', '/insertions', address);
      const attach = invokeAction(
        client,
        {
          requestId: 'attach-1',
          actionId: ATTACH_ANNOTATION_BATCH_ACTION_ID,
          modelVersion,
          annotationRevision: 1,
          annotationIds: ['a1'],
          input: { batchId: 'batch-1', markerNumbers: [1] },
        },
        'succeeded',
      );
      const insertion = (await poll).body as { id: string; text: string };
      expect(insertion.text).toBe('@.manifold3d/notes-1.json ');
      const filePath = resolve(testWorkspace, insertion.text.slice(1).trim());
      expect(parseAnnotationAttachment(JSON.parse(await readFile(filePath, 'utf8')))).toMatchObject({
        mode: 'annotation-batch',
      });
      expect((await harness.post('/insertions/ack', { ...address, id: insertion.id, ok: true })).status).toBe(204);
      expect(await attach).toMatchObject({
        resultDetails: { kind: 'annotations-attached', count: 1 },
      });
      expect(harness.followups).toHaveLength(0);

      const refusedPoll = harness.request('GET', '/insertions', address);
      const refused = invokeAction(
        client,
        {
          requestId: 'attach-2',
          actionId: ATTACH_LOCATION_SELECTION_ACTION_ID,
          modelVersion,
          annotationRevision: 1,
          annotationIds: ['loc'],
          input: { markerNumbers: [2] },
        },
        'failed',
      );
      const second = (await refusedPoll).body as { id: string; text: string };
      expect(second.text).toBe('@.manifold3d/loc-1.json ');
      await harness.post('/insertions/ack', { ...address, id: second.id, ok: false, error: 'composer busy' });
      expect(await refused).toMatchObject({ message: expect.stringMatching(/composer busy/) });
      await expect(access(resolve(testWorkspace, second.text.slice(1).trim()))).rejects.toThrow();
    } finally {
      client.socket.close();
    }
  });

  it('fails an attachment that no Viewer tab picks up', async () => {
    const harness = createHarness({ insertionTimeoutMs: 50 });
    extension = harness.extension;
    await harness
      .tool('manifold_execute_script')
      .execute({ code: 'result = Manifold.cube(1);' }, harness.exec('session-a'));
    const room = await harness.openRoom('session-a', 'tab-1');
    const client = await connect(room.url);
    try {
      const modelVersion = await currentModelVersion(client);
      await commitAnnotations(client, modelVersion, [pointAnnotation('loc', modelVersion, '')]);
      expect(
        await invokeAction(
          client,
          {
            requestId: 'attach-timeout',
            actionId: ATTACH_LOCATION_SELECTION_ACTION_ID,
            modelVersion,
            annotationRevision: 1,
            annotationIds: ['loc'],
            input: { markerNumbers: [1] },
          },
          'failed',
        ),
      ).toMatchObject({ message: expect.stringMatching(/did not respond/) });
      expect(await readdirOrEmpty(resolve(testWorkspace, '.manifold3d'))).toEqual([]);
    } finally {
      client.socket.close();
    }
  });

  it('exports into the session workspace and releases modeling when the agent is disposed', async () => {
    const harness = createHarness();
    extension = harness.extension;
    await harness
      .tool('manifold_execute_script')
      .execute({ code: 'result = Manifold.cube(1);', description: 'part' }, harness.exec('session-a'));
    const room = await harness.openRoom('session-a', 'tab-1');
    const client = await connect(room.url);
    try {
      const modelVersion = await currentModelVersion(client);
      const status = await invokeAction(
        client,
        {
          requestId: 'export-1',
          actionId: MODEL_EXPORT_ACTION_ID,
          modelVersion,
          annotationRevision: 0,
          input: { format: 'glb' },
        },
        'succeeded',
      );
      const exported = resolve(testWorkspace, 'exports/part-r1.glb');
      expect(status).toMatchObject({ resultDetails: { kind: 'model-saved', format: 'glb', path: exported } });
      expect((await readFile(exported)).byteLength).toBeGreaterThan(0);
    } finally {
      client.socket.close();
    }
    await harness.extension.agentDisposed('session-a');
    expect(harness.runners[0]?.disposeCalls).toBe(1);
    await expect(harness.tool('manifold_capture_view').execute({}, harness.exec('session-a'))).rejects.toThrow(
      /NO_MODEL/,
    );
  });
});

interface HarnessOptions {
  startViewerHost?: typeof startViewerHost;
  failValidation?: boolean;
  insertionTimeoutMs?: number;
}

function createHarness(options: HarnessOptions = {}) {
  const followups: DshInboxMessage[] = [];
  const agents = new Map<string, DshAgent>();
  for (const id of ['session-a', 'session-b']) {
    agents.set(id, {
      session: { id },
      followup: message => {
        followups.push(message);
      },
    });
  }
  const runners: StubRunner[] = [];
  const modelingSessions: ModelingSession[] = [];
  let imageCount = 0;
  const state = {
    remote: false,
    imageAdmission: undefined as undefined | { unavailable: string },
  };
  const ports: DshHostPorts = {
    getAgent: sessionId => agents.get(sessionId),
    workingDirectory: () => testWorkspace,
    allowsRemoteAuthorities: () => state.remote,
    admitImage: () => {
      if (state.imageAdmission) {
        return Promise.resolve(state.imageAdmission);
      }
      imageCount += 1;
      return Promise.resolve({ block: { type: 'image' as const, attachment: `image-ref-${imageCount}` } });
    },
  };
  const extension = createDshExtension({
    ports,
    viewerAssets: new Map([
      ['index.html', { bytes: Buffer.from('<!doctype html><title>test</title>') }],
      ['assets/app.js', { bytes: Buffer.from('export {};'), contentType: 'text/javascript; charset=utf-8' }],
    ]),
    frameAncestors: ['http://127.0.0.1:1', 'dsh-app://app'],
    launchExternalUrl: vi.fn(() => Promise.resolve()),
    preferredPort: 0,
    ...(options.startViewerHost ? { startViewerHost: options.startViewerHost } : {}),
    timings: { insertionTimeoutMs: options.insertionTimeoutMs ?? 5_000, insertionPollMs: 5_000 },
    createModelingSession: () => {
      const runner = new StubRunner(options.failValidation === true);
      runners.push(runner);
      const session = new ModelingSession(new ModelingEngine(runner, new StubRenderer()));
      modelingSessions.push(session);
      return session;
    },
  });

  const request = async (
    method: string,
    path: string,
    query: Record<string, string>,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> => {
    const route = extension.routes.find(candidate => candidate.path === `/api/manifold3d${path}`);
    if (!route || !route.methods.includes(method)) {
      throw new Error(`No route ${method} ${path}`);
    }
    const url = new URL(`http://127.0.0.1/api/manifold3d${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const response = await route.fetch(
      new Request(url, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : undefined };
  };

  return {
    extension,
    followups,
    agents,
    runners,
    modelingSessions,
    get remote() {
      return state.remote;
    },
    set remote(value: boolean) {
      state.remote = value;
    },
    get imageAdmission() {
      return state.imageAdmission;
    },
    set imageAdmission(value: undefined | { unavailable: string }) {
      state.imageAdmission = value;
    },
    request,
    post: (path: string, body: Record<string, unknown>) => request('POST', path, {}, body),
    async openRoom(sessionId: string, tabId: string): Promise<{ url: string }> {
      const response = await request('POST', '/rooms', {}, { sessionId, tabId });
      expect(response.status).toBe(200);
      return response.body as { url: string };
    },
    tool(name: string): DshToolDefinition {
      const tool = extension.tools.find(candidate => candidate.name === name);
      if (!tool) {
        throw new Error(`Tool ${name} was not registered.`);
      }
      return tool;
    },
    exec(sessionId: string): DshToolExecution {
      const agent = agents.get(sessionId);
      return { ...(agent ? { agent } : {}), signal: new AbortController().signal };
    },
  };
}

class StubRunner extends Runner {
  disposeCalls = 0;

  constructor(private readonly failValidation: boolean) {
    super();
  }

  override run(request: RunRequest, _options: RunnerOptions = {}): Promise<RunResult> {
    if (request.mode === 'validate') {
      const report = emptyReport();
      if (this.failValidation) {
        return Promise.resolve({
          report: {
            ...report,
            ok: false,
            errors: [{ code: 'RUNTIME_ERROR', message: 'boom', severity: 'error' }],
          } as unknown as RunResult['report'],
        });
      }
      return Promise.resolve({ report });
    }
    return Promise.resolve({ report: emptyReport(), artifact: artifact(request.description) });
  }

  override dispose(): Promise<void> {
    this.disposeCalls += 1;
    return Promise.resolve();
  }
}

class StubRenderer implements PreviewRenderer {
  renderView(_model: ModelArtifact, options: RenderViewOptions = {}): Promise<RenderResult> {
    return Promise.resolve({ png: Buffer.from('png'), width: options.width ?? 1024, height: options.height ?? 1024 });
  }

  dispose(): void {
    // Nothing to release in the stub.
  }
}

function artifact(description?: string): ModelArtifact {
  return {
    ...(description !== undefined ? { description } : {}),
    numProp: 3,
    triangles: 4,
    vertices: 4,
    features: [
      {
        label: 'unknown#1',
        kind: 'unknown',
        params: {},
        transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      },
    ],
    vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 30]).buffer,
    triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]).buffer,
    mergeFromVert: new Uint32Array().buffer,
    mergeToVert: new Uint32Array().buffer,
    triFeatureIds: new Uint32Array(4).buffer,
    volume: 1000,
    surfaceArea: 600,
    genus: 0,
    bboxMin: [0, 0, 0],
    bboxMax: [10, 20, 30],
  };
}

function pointAnnotation(id: string, modelVersion: string, note: string): WireAnnotation {
  return { id, modelVersion, kind: 'point', partLabel: 'point#1', note, worldCoord: [1, 2, 3] };
}

async function readdirOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function currentModelVersion(client: RoomClient): Promise<string> {
  const message = await client.messages.waitFor(
    candidate => candidate.kind === 'model_version' && candidate.modelVersion !== 'none',
  );
  return String(message.modelVersion);
}

async function commitAnnotations(client: RoomClient, modelVersion: string, items: WireAnnotation[]): Promise<void> {
  client.socket.send(JSON.stringify(createAnnotationsMessage(modelVersion, 1, items)));
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, 20));
}

async function invokeAction(
  client: RoomClient,
  input: Parameters<typeof createHostActionInvocation>[0],
  state: 'succeeded' | 'failed',
): Promise<Record<string, unknown>> {
  const message = createHostActionInvocation(input);
  client.socket.send(JSON.stringify(message));
  return client.messages.waitFor(
    candidate =>
      candidate.kind === 'host_action_status' && candidate.requestId === message.requestId && candidate.state === state,
  );
}

interface RoomClient {
  socket: WebSocket;
  messages: MessageCollector;
}

class MessageCollector {
  readonly items: Array<Record<string, unknown>> = [];
  private readonly listeners = new Set<() => void>();

  push(message: Record<string, unknown>): void {
    this.items.push(message);
    for (const listener of this.listeners) {
      listener();
    }
  }

  waitFor(predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const existing = this.items.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(check);
        reject(
          new Error(
            `Timed out waiting for Viewer Host message. Received: ${JSON.stringify(
              this.items.map(message => ({ kind: message.kind, state: message.state, message: message.message })),
            )}`,
          ),
        );
      }, 10_000);
      const check = (): void => {
        const match = this.items.find(predicate);
        if (match) {
          clearTimeout(timeout);
          this.listeners.delete(check);
          resolvePromise(match);
        }
      };
      this.listeners.add(check);
    });
  }
}

async function connect(url: string): Promise<RoomClient> {
  const messages = new MessageCollector();
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}ws`, { origin: new URL(url).origin });
  socket.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      return;
    }
    const parsed: unknown = JSON.parse(rawDataToString(data));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      messages.push(parsed as Record<string, unknown>);
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    socket.once('open', resolvePromise);
    socket.once('error', reject);
  });
  await messages.waitFor(message => message.kind === 'host_actions_manifest');
  return { socket, messages };
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
}
