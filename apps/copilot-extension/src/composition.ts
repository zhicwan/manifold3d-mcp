import { mkdir, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import type { CanvasOptions, JoinSessionConfig } from '@github/copilot-sdk/extension';
import { createManifoldCadShareLink } from '@manifold3d/modeling/manifoldcad-link.js';
import { ModelingEngine, ModelingSession, type CommittedModel } from '@manifold3d/modeling/modeling.js';
import { toViewerModelFrame } from '@manifold3d/modeling/runner/model-artifact.js';
import { Runner } from '@manifold3d/modeling/runner/host.js';
import { parseModelExportFormat } from '@manifold3d/protocol/wire/host-actions.js';
import { serializeModel } from '@manifold3d/viewer/exporters';
import {
  createInMemoryViewerAssetProvider,
  startViewerHost,
  type ViewerAssetManifest,
  type ViewerHost,
  type HostActionHandlerContext,
  type HostActionHandlerResult,
  type ViewerRoom,
} from '@manifold3d/viewer-host/viewer-host.js';

import { buildAnnotationAttachment, type AnnotationAttachmentPayload } from './annotation-attachment.js';
import { launchExternalUrl, type ExternalUrlLauncher } from './external-url.js';
import type { CopilotExtensionSession, CopilotSdkBoundary } from './sdk-boundary.js';
import { createExtensionTools } from './tools.js';

export const MANIFOLD_CANVAS_ID = 'manifold3d-viewer';
const MANIFOLD_CANVAS_DISPLAY_NAME = 'Manifold 3D Viewer';
export const ATTACH_ANNOTATION_BATCH_ACTION_ID = 'attach-annotation-batch';
export const FIX_ANNOTATION_BATCH_ACTION_ID = 'fix-annotation-batch';
export const ATTACH_LOCATION_SELECTION_ACTION_ID = 'attach-location-selection';
export const MODEL_EXPORT_ACTION_ID = 'export-model-file';
export const OPEN_IN_MANIFOLDCAD_ACTION_ID = 'open-in-manifoldcad';
export const FIX_ANNOTATION_BATCH_PROMPT =
  'Revise the current manifold-3d model using the following static annotation batch snapshot.';
const DEFAULT_SESSION_DISCONNECT_TIMEOUT_MS = 500;
const DEFAULT_FIX_SEND_DRAIN_TIMEOUT_MS = 250;

interface RoomBinding {
  instanceId: string;
  room: ViewerRoom;
  publication?: ModelPublication;
  cleanup: Array<() => void>;
  closed: boolean;
}

interface ModelPublication {
  revision: number;
  source: string;
  description?: string;
}

export interface StartCopilotExtensionOptions {
  sdk: CopilotSdkBoundary;
  viewerAssets: ViewerAssetManifest;
  workerFilename?: string | URL;
  manifoldWasmBytes?: Uint8Array;
  typescriptLibDeclarations?: string;
  modelingSession?: ModelingSession;
  launchExternalUrl?: ExternalUrlLauncher;
  preferredPort?: number;
  shutdownTimings?: {
    disconnectTimeoutMs?: number;
    fixSendDrainTimeoutMs?: number;
  };
}

export interface ShutdownOptions {
  disconnectSession?: boolean;
}

export interface CopilotExtensionApplication {
  shutdown(options?: ShutdownOptions): Promise<void>;
}

export async function startCopilotExtension(
  options: StartCopilotExtensionOptions,
): Promise<CopilotExtensionApplication> {
  const modelingSession =
    options.modelingSession ??
    new ModelingSession(
      new ModelingEngine(
        new Runner({
          ...(options.workerFilename !== undefined ? { workerFilename: options.workerFilename } : {}),
          ...(options.manifoldWasmBytes !== undefined
            ? {
                workerData: {
                  role: 'model-worker',
                  wasmBinary: options.manifoldWasmBytes,
                  ...(options.typescriptLibDeclarations !== undefined
                    ? { typescriptLibDeclarations: options.typescriptLibDeclarations }
                    : {}),
                },
              }
            : {}),
        }),
      ),
    );
  let host: ViewerHost;
  try {
    host = await startViewerHost({
      assetProvider: createInMemoryViewerAssetProvider(options.viewerAssets),
      preferredPort: options.preferredPort ?? 0,
      host: '127.0.0.1',
      allowAnyFrameAncestor: true,
    });
  } catch (error) {
    await modelingSession.dispose();
    throw error;
  }
  const controller = new ExtensionController(
    host,
    modelingSession,
    options.manifoldWasmBytes,
    options.launchExternalUrl ?? launchExternalUrl,
    {
      disconnectTimeoutMs: options.shutdownTimings?.disconnectTimeoutMs ?? DEFAULT_SESSION_DISCONNECT_TIMEOUT_MS,
      fixSendDrainTimeoutMs: options.shutdownTimings?.fixSendDrainTimeoutMs ?? DEFAULT_FIX_SEND_DRAIN_TIMEOUT_MS,
    },
  );
  const canvas = options.sdk.createCanvas(controller.canvasOptions());
  const tools = createExtensionTools({
    modelingSession,
    publishModel: (model, source, description) => controller.publishModel(model, source, description),
    getSession: () => controller.getSession(),
  });

  let session: CopilotExtensionSession;
  const onEvent: NonNullable<JoinSessionConfig['onEvent']> = event => {
    if (event.type === 'session.shutdown') {
      controller.observeSessionShutdown();
    }
  };
  try {
    session = await options.sdk.joinSession({
      canvases: [canvas],
      tools,
      onEvent,
    });
  } catch (error) {
    await controller.shutdown();
    throw error;
  }
  controller.bindSession(session);
  if (controller.isShuttingDown) {
    const cleanup = await Promise.allSettled([controller.disconnectJoinedSession(session), controller.shutdown()]);
    const errors = rejectedReasons(cleanup);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Copilot session shut down while the Extension was joining.');
    }
    throw new Error('Copilot session shut down while the Extension was joining.');
  }
  return {
    shutdown: shutdownOptions => controller.shutdown(shutdownOptions),
  };
}

