import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve as resolvePath, sep } from 'node:path';

import { createManifoldCadShareLink } from '@manifold3d/modeling/manifoldcad-link.js';
import type { CommittedModel, ModelingSession } from '@manifold3d/modeling/modeling.js';
import { toViewerModelFrame } from '@manifold3d/modeling/runner/model-artifact.js';
import {
  buildAnnotationAttachment,
  type AnnotationAttachmentPayload,
} from '@manifold3d/protocol/wire/annotation-attachment.js';
import { parseModelExportFormat } from '@manifold3d/protocol/wire/host-actions.js';
import { serializeModel } from '@manifold3d/viewer/exporters';
import {
  createInMemoryViewerAssetProvider,
  startViewerHost,
  type HostActionHandlerContext,
  type HostActionHandlerResult,
  type ViewerAssetManifest,
  type ViewerHost,
  type ViewerRoom,
} from '@manifold3d/viewer-host/viewer-host.js';

import type { DshAgent, DshFetchRoute, DshHostPorts, DshToolDefinition } from './dsh-boundary.js';
import type { ExternalUrlLauncher } from './external-url.js';
import { createDshTools } from './tools.js';

export const ATTACH_ANNOTATION_BATCH_ACTION_ID = 'attach-annotation-batch';
export const FIX_ANNOTATION_BATCH_ACTION_ID = 'fix-annotation-batch';
export const ATTACH_LOCATION_SELECTION_ACTION_ID = 'attach-location-selection';
export const ATTACH_MEASUREMENT_ACTION_ID = 'attach-measurement';
export const MODEL_EXPORT_ACTION_ID = 'export-model-file';
export const OPEN_IN_MANIFOLDCAD_ACTION_ID = 'open-in-manifoldcad';
export const FIX_SOURCE_KIND = 'manifold3d-fix';
export const FIX_ANNOTATION_BATCH_PROMPT =
  'Revise the current manifold-3d model using the following static annotation batch snapshot. ' +
  'For measurement items, trust the structured evidence and summary; parallel-gap measures supporting planes, not finite-face clearance. ' +
  'Operand order records selection order, but never guess which operand may move when the instruction is ambiguous: ask the user to clarify.';
/** Attach snapshots live directly in `.manifold3d/` so the draft reference stays short. */
export const ATTACHMENT_DIRECTORY = '.manifold3d';
/** Short, readable file prefixes; the sent chip shows the file name as its label. */
export const ATTACHMENT_FILE_PREFIX: Record<AnnotationAttachmentPayload['mode'], string> = {
  'annotation-batch': 'notes',
  'location-selection': 'loc',
  measurement: 'measure',
};
const MAX_SNAPSHOT_NAME_ATTEMPTS = 64;
export const ROUTE_PREFIX = '/api/manifold3d';
const DEFAULT_INSERTION_TIMEOUT_MS = 10_000;
const DEFAULT_INSERTION_POLL_MS = 25_000;
const MAX_ROOMS_PER_SESSION = 8;
const MAX_PENDING_INSERTIONS = 16;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface ModelPublication {
  revision: number;
  source: string;
  description?: string;
}

interface PendingInsertion {
  id: string;
  text: string;
  filePath: string;
  delivered: boolean;
  settle(outcome: InsertionOutcome): void;
}

/**
 * `uncertain` means the Client received the insertion but never confirmed it:
 * the reference may already be in the draft, so its snapshot is retained.
 */
type InsertionOutcome = { ok: true } | { ok: false; error: string; uncertain: boolean };

interface RoomBinding {
  sessionId: string;
  tabId: string;
  room: ViewerRoom;
  publication?: ModelPublication | undefined;
  cleanup: Array<() => void>;
  closed: boolean;
  insertions: PendingInsertion[];
  waiters: Set<() => void>;
}

interface SessionBinding {
  sessionId: string;
  modeling?: ModelingSession | undefined;
  publication?: ModelPublication | undefined;
  rooms: Map<string, RoomBinding>;
  /** Tabs whose room creation is waiting for the Viewer Host to start. */
  opening: Map<string, PendingOpen>;
}

interface PendingOpen {
  /** Set when the tab is closed before its room exists. */
  cancelled: boolean;
  promise: Promise<RoomBinding>;
}

