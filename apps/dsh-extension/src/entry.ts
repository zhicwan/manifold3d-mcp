import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, workerData } from 'node:worker_threads';

import { ModelingEngine, ModelingSession } from '@manifold3d/modeling/modeling.js';
import { Runner } from '@manifold3d/modeling/runner/host.js';
import { startModelingWorker } from '@manifold3d/modeling/runner/worker.js';
import {
  embeddedManifoldWasmBase64,
  embeddedTypeScriptLibBase64,
  embeddedViewerAssets,
} from 'virtual:manifold-resources';

import { createDshExtension } from './composition.js';
import type { DshAgent, DshFetchRoute, DshHostPorts, DshToolDefinition, DshToolExecution } from './dsh-boundary.js';
import { launchExternalUrl } from './external-url.js';
import { parseSkillDocument } from './skill.js';

/** The Desktop shell document origin; the Web GUI origin comes from `webServer`. */
export const DSH_DESKTOP_ORIGIN = 'dsh-app://app';
const SKILL_DIRECTORY = 'skills/use-manifold-dsh';

// The bundled file is also the model Worker entry. Dispatch on the explicit
// role, not isMainThread: the Harness may itself load plugins off the main thread.
if (!isMainThread && workerData?.role === 'model-worker') {
  if (!(workerData.wasmBinary instanceof Uint8Array) || typeof workerData.typescriptLibDeclarations !== 'string') {
    throw new Error('Invalid model-worker bootstrap data.');
  }
  void startModelingWorker({
    wasmBinary: workerData.wasmBinary,
    typescriptLibDeclarations: workerData.typescriptLibDeclarations,
  });
}

interface CordisContext {
  get(name: string): unknown;
  on(event: string, listener: (payload: unknown) => unknown): () => void;
  effect(execute: () => () => unknown, label?: string): void;
  readonly logger?: { warn(message: string): void };
  readonly tools: { register(definition: DshToolDefinition): () => void };
  readonly connection: {
    readonly allowsRemoteAuthorities: boolean;
    readonly fetch: { register(route: DshFetchRoute): () => void };
  };
  readonly agents: { get(sessionId: string): DshAgent | undefined };
  readonly workingDirectory: { get(session: unknown): string };
}

interface ImageCapableAgent extends DshAgent {
  readonly options?: { provider?: string; model?: string };
  readonly session: DshAgent['session'] & {
    requestHeader?(): { config?: { provider?: string; model?: string } } | undefined;
  };
}

export const inject = ['tools', 'connection', 'agents', 'workingDirectory'];

export function apply(ctx: CordisContext): void {
  const wasmBinary = Buffer.from(embeddedManifoldWasmBase64, 'base64');
  const typescriptLibDeclarations = Buffer.from(embeddedTypeScriptLibBase64, 'base64').toString('utf8');
  const extension = createDshExtension({
    ports: createPorts(ctx),
    viewerAssets: embeddedViewerAssets,
    frameAncestors: frameAncestors(ctx),
    manifoldWasmBytes: wasmBinary,
    launchExternalUrl,
    createModelingSession: () =>
      new ModelingSession(
        new ModelingEngine(
          new Runner({
            workerFilename: import.meta.url,
            workerData: { role: 'model-worker', wasmBinary, typescriptLibDeclarations },
          }),
        ),
      ),
  });

  for (const tool of extension.tools) {
    ctx.effect(() => ctx.tools.register(tool), `manifold3d: tool ${tool.name}`);
  }
  for (const route of extension.routes) {
    ctx.effect(() => ctx.connection.fetch.register(route), `manifold3d: route ${route.path}`);
  }
  ctx.on('agent/disposed', payload => {
    const sessionId = disposedSessionId(payload);
    if (sessionId !== undefined) {
      extension.agentDisposed(sessionId).catch((error: unknown) => {
        ctx.logger?.warn(`manifold3d: releasing session ${sessionId} failed: ${String(error)}`);
      });
    }
  });
  registerSkill(ctx);
  ctx.effect(() => () => extension.shutdown(), 'manifold3d: shutdown');
}

function createPorts(ctx: CordisContext): DshHostPorts {
  return {
    getAgent: sessionId => ctx.agents.get(sessionId),
    workingDirectory: agent => ctx.workingDirectory.get(agent.session),
    allowsRemoteAuthorities: () => ctx.connection.allowsRemoteAuthorities,
    admitImage: (exec, png) => admitImage(ctx, exec, png),
  };
}

async function admitImage(ctx: CordisContext, exec: DshToolExecution, png: Uint8Array) {
  const attachments = ctx.get('attachments') as
    { saveImages(images: Array<{ data: Uint8Array; mediaType: string }>): Promise<readonly unknown[]> } | undefined;
  const llm = ctx.get('llm') as
    | {
        resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<{ inputModalities?: string[] }>;
      }
    | undefined;
  if (!attachments || !llm) {
    return { unavailable: 'the Harness image attachment store is not available' };
  }
  const agent = exec.agent as ImageCapableAgent | undefined;
  const routed = agent?.session.requestHeader?.()?.config;
  const provider = routed?.provider ?? agent?.options?.provider;
  const model = routed?.model ?? agent?.options?.model;
  if (provider === undefined || model === undefined) {
    return { unavailable: 'the current model route could not be resolved' };
  }
  let modalities: string[] | undefined;
  try {
    modalities = (await llm.resolveModelInfo(provider, model, exec.signal)).inputModalities;
  } catch {
    return { unavailable: 'the current model route could not be verified' };
  }
  if (!modalities?.includes('image')) {
    return { unavailable: `model "${model}" does not declare image input` };
  }
  const [attachment] = await attachments.saveImages([{ data: png, mediaType: 'image/png' }]);
  return { block: { type: 'image' as const, attachment } };
}

function frameAncestors(ctx: CordisContext): string[] {
  const origins = new Set<string>([DSH_DESKTOP_ORIGIN]);
  const webServer = ctx.get('webServer') as { getOrigin(): string } | undefined;
  const webApp = ctx.get('webApp') as { getAdvertisedUrl(): string } | undefined;
  for (const read of [() => webServer?.getOrigin(), () => webApp?.getAdvertisedUrl()]) {
    try {
      const value = read();
      if (value) {
        origins.add(new URL(value).origin);
      }
    } catch {
      // An absent or unparsable optional origin only narrows who may embed the Viewer.
    }
  }
  return [...origins];
}

function disposedSessionId(payload: unknown): string | undefined {
  const record = payload as { agent?: { session?: { id?: unknown } }; session?: { id?: unknown } } | undefined;
  const id = record?.agent?.session?.id ?? record?.session?.id;
  return typeof id === 'string' ? id : undefined;
}

function registerSkill(ctx: CordisContext): void {
  const skills = ctx.get('skills') as { register(skill: Record<string, unknown>): () => void } | undefined;
  if (!skills) {
    return;
  }
  const directory = join(dirname(fileURLToPath(import.meta.url)), SKILL_DIRECTORY);
  const path = join(directory, 'SKILL.md');
  let document: string;
  try {
    document = readFileSync(path, 'utf8');
  } catch {
    ctx.logger?.warn(`manifold3d: skill file is missing at ${path}; the use-manifold-dsh skill is unavailable.`);
    return;
  }
  const skill = parseSkillDocument(document);
  ctx.effect(
    () =>
      skills.register({
        ...skill,
        source: 'manifold3d',
        path,
        resourceBase: { kind: 'directory', path: directory },
      }),
    'manifold3d: skill',
  );
}