class ExtensionController {
  private readonly rooms = new Map<string, RoomBinding>();
  private readonly pendingFixSends = new Set<Promise<void>>();
  private session: CopilotExtensionSession | undefined;
  private publication: ModelPublication | undefined;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly host: ViewerHost,
    private readonly modelingSession: ModelingSession,
    private readonly manifoldWasmBytes: Uint8Array | undefined,
    private readonly openExternalUrl: ExternalUrlLauncher,
    private readonly shutdownTimings: {
      disconnectTimeoutMs: number;
      fixSendDrainTimeoutMs: number;
    },
  ) {}

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  bindSession(session: CopilotExtensionSession): void {
    if (this.session) {
      throw new Error('Copilot session is already bound.');
    }
    this.session = session;
  }

  getSession(): CopilotExtensionSession {
    if (!this.session) {
      throw new Error('Copilot session is not ready.');
    }
    if (this.shuttingDown) {
      throw new Error('Copilot extension is shutting down.');
    }
    return this.session;
  }

  observeSessionShutdown(): void {
    if (this.shuttingDown) {
      return;
    }
    void this.shutdown().catch(error => {
      process.stderr.write(`[manifold3d-extension] session shutdown failed: ${errorMessage(error)}\n`);
    });
  }

  async disconnectJoinedSession(session: CopilotExtensionSession): Promise<void> {
    const outcome = await settleCallWithin(() => session.disconnect(), this.shutdownTimings.disconnectTimeoutMs);
    if (outcome.status === 'rejected') {
      throw outcome.reason;
    }
    if (outcome.status === 'timed-out') {
      process.stderr.write('[manifold3d-extension] joined session disconnect timed out; cleanup continued.\n');
    }
  }

  canvasOptions(): CanvasOptions {
    return {
      id: MANIFOLD_CANVAS_ID,
      displayName: MANIFOLD_CANVAS_DISPLAY_NAME,
      description: 'Inspect the current manifold-3d model and send selected annotations back to Copilot.',
      open: context => this.openCanvas(context.instanceId),
      onClose: context => this.closeCanvas(context.instanceId),
    };
  }

  publishModel(model: CommittedModel, source: string, description?: string): void {
    if (this.shuttingDown) {
      throw new Error('Cannot publish a model while the Copilot extension is shutting down.');
    }
    const frame = toViewerModelFrame(model.artifact);
    const publication: ModelPublication = {
      revision: model.revision,
      source,
      ...(description !== undefined ? { description } : {}),
    };
    const snapshot = [...this.rooms.values()];
    for (const binding of snapshot) {
      if (binding.closed || this.rooms.get(binding.instanceId) !== binding) {
        continue;
      }
      try {
        binding.room.pushModel(frame);
        binding.publication = publication;
      } catch (error) {
        if (binding.closed || this.rooms.get(binding.instanceId) !== binding) {
          continue;
        }
        throw error;
      }
    }
    this.publication = publication;
  }

  shutdown(options: ShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
    this.shutdownPromise = (async () => {
      const errors: unknown[] = [];
      const pendingFixSends = await settlePromiseWithin(
        Promise.allSettled([...this.pendingFixSends]),
        this.shutdownTimings.fixSendDrainTimeoutMs,
      );
      if (pendingFixSends.status === 'fulfilled') {
        errors.push(...rejectedReasons(pendingFixSends.value));
      } else if (pendingFixSends.status === 'timed-out') {
        process.stderr.write(
          '[manifold3d-extension] pending annotation fix sends exceeded the drain window; closing locally.\n',
        );
      }
      this.pendingFixSends.clear();

      if (options.disconnectSession === true && this.session) {
        const disconnect = await settleCallWithin(
          () => this.session!.disconnect(),
          this.shutdownTimings.disconnectTimeoutMs,
        );
        if (disconnect.status === 'rejected') {
          errors.push(disconnect.reason);
        } else if (disconnect.status === 'timed-out') {
          process.stderr.write('[manifold3d-extension] session disconnect timed out; continuing local cleanup.\n');
        }
      }

      const rooms = [...this.rooms.values()];
      this.rooms.clear();
      const closedRooms = await Promise.allSettled(
        rooms.map(async binding => {
          binding.closed = true;
          for (const cleanup of binding.cleanup.splice(0)) {
            cleanup();
          }
          await binding.room.close();
        }),
      );
      errors.push(...rejectedReasons(closedRooms));

      const resources = await Promise.allSettled([this.host.close(), this.modelingSession.dispose()]);
      errors.push(...rejectedReasons(resources));
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Copilot extension shutdown failed.');
      }
    })();
    return this.shutdownPromise;
  }

  private async openCanvas(instanceId: string): Promise<{ title: string; status: string; url: string }> {
    if (this.shuttingDown) {
      throw new Error('Cannot open a Canvas while the Copilot extension is shutting down.');
    }
    const existing = this.rooms.get(instanceId);
    if (existing) {
      return canvasOpenResult(existing.room.url);
    }

    const room = this.host.createRoom();
    const binding: RoomBinding = {
      instanceId,
      room,
      cleanup: [],
      closed: false,
    };
    this.rooms.set(instanceId, binding);
    try {
      binding.cleanup.push(
        room.registerAction(
          {
            id: ATTACH_ANNOTATION_BATCH_ACTION_ID,
            label: 'Attach annotations',
            icon: 'message',
            slot: 'annotation-batch',
            tone: 'default',
            requires: ['model', 'annotations'],
          },
          context => this.attachAnnotationBatch(binding, context),
        ),
        room.registerAction(
          {
            id: FIX_ANNOTATION_BATCH_ACTION_ID,
            label: 'Fix annotations',
            icon: 'wand',
            slot: 'annotation-batch',
            tone: 'primary',
            requires: ['model', 'annotations'],
          },
          context => this.fixAnnotationBatch(binding, context),
        ),
        room.registerAction(
          {
            id: ATTACH_LOCATION_SELECTION_ACTION_ID,
            label: 'Attach location',
            icon: 'message',
            slot: 'selection-gesture',
            tone: 'default',
            requires: ['model', 'annotations'],
          },
          context => this.attachLocationSelection(binding, context),
        ),
        room.registerAction(
          {
            id: OPEN_IN_MANIFOLDCAD_ACTION_ID,
            label: 'Open in ManifoldCAD',
            icon: 'external-link',
            slot: 'toolbar',
            tone: 'default',
            requires: ['model'],
          },
          () => this.openInManifoldCad(binding),
        ),
        room.registerAction(
          {
            id: MODEL_EXPORT_ACTION_ID,
            label: 'Export model',
            icon: 'download',
            slot: 'export-handler',
            tone: 'default',
            requires: ['model'],
          },
          context => this.exportModel(context),
        ),
      );
      const current = this.modelingSession.getCurrentModel();
      if (current) {
        room.pushModel(toViewerModelFrame(current.artifact));
        if (this.publication?.revision === current.revision) {
          binding.publication = this.publication;
        }
      }
      return canvasOpenResult(room.url);
    } catch (error) {
      this.rooms.delete(instanceId);
      binding.closed = true;
      for (const cleanup of binding.cleanup.splice(0)) {
        cleanup();
      }
      await room.close();
      throw error;
    }
  }

  private async closeCanvas(instanceId: string): Promise<void> {
    const binding = this.rooms.get(instanceId);
    if (!binding) {
      return;
    }
    this.rooms.delete(instanceId);
    binding.closed = true;
    for (const cleanup of binding.cleanup.splice(0)) {
      cleanup();
    }
    await binding.room.close();
  }

  private async attachAnnotationBatch(
    binding: RoomBinding,
    context: HostActionHandlerContext,
  ): Promise<HostActionHandlerResult> {
    const attachment = this.buildBatchAttachment(context);
    await this.pushAttachment(binding, annotationBatchTitle(attachment.annotations), attachment);
    return {
      status: 'succeeded',
      message: `Attached ${context.annotations.length} annotation${context.annotations.length === 1 ? '' : 's'}.`,
      resultDetails: { kind: 'annotations-attached', count: context.annotations.length },
    };
  }

  private fixAnnotationBatch(binding: RoomBinding, context: HostActionHandlerContext): HostActionHandlerResult {
    const attachment = this.buildBatchAttachment(context);
    if (!this.canPublishTo(binding)) {
      throw new Error('Canvas room is no longer available.');
    }
    const session = this.getSession();
    const operation = (async () => {
      try {
        context.publish.running('Sending annotation fix to Copilot.');
        await session.send({
          mode: 'enqueue',
          prompt: `${FIX_ANNOTATION_BATCH_PROMPT}\n\n${JSON.stringify(attachment)}`,
          displayPrompt: `Fix ${attachment.annotations.length} Manifold annotation${attachment.annotations.length === 1 ? '' : 's'} · ${attachment.batchId}`,
        });
        if (this.canPublishTo(binding)) {
          context.publish.succeeded('Annotation fix was accepted by Copilot for enqueueing.');
        }
      } catch (error) {
        if (this.canPublishTo(binding)) {
          context.publish.failed(`Could not send annotation fix: ${truncateStatusMessage(errorMessage(error))}`);
          void this.logBestEffort(`Could not send Manifold annotation fix: ${errorMessage(error)}`, {
            level: 'warning',
          });
        }
      }
    })();
    this.trackFixSend(operation);

    return {
      status: 'accepted',
      operationId: context.requestId,
      message: 'Sending annotation fix to Copilot.',
    };
  }

  private async attachLocationSelection(
    binding: RoomBinding,
    context: HostActionHandlerContext,
  ): Promise<HostActionHandlerResult> {
    requireExplicitAnnotationCount(context, 1, 'Location selection');
    const markerNumbers = parseMarkerNumbers(context.input, 1, 'Location selection');
    const attachment = buildAnnotationAttachment({
      mode: 'location-selection',
      modelVersion: context.modelVersion,
      annotationRevision: context.annotationRevision,
      annotations: context.annotations,
      markerNumbers,
    });
    await this.pushAttachment(binding, locationSelectionTitle(attachment.annotations[0].displayNumber), attachment);
    return { status: 'succeeded', message: 'Attached selected location.' };
  }

  private async exportModel(context: HostActionHandlerContext): Promise<HostActionHandlerResult> {
    const current = this.modelingSession.getCurrentModel();
    if (!current) {
      throw new Error('No current model is available to export.');
    }
    const session = this.getSession();
    if (!session.workspacePath) {
      throw new Error('The Copilot session did not provide a workspace path for exports.');
    }
    const frame = toViewerModelFrame(current.artifact);
    const payload = {
      ...frame,
      vertProperties: new Float32Array(frame.vertProperties),
      triVerts: new Uint32Array(frame.triVerts),
      mergeFromVert: new Uint32Array(frame.mergeFromVert),
      mergeToVert: new Uint32Array(frame.mergeToVert),
      triFeatureIds: new Uint32Array(frame.triFeatureIds),
    };
    const format = parseExportInput(context.input);
    const exported = await serializeModel(payload, format, {
      revision: current.revision,
      ...(this.manifoldWasmBytes ? { wasmBinary: this.manifoldWasmBytes } : {}),
    });
    const exportDirectory = resolvePath(session.workspacePath, 'exports');
    const filePath = resolvePath(exportDirectory, exported.filename);
    await mkdir(exportDirectory, { recursive: true });
    await writeFile(filePath, exported.bytes);
    const message = `Saved ${format.toUpperCase()} to ${filePath}`;
    return {
      status: 'succeeded',
      message,
      resultDetails: { kind: 'model-saved', format, path: filePath },
    };
  }

  private async openInManifoldCad(binding: RoomBinding): Promise<HostActionHandlerResult> {
    if (!this.canPublishTo(binding)) {
      throw new Error('Canvas room is no longer available.');
    }
    const publication = binding.publication;
    if (!publication) {
      throw new Error('Source is unavailable for the model displayed in this Canvas room.');
    }
    const link = createManifoldCadShareLink({
      code: publication.source,
      ...(publication.description !== undefined ? { name: publication.description } : {}),
    });
    await this.openExternalUrl(link.url);
    return {
      status: 'succeeded',
      message: 'Opened the current model in ManifoldCAD.',
    };
  }

  private buildBatchAttachment(context: HostActionHandlerContext) {
    requireExplicitAnnotationCount(context, undefined, 'Annotation batch');
    const { batchId, markerNumbers } = parseBatchInput(context.input, context.annotations.length);
    return buildAnnotationAttachment({
      mode: 'annotation-batch',
      batchId,
      modelVersion: context.modelVersion,
      annotationRevision: context.annotationRevision,
      annotations: context.annotations,
      markerNumbers,
    });
  }

  private async pushAttachment(
    binding: RoomBinding,
    title: string,
    payload: AnnotationAttachmentPayload,
  ): Promise<void> {
    if (!this.canPublishTo(binding)) {
      throw new Error('Canvas room is no longer available.');
    }
    try {
      await this.getSession().rpc.extensions.sendAttachmentsToMessage({
        instanceId: binding.instanceId,
        attachments: [
          {
            type: 'extension_context',
            title,
            payload,
          },
        ],
      });
    } catch (error) {
      void this.logBestEffort(`Could not attach Manifold annotation context: ${errorMessage(error)}`, {
        level: 'warning',
      });
      throw error;
    }
  }

  private trackFixSend(operation: Promise<void>): void {
    this.pendingFixSends.add(operation);
    void operation.then(
      () => this.pendingFixSends.delete(operation),
      () => this.pendingFixSends.delete(operation),
    );
  }

  private async logBestEffort(
    message: string,
    options?: { level?: 'info' | 'warning' | 'error'; ephemeral?: boolean },
  ): Promise<void> {
    if (!this.session || this.shuttingDown) {
      return;
    }
    try {
      await this.session.log(message, options);
    } catch {
      // SDK logging must not affect action delivery or shutdown.
    }
  }

  private canPublishTo(binding: RoomBinding): boolean {
    return !this.shuttingDown && !binding.closed && this.rooms.get(binding.instanceId) === binding;
  }
}