export interface StartDshExtensionOptions {
  ports: DshHostPorts;
  viewerAssets: ViewerAssetManifest;
  /** Exact ancestor origins of the DSH page (Web origin and Desktop shell). */
  frameAncestors: readonly string[];
  createModelingSession(): ModelingSession;
  launchExternalUrl: ExternalUrlLauncher;
  manifoldWasmBytes?: Uint8Array;
  preferredPort?: number;
  /** Starts the shared Viewer Host; replaceable to observe startup ordering. */
  startViewerHost?: typeof startViewerHost;
  timings?: { insertionTimeoutMs?: number; insertionPollMs?: number };
}

export interface DshExtension {
  readonly tools: readonly DshToolDefinition[];
  readonly routes: readonly DshFetchRoute[];
  /** Release Session-owned modeling state when its Agent is disposed. */
  agentDisposed(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export function createDshExtension(options: StartDshExtensionOptions): DshExtension {
  const controller = new DshExtensionController(options);
  return {
    tools: createDshTools({
      ports: options.ports,
      modelingFor: agent => controller.modelingFor(agent),
      existingModelingFor: agent => controller.existingModelingFor(agent),
      publishModel: (agent, model, source, description) => controller.publishModel(agent, model, source, description),
    }),
    routes: controller.routes(),
    agentDisposed: sessionId => controller.agentDisposed(sessionId),
    shutdown: () => controller.shutdown(),
  };
}

class DshExtensionController {
  private readonly sessions = new Map<string, SessionBinding>();
  private hostPromise: Promise<ViewerHost> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private shuttingDown = false;
  private readonly insertionTimeoutMs: number;
  private readonly insertionPollMs: number;

  constructor(private readonly options: StartDshExtensionOptions) {
    this.insertionTimeoutMs = options.timings?.insertionTimeoutMs ?? DEFAULT_INSERTION_TIMEOUT_MS;
    this.insertionPollMs = options.timings?.insertionPollMs ?? DEFAULT_INSERTION_POLL_MS;
  }

  modelingFor(agent: DshAgent): ModelingSession {
    this.assertActive();
    const binding = this.bindingFor(agent.session.id);
    binding.modeling ??= this.options.createModelingSession();
    return binding.modeling;
  }

  existingModelingFor(agent: DshAgent): ModelingSession | undefined {
    return this.sessions.get(agent.session.id)?.modeling;
  }

  publishModel(agent: DshAgent, model: CommittedModel, source: string, description?: string): void {
    this.assertActive();
    const binding = this.bindingFor(agent.session.id);
    const frame = toViewerModelFrame(model.artifact);
    const publication: ModelPublication = {
      revision: model.revision,
      source,
      ...(description !== undefined ? { description } : {}),
    };
    for (const room of [...binding.rooms.values()]) {
      if (!this.isCurrent(room)) {
        continue;
      }
      try {
        room.room.pushModel(frame);
        room.publication = publication;
      } catch (error) {
        if (this.isCurrent(room)) {
          throw error;
        }
      }
    }
    binding.publication = publication;
  }

  async agentDisposed(sessionId: string): Promise<void> {
    const binding = this.sessions.get(sessionId);
    const modeling = binding?.modeling;
    if (!binding || !modeling) {
      return;
    }
    binding.modeling = undefined;
    binding.publication = undefined;
    this.releaseIfIdle(binding);
    await modeling.dispose();
  }

  routes(): DshFetchRoute[] {
    const route = (
      path: string,
      methods: string[],
      handler: (request: Request) => Promise<Response>,
    ): DshFetchRoute => ({
      path: `${ROUTE_PREFIX}${path}`,
      methods,
      requestBody: 'buffered',
      fetch: request => this.guard(request, handler),
    });
    return [
      route('/rooms', ['POST', 'DELETE'], request =>
        request.method === 'POST' ? this.handleOpenRoom(request) : this.handleCloseRoom(request),
      ),
      route('/insertions', ['GET'], request => this.handlePollInsertion(request)),
      route('/insertions/ack', ['POST'], request => this.handleAcknowledgeInsertion(request)),
    ];
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
    this.shutdownPromise = (async () => {
      const errors: unknown[] = [];
      const bindings = [...this.sessions.values()];
      this.sessions.clear();
      for (const binding of bindings) {
        const rooms = [...binding.rooms.values()];
        binding.rooms.clear();
        const closed = await Promise.allSettled(rooms.map(room => this.closeRoomBinding(room)));
        errors.push(...rejectedReasons(closed));
        if (binding.modeling) {
          const disposed = await Promise.allSettled([binding.modeling.dispose()]);
          errors.push(...rejectedReasons(disposed));
          binding.modeling = undefined;
        }
      }
      if (this.hostPromise) {
        const host = await Promise.allSettled([this.hostPromise.then(viewerHost => viewerHost.close())]);
        errors.push(...rejectedReasons(host));
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Manifold DSH extension shutdown failed.');
      }
    })();
    return this.shutdownPromise;
  }

  private async guard(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
    if (this.options.ports.allowsRemoteAuthorities()) {
      return json(403, {
        error: 'Manifold 3D Viewer routes are available only to the local owner of a loopback Harness.',
      });
    }
    if (this.shuttingDown) {
      return json(503, { error: 'The Manifold 3D extension is shutting down.' });
    }
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof RouteError) {
        return json(error.status, { error: error.message });
      }
      return json(500, { error: errorMessage(error) });
    }
  }

