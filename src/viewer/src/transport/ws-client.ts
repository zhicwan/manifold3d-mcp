import type { PreviewFeature, PreviewPayload } from '../types.js';

/**
 * Wire-format header that the preview server sends as a JSON text frame
 * before the binary mesh frames. Mirrors the shape produced by
 * src/server/preview/preview-server.ts > sendMesh().
 */
interface MeshHeader {
  kind: 'mesh';
  description?: string;
  numProp: number;
  triangles: number;
  vertices: number;
  features?: PreviewFeature[];
  hasTriFeatureIds?: boolean;
  volume?: number;
  surfaceArea?: number;
  genus?: number;
  bboxMin?: [number, number, number];
  bboxMax?: [number, number, number];
}

interface ModelVersionMessage {
  kind: 'model_version';
  modelVersion: string;
}

interface HelloMessage {
  kind: 'hello';
  clientId: string;
}

export type MeshHandler = (payload: PreviewPayload) => void;
export type ModelVersionHandler = (modelVersion: string) => void;
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type StatusHandler = (status: ConnectionStatus) => void;

export interface MeshFeedHandle {
  /** Send a JSON text frame to the server. No-op if WS not open. */
  send(message: unknown): void;
  /** True iff WebSocket is in OPEN state. */
  isOpen(): boolean;
  /**
   * Permanently stop the feed: cancels any pending reconnect timer,
   * gates future onclose handlers from firing reconnects, and closes
   * the active socket. Safe to call multiple times. After close() the
   * handle is inert.
   */
  close(): void;
}

export interface ConnectOptions {
  onMesh: MeshHandler;
  onModelVersion?: ModelVersionHandler;
  /**
   * Fired every time the WebSocket transitions into the OPEN state,
   * including after auto-reconnect. Use it to re-push any client state
   * the server should know about (e.g. the marks subsystem re-flushes
   * its annotation snapshot here so edits made while disconnected are
   * not silently lost).
   */
  onOpen?: () => void;
  /**
   * Fired whenever the WebSocket connection state changes.
   * 'connecting' is reported the moment open() starts (including each
   * reconnect attempt); 'connected' on successful onopen; 'disconnected'
   * on close/error. Used by the control panel's status indicator dot.
   * Repeats of the same status are suppressed (VIE-1).
   */
  onStatusChange?: StatusHandler;
}

/**
 * Reconnect tuning (VIE-1):
 *   - Exponential base 2 backoff starting at 1s, capped at 30s.
 *   - ±25% jitter applied to each delay so a fleet of viewers reopened
 *     simultaneously (e.g. server restart) doesn't thunder the socket.
 *   - Pause attempts entirely when the tab is hidden (visibilitychange);
 *     fire one immediate retry the moment it comes back to foreground.
 *   - After RECONNECT_MAX_ATTEMPTS consecutive failures we stop trying;
 *     the user can refresh to start over. 100 attempts at the cap of 30s
 *     covers ~50 minutes of server downtime, which is more than enough
 *     for a local dev box; longer outages should be visible in the UI.
 */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.25;
const RECONNECT_MAX_ATTEMPTS = 100;

/**
 * Open a WebSocket to /ws and invoke `onMesh` whenever the server
 * delivers a complete mesh (header + vertProperties + triVerts), and
 * `onModelVersion` whenever the server announces a new model version.
 * Auto-reconnects with exponential backoff + jitter (VIE-1).
 *
 * Returns a handle that lets callers push JSON messages back to the
 * server (used by the marks subsystem to upload annotation snapshots).
 */