function canvasOpenResult(url: string): { title: string; status: string; url: string } {
  return {
    title: MANIFOLD_CANVAS_DISPLAY_NAME,
    status: 'Connected to the current modeling session',
    url,
  };
}

function rejectedReasons(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason as unknown);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseExportInput(input: HostActionHandlerContext['input']) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Model export input must specify a format.');
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'format') {
    throw new Error('Model export input contains unsupported or missing fields.');
  }
  return parseModelExportFormat(input.format);
}

function requireExplicitAnnotationCount(
  context: HostActionHandlerContext,
  expected: number | undefined,
  label: string,
): void {
  if (!context.annotationIds) {
    throw new Error(`${label} requires explicit annotationIds.`);
  }
  if (expected === undefined) {
    if (context.annotationIds.length === 0) {
      throw new Error(`${label} requires at least one annotation.`);
    }
    return;
  }
  if (context.annotationIds.length !== expected) {
    throw new Error(`${label} requires exactly ${expected} annotation.`);
  }
}

function parseBatchInput(
  input: HostActionHandlerContext['input'],
  annotationCount: number,
): { batchId: string; markerNumbers: number[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Annotation batch input must contain batchId and markerNumbers.');
  }
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('batchId') || !keys.includes('markerNumbers')) {
    throw new Error('Annotation batch input contains unsupported or missing fields.');
  }
  const batchId = input.batchId;
  if (
    typeof batchId !== 'string' ||
    batchId.length === 0 ||
    batchId.length > 64 ||
    !/^[A-Za-z0-9][-A-Za-z0-9._:]*$/.test(batchId)
  ) {
    throw new Error('Annotation batch batchId must be a safe identifier no longer than 64 characters.');
  }
  return {
    batchId,
    markerNumbers: parseMarkerNumbers(input, annotationCount, 'Annotation batch'),
  };
}