  private async handleOpenRoom(request: Request): Promise<Response> {
    const { sessionId, tabId } = parseRoomAddress(await readJsonBody(request));
    if (!this.options.ports.getAgent(sessionId)) {
      throw new RouteError(409, 'The session is not active. Send a message in this session, then retry.');
    }
    const binding = this.bindingFor(sessionId);
    const existing = binding.rooms.get(tabId);
    if (existing) {
      return json(200, { url: existing.room.url });
    }
    // Concurrent opens of one tab share a single in-flight creation, so a
    // DELETE cancels every continuation and pending tabs count toward the limit.
    let pending = binding.opening.get(tabId);
    if (!pending) {
      if (binding.rooms.size + binding.opening.size >= MAX_ROOMS_PER_SESSION) {
        throw new RouteError(429, `A session can open at most ${MAX_ROOMS_PER_SESSION} Manifold 3D Viewer tabs.`);
      }
      pending = this.startOpening(binding, tabId);
    }
    const room = await pending.promise;
    return json(200, { url: room.room.url });
  }

  private startOpening(binding: SessionBinding, tabId: string): PendingOpen {
    const pending: PendingOpen = { cancelled: false, promise: Promise.resolve(undefined as never) };
    binding.opening.set(tabId, pending);
    pending.promise = (async () => {
      try {
        const host = await this.viewerHost();
        if (pending.cancelled) {
          throw new RouteError(409, 'The Viewer tab was closed while it was opening.');
        }
        if (this.shuttingDown || this.sessions.get(binding.sessionId) !== binding) {
          throw new RouteError(409, 'The Manifold 3D extension is no longer serving this session.');
        }
        return this.createRoomBinding(binding, tabId, host.createRoom());
      } finally {
        if (binding.opening.get(tabId) === pending) {
          binding.opening.delete(tabId);
        }
        this.releaseIfIdle(binding);
      }
    })();
    return pending;
  }

  private async handleCloseRoom(request: Request): Promise<Response> {
    const { sessionId, tabId } = parseRoomAddress(queryRecord(request));
    const binding = this.sessions.get(sessionId);
    const room = binding?.rooms.get(tabId);
    const pending = binding?.opening.get(tabId);
    if (pending) {
      pending.cancelled = true;
    }
    if (!binding || !room) {
      return new Response(null, { status: 204 });
    }
    binding.rooms.delete(tabId);
    this.releaseIfIdle(binding);
    await this.closeRoomBinding(room);
    return new Response(null, { status: 204 });
  }

  private async handlePollInsertion(request: Request): Promise<Response> {
    const { sessionId, tabId } = parseRoomAddress(queryRecord(request));
    const room = this.sessions.get(sessionId)?.rooms.get(tabId);
    if (!room) {
      throw new RouteError(404, 'The Manifold 3D Viewer tab is not open.');
    }
    const next = await this.nextInsertion(room, request.signal);
    if (!next) {
      return new Response(null, { status: 204 });
    }
    return json(200, { id: next.id, text: next.text });
  }

  private async handleAcknowledgeInsertion(request: Request): Promise<Response> {
    const body = await readJsonBody(request);
    const { sessionId, tabId } = parseRoomAddress(body);
    const id = body.id;
    const ok = body.ok;
    if (typeof id !== 'string' || !SAFE_ID.test(id) || typeof ok !== 'boolean') {
      throw new RouteError(400, 'Acknowledgement requires id and ok.');
    }
    const room = this.sessions.get(sessionId)?.rooms.get(tabId);
    const insertion = room?.insertions.find(candidate => candidate.id === id && candidate.delivered);
    if (!room || !insertion) {
      throw new RouteError(404, 'The insertion is no longer pending.');
    }
    insertion.settle(
      ok
        ? { ok: true }
        : {
            ok: false,
            error: typeof body.error === 'string' ? body.error.slice(0, 256) : 'Insertion was refused.',
            uncertain: false,
          },
    );
    return new Response(null, { status: 204 });
  }