export function connectMeshFeed(opts: ConnectOptions): MeshFeedHandle {
  let pendingHeader: MeshHeader | null = null;
  let pendingVerts: Float32Array | null = null;
  let pendingTris: Uint32Array | null = null;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let closed = false;
  let reconnectAttempts = 0;
  let lastStatus: ConnectionStatus | null = null;

  const setStatus = (status: ConnectionStatus): void => {
    if (lastStatus === status) {
      return;
    }
    lastStatus = status;
    opts.onStatusChange?.(status);
  };

  const computeBackoff = (attempt: number): number => {
    // attempt is 1-based: 1 => 1s, 2 => 2s, 3 => 4s ... capped at CAP.
    const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** (attempt - 1));
    const jitter = exp * RECONNECT_JITTER_RATIO * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(exp + jitter));
  };

  const scheduleReconnect = (): void => {
    if (closed) {
      return;
    }
    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      // Give up. The user can reload the page to start over.
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Don't burn retries while the tab is backgrounded; the
      // visibilitychange listener below will kick a single retry the
      // moment we come back to foreground.
      return;
    }
    reconnectAttempts += 1;
    const delay = computeBackoff(reconnectAttempts);
    reconnectTimer = window.setTimeout(open, delay);
  };

  const open = (): void => {
    if (closed) {
      return;
    }
    reconnectTimer = undefined;
    setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    socket = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
      if (typeof ev.data === 'string') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (isMeshHeader(parsed)) {
          pendingHeader = parsed;
          pendingVerts = null;
          pendingTris = null;
          return;
        }
        if (isModelVersion(parsed)) {
          opts.onModelVersion?.(parsed.modelVersion);
          return;
        }
        if (isHello(parsed)) {
          // Hello is informational for now (server-assigned clientId);
          // the marks subsystem doesn't need it because the server tags
          // annotations on the way in. Reserved for future debugging.
          return;
        }
        return;
      }
      if (!pendingHeader) {
        return;
      }
      if (!pendingVerts) {
        pendingVerts = new Float32Array(ev.data);
        return;
      }
      if (!pendingTris) {
        pendingTris = new Uint32Array(ev.data);
        // Old servers (no feature recognition) only send 2 binary frames
        // and don't set hasTriFeatureIds. Emit immediately in that case.
        if (!pendingHeader.hasTriFeatureIds) {
          emit(pendingHeader, pendingVerts, pendingTris, new Uint32Array(0));
          pendingHeader = null;
          pendingVerts = null;
          pendingTris = null;
        }
        return;
      }
      const triFeatureIds = new Uint32Array(ev.data);
      emit(pendingHeader, pendingVerts, pendingTris, triFeatureIds);
      pendingHeader = null;
      pendingVerts = null;
      pendingTris = null;
    };
    ws.onopen = () => {
      if (closed) {
        ws.close();
        return;
      }
      // Successful connection — reset the backoff so the next outage
      // starts fresh from 1s rather than continuing from the cap.
      reconnectAttempts = 0;
      setStatus('connected');
      opts.onOpen?.();
    };
    ws.onclose = () => {
      socket = null;
      if (closed) {
        return;
      }
      setStatus('disconnected');
      scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  };

  const onVisibilityChange = (): void => {
    if (closed) {
      return;
    }
    if (document.visibilityState === 'visible' && socket === null) {
      // Came back to foreground while disconnected — retry now and
      // cancel any pending exponential-backoff timer so we don't
      // double-fire.
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      // Don't increment reconnectAttempts here: a foreground retry is
      // user-initiated, not a server-driven failure.
      open();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  const emit = (header: MeshHeader, verts: Float32Array, tris: Uint32Array, triFeatureIds: Uint32Array): void => {
    opts.onMesh({
      description: header.description,
      numProp: header.numProp,
      triangles: header.triangles,
      vertices: header.vertices,
      vertProperties: verts,
      triVerts: tris,
      features: header.features ?? [],
      triFeatureIds,
      // Stats default to zeros if a stale server doesn't include them;
      // the info panel will simply show 0 / "no" until the next mesh arrives.
      volume: header.volume ?? 0,
      surfaceArea: header.surfaceArea ?? 0,
      genus: header.genus ?? 0,
      bboxMin: header.bboxMin ?? [0, 0, 0],
      bboxMax: header.bboxMax ?? [0, 0, 0],
    });
  };

  open();

  return {
    send(message: unknown): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    isOpen(): boolean {
      return socket !== null && socket.readyState === WebSocket.OPEN;
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
        socket = null;
      }
    },
  };
}

function isMeshHeader(x: unknown): x is MeshHeader {
  return !!x && typeof x === 'object' && (x as { kind?: unknown }).kind === 'mesh';
}

function isModelVersion(x: unknown): x is ModelVersionMessage {
  return !!x && typeof x === 'object' && (x as { kind?: unknown }).kind === 'model_version';
}

function isHello(x: unknown): x is HelloMessage {
  return !!x && typeof x === 'object' && (x as { kind?: unknown }).kind === 'hello';
}