function parseMarkerNumbers(
  input: HostActionHandlerContext['input'],
  annotationCount: number,
  label: string,
): number[] {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.markerNumbers)) {
    throw new Error(`${label} input must contain markerNumbers.`);
  }
  const markerNumbers = input.markerNumbers.map((value, index) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${label} markerNumbers[${index}] must be a positive safe integer.`);
    }
    return value;
  });
  if (markerNumbers.length !== annotationCount) {
    throw new Error(`${label} markerNumbers must match the annotation count.`);
  }
  return markerNumbers;
}

function annotationBatchTitle(annotations: readonly { displayNumber: number }[]): string {
  const markers = annotations.map(annotation => `#${annotation.displayNumber}`).join(' ');
  return `Annotations · ${markers}`.slice(0, 80);
}

function locationSelectionTitle(displayNumber: number): string {
  return `Location · #${displayNumber}`;
}

function truncateStatusMessage(message: string): string {
  return message.slice(0, 512);
}

type BoundedSettlement<T> =
  | PromiseSettledResult<T>
  | {
      status: 'timed-out';
    };

function settleCallWithin<T>(operation: () => Promise<T>, timeoutMs: number): Promise<BoundedSettlement<T>> {
  return settlePromiseWithin(Promise.resolve().then(operation), timeoutMs);
}

async function settlePromiseWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<BoundedSettlement<T>> {
  const observed = promise.then(
    value => ({ status: 'fulfilled', value }) as const,
    reason => ({ status: 'rejected', reason: reason as unknown }) as const,
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ status: 'timed-out' }>(resolve => {
    timer = setTimeout(() => resolve({ status: 'timed-out' }), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([observed, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