  /**
   * Claim the next undelivered insertion for one poll. Claiming happens
   * synchronously with resolution, so overlapping polls never receive the same
   * insertion and an aborted poll claims nothing.
   */
  private nextInsertion(room: RoomBinding, signal: AbortSignal): Promise<PendingInsertion | undefined> {
    const claim = (): PendingInsertion | undefined => {
      if (room.closed || signal.aborted) {
        return undefined;
      }
      const next = room.insertions.find(candidate => !candidate.delivered);
      if (next) {
        next.delivered = true;
      }
      return next;
    };
    const ready = claim();
    if (ready || room.closed || signal.aborted) {
      return Promise.resolve(ready);
    }
    return new Promise(resolvePromise => {
      const finish = (): void => {
        clearTimeout(timer);
        room.waiters.delete(wake);
        signal.removeEventListener('abort', finish);
        resolvePromise(claim());
      };
      const wake = (): void => finish();
      const timer = setTimeout(finish, this.insertionPollMs);
      room.waiters.add(wake);
      signal.addEventListener('abort', finish, { once: true });
    });
  }

  private viewerHost(): Promise<ViewerHost> {
    const start = this.options.startViewerHost ?? startViewerHost;
    this.hostPromise ??= start({
      assetProvider: createInMemoryViewerAssetProvider(this.options.viewerAssets),
      preferredPort: this.options.preferredPort ?? 0,
      host: '127.0.0.1',
      frameAncestors: this.options.frameAncestors,
    });
    return this.hostPromise;
  }

  private createRoomBinding(binding: SessionBinding, tabId: string, room: ViewerRoom): RoomBinding {
    const roomBinding: RoomBinding = {
      sessionId: binding.sessionId,
      tabId,
      room,
      cleanup: [],
      closed: false,
      insertions: [],
      waiters: new Set(),
    };
    binding.rooms.set(tabId, roomBinding);
    roomBinding.cleanup.push(
      room.registerAction(
        {
          id: ATTACH_ANNOTATION_BATCH_ACTION_ID,
          label: 'Attach annotations',
          icon: 'message',
          slot: 'annotation-batch',
          tone: 'default',
          requires: ['model', 'annotations'],
        },
        context => this.attach(roomBinding, context, this.buildBatchAttachment(context)),
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
        context => this.fixAnnotationBatch(roomBinding, context),
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
        context => this.attach(roomBinding, context, this.buildLocationAttachment(context)),
      ),
      room.registerAction(
        {
          id: ATTACH_MEASUREMENT_ACTION_ID,
          label: 'Attach measurement',
          icon: 'message',
          slot: 'measurement-result',
          tone: 'default',
          requires: ['model', 'annotations'],
        },
        context => this.attach(roomBinding, context, this.buildMeasurementAttachment(context)),
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
        () => this.openInManifoldCad(roomBinding),
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
        context => this.exportModel(roomBinding, context),
      ),
    );
    const current = binding.modeling?.getCurrentModel();
    if (current) {
      room.pushModel(toViewerModelFrame(current.artifact));
      if (binding.publication?.revision === current.revision) {
        roomBinding.publication = binding.publication;
      }
    }
    return roomBinding;
  }

  private async closeRoomBinding(room: RoomBinding): Promise<void> {
    if (room.closed) {
      return;
    }
    room.closed = true;
    for (const insertion of room.insertions.splice(0)) {
      insertion.settle({ ok: false, error: 'The Manifold 3D Viewer tab was closed.', uncertain: insertion.delivered });
    }
    for (const wake of [...room.waiters]) {
      wake();
    }
    for (const cleanup of room.cleanup.splice(0)) {
      cleanup();
    }
    await room.room.close();
  }

  private fixAnnotationBatch(room: RoomBinding, context: HostActionHandlerContext): HostActionHandlerResult {
    this.requireCurrent(room);
    const attachment = this.buildBatchAttachment(context);
    const agent = this.requireAgent(room.sessionId);
    agent.followup({
      content: [{ type: 'text', text: `${FIX_ANNOTATION_BATCH_PROMPT}\n\n${JSON.stringify(attachment)}` }],
      source: { kind: FIX_SOURCE_KIND },
    });
    const count = attachment.annotations.length;
    return {
      status: 'succeeded',
      message: `Fix for ${count} annotation${count === 1 ? '' : 's'} was queued for the agent.`,
    };
  }

  /**
   * Attach writes a static snapshot file and asks this tab's Client body to
   * insert an `@path` reference into the composer draft. Nothing is sent and
   * no model context changes until the user sends the message.
   */
  private async attach(
    room: RoomBinding,
    context: HostActionHandlerContext,
    attachment: AnnotationAttachmentPayload,
  ): Promise<HostActionHandlerResult> {
    this.requireCurrent(room);
    if (room.insertions.length >= MAX_PENDING_INSERTIONS) {
      throw new Error('Too many attachments are waiting for the composer.');
    }
    const agent = this.requireAgent(room.sessionId);
    const workspace = this.options.ports.workingDirectory(agent);
    const directory = resolvePath(workspace, ATTACHMENT_DIRECTORY);
    const filePath = await writeNumberedSnapshot(
      directory,
      ATTACHMENT_FILE_PREFIX[attachment.mode],
      `${JSON.stringify(attachment, null, 2)}\n`,
    );
    const reference = relative(workspace, filePath).split(sep).join('/');
    const outcome = await this.requestInsertion(room, `@${reference} `, filePath);
    if (!outcome.ok) {
      if (outcome.uncertain) {
        throw new Error(
          `The Viewer tab did not confirm adding @${reference} to the message draft; the snapshot was kept. ${outcome.error}`,
        );
      }
      await rm(filePath, { force: true });
      throw new Error(`Could not add the attachment to the composer: ${outcome.error}`);
    }
    const count = attachment.annotations.length;
    return {
      status: 'succeeded',
      message: attachmentMessage(attachment),
      ...(attachment.mode === 'location-selection' ? {} : { resultDetails: { kind: 'annotations-attached', count } }),
    };
  }

  private requestInsertion(room: RoomBinding, text: string, filePath: string): Promise<InsertionOutcome> {
    return new Promise(resolvePromise => {
      let settled = false;
      const insertion: PendingInsertion = {
        id: randomUUID(),
        text,
        filePath,
        delivered: false,
        settle: outcome => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          const index = room.insertions.indexOf(insertion);
          if (index >= 0) {
            room.insertions.splice(index, 1);
          }
          resolvePromise(outcome);
        },
      };
      const timer = setTimeout(
        () =>
          insertion.settle({
            ok: false,
            error: 'the Viewer tab did not respond. Keep the tab open and retry.',
            uncertain: insertion.delivered,
          }),
        this.insertionTimeoutMs,
      );
      room.insertions.push(insertion);
      for (const wake of [...room.waiters]) {
        wake();
      }
    });
  }

  private async exportModel(room: RoomBinding, context: HostActionHandlerContext): Promise<HostActionHandlerResult> {
    this.requireCurrent(room);
    const agent = this.requireAgent(room.sessionId);
    const current = this.sessions.get(room.sessionId)?.modeling?.getCurrentModel();
    if (!current) {
      throw new Error('No current model is available to export.');
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
      ...(this.options.manifoldWasmBytes ? { wasmBinary: this.options.manifoldWasmBytes } : {}),
    });
    const exportDirectory = resolvePath(this.options.ports.workingDirectory(agent), 'exports');
    const filePath = resolvePath(exportDirectory, exported.filename);
    if (relative(exportDirectory, filePath).startsWith('..') || relative(exportDirectory, filePath).includes(sep)) {
      throw new Error('Export filename must stay inside the exports directory.');
    }
    await mkdir(exportDirectory, { recursive: true });
    await writeFile(filePath, exported.bytes);
    return {
      status: 'succeeded',
      message: `Saved ${format.toUpperCase()} to ${filePath}`,
      resultDetails: { kind: 'model-saved', format, path: filePath },
    };
  }

  private async openInManifoldCad(room: RoomBinding): Promise<HostActionHandlerResult> {
    this.requireCurrent(room);
    const publication = room.publication;
    if (!publication) {
      throw new Error('Source is unavailable for the model displayed in this Viewer tab.');
    }
    const link = createManifoldCadShareLink({
      code: publication.source,
      ...(publication.description !== undefined ? { name: publication.description } : {}),
    });
    await this.options.launchExternalUrl(link.url);
    return { status: 'succeeded', message: 'Opened the current model in ManifoldCAD.' };
  }

  private buildBatchAttachment(context: HostActionHandlerContext): AnnotationAttachmentPayload {
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

  private buildLocationAttachment(context: HostActionHandlerContext): AnnotationAttachmentPayload {
    requireExplicitAnnotationCount(context, 1, 'Location selection');
    return buildAnnotationAttachment({
      mode: 'location-selection',
      modelVersion: context.modelVersion,
      annotationRevision: context.annotationRevision,
      annotations: context.annotations,
      markerNumbers: parseMarkerNumbers(context.input, 1, 'Location selection'),
    });
  }

  private buildMeasurementAttachment(context: HostActionHandlerContext): AnnotationAttachmentPayload {
    requireExplicitAnnotationCount(context, 1, 'Measurement');
    if (context.annotations.length !== 1 || context.annotations[0]?.id !== context.annotationIds?.[0]) {
      throw new Error('Measurement annotationIds must identify the selected measurement.');
    }
    const markerNumbers = parseMarkerNumbers(context.input, 1, 'Measurement');
    if (Object.keys(context.input as object).length !== 1) {
      throw new Error('Measurement input must contain only markerNumbers.');
    }
    return buildAnnotationAttachment({
      mode: 'measurement',
      modelVersion: context.modelVersion,
      annotationRevision: context.annotationRevision,
      annotations: context.annotations,
      markerNumbers,
    });
  }

  private bindingFor(sessionId: string): SessionBinding {
    let binding = this.sessions.get(sessionId);
    if (!binding) {
      binding = { sessionId, rooms: new Map(), opening: new Map() };
      this.sessions.set(sessionId, binding);
    }
    return binding;
  }

  private releaseIfIdle(binding: SessionBinding): void {
    if (
      binding.rooms.size === 0 &&
      binding.opening.size === 0 &&
      !binding.modeling &&
      this.sessions.get(binding.sessionId) === binding
    ) {
      this.sessions.delete(binding.sessionId);
    }
  }

  private requireAgent(sessionId: string): DshAgent {
    const agent = this.options.ports.getAgent(sessionId);
    if (!agent) {
      throw new Error('The session is not active. Send a message in this session, then retry.');
    }
    return agent;
  }

  private requireCurrent(room: RoomBinding): void {
    if (!this.isCurrent(room)) {
      throw new Error('Viewer tab is no longer available.');
    }
  }

  private isCurrent(room: RoomBinding): boolean {
    return !this.shuttingDown && !room.closed && this.sessions.get(room.sessionId)?.rooms.get(room.tabId) === room;
  }

  private assertActive(): void {
    if (this.shuttingDown) {
      throw new Error('The Manifold 3D extension is shutting down.');
    }
  }
}

class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new RouteError(400, 'Request body must be JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RouteError(400, 'Request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function queryRecord(request: Request): Record<string, unknown> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

function parseRoomAddress(record: Record<string, unknown>): { sessionId: string; tabId: string } {
  const { sessionId, tabId } = record;
  if (typeof sessionId !== 'string' || !SAFE_ID.test(sessionId)) {
    throw new RouteError(400, 'sessionId must be a safe identifier.');
  }
  if (typeof tabId !== 'string' || !SAFE_ID.test(tabId)) {
    throw new RouteError(400, 'tabId must be a safe identifier.');
  }
  return { sessionId, tabId };
}

/**
 * Create `<prefix>-<n>.json` with the next free number in the directory.
 * Exclusive creation keeps concurrent attaches and existing files intact.
 */
async function writeNumberedSnapshot(directory: string, prefix: string, contents: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const pattern = new RegExp(`^${prefix}-(\\d+)\\.json$`);
  let next = 1;
  for (const name of await readdir(directory)) {
    const number = Number(pattern.exec(name)?.[1]);
    if (Number.isSafeInteger(number) && number >= next) {
      next = number + 1;
    }
  }
  for (let attempt = 0; attempt < MAX_SNAPSHOT_NAME_ATTEMPTS; attempt += 1, next += 1) {
    const filePath = resolvePath(directory, `${prefix}-${next}.json`);
    try {
      await writeFile(filePath, contents, { flag: 'wx' });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error(`Could not allocate an attachment file name in ${directory}.`);
}

function attachmentMessage(attachment: AnnotationAttachmentPayload): string {
  if (attachment.mode === 'location-selection') {
    return 'Added the selected location to the message draft.';
  }
  if (attachment.mode === 'measurement') {
    return 'Added the measurement to the message draft.';
  }
  const count = attachment.annotations.length;
  return `Added ${count} annotation${count === 1 ? '' : 's'} to the message draft.`;
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
  return { batchId, markerNumbers: parseMarkerNumbers(input, annotationCount, 'Annotation batch') };
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
