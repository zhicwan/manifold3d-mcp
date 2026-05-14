/**
 * Preview server: serves the static viewer page over HTTP and pushes mesh
 * payloads to the browser over WebSocket. Caches the most recent payload so
 * a tab reload (or user reopening the page) immediately shows the latest model.
 *
 * WS protocol (described once here):
 *   1. Server -> client text frame: { kind: 'hello', clientId } (VIE-2)
 *   2. Server -> client text frame: { kind: 'model_version', modelVersion }
 *   3. Server -> client text frame: JSON header
 *        { kind: 'mesh', description, numProp, triangles, vertices, ... }
 *   4. Server -> client binary frame: vertProperties (Float32Array)
 *   5. Server -> client binary frame: triVerts (Uint32Array)
 *   6. Server -> client binary frame: triFeatureIds (Uint32Array)
 *   On new connection the server replays the last cached triple, if any.
 *
 * Multi-tab annotations (VIE-2): each WS connection is assigned a UUID
 * `clientId` and its annotation snapshots are stored in a per-client
 * bucket keyed by clientId. `getAnnotations()` returns the union across
 * all live (or recently-disconnected) clients. When a tab disconnects
 * we DON'T evict immediately — there's a 5-second grace window so a
 * page reload doesn't drop the user's marks. After the grace expires
 * the bucket is removed.
 *
 * Cache-Control matrix (VIE-4):
 *   - index.html  -> no-store               (always pick up new bundle hashes)
 *   - assets/*    -> immutable, max-age=1y  (Vite hashes filenames)
 *   - everything  -> max-age=300            (5-minute browser cache)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  isAnnotationsMessage,
  type WireAnnotation,
} from '../../shared/wire/annotations.js';
import type { MeshPayload } from '../runner/protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// preview-server.js lives at dist/server/preview/preview-server.js; the
// Vite-built viewer bundle is at dist/public — go up two directories
// (preview/ -> server/ -> dist/) to reach it.
const PUBLIC_DIR = join(HERE, '..', '..', 'public');

/** How long to keep a disconnected client's annotations cached (ms). */
const ANNOTATION_GRACE_MS = 5_000;

export interface PreviewServerHandle {
  url: string;
  port: number;
  push(mesh: MeshPayload): void;
  /** Returns the union of all live & recently-disconnected viewers' annotations. */
  getAnnotations(): { modelVersion: string; items: WireAnnotation[] };
  close(): Promise<void>;
}

export async function startPreviewServer(preferredPort = 3737, host = '127.0.0.1'): Promise<PreviewServerHandle> {
  const port = await findFreePort(preferredPort, host);

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TST-8 follow-up: handleHttp is async; node's http.createServer accepts a void-returning listener, refactor in next phase
  const http = createServer((req, res) => handleHttp(req, res));
  const wss = new WebSocketServer({ noServer: true });

  // Allow-list of Origin/Host values that may upgrade to a WebSocket. The
  // viewer page is always served from this same server, so the browser will
  // send one of these origins automatically. Anything else (a different
  // origin trying to read meshes / inject annotations, or a DNS-rebinding
  // host header) is rejected at the upgrade handshake.
  const allowedOrigins = new Set<string>([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  if (process.env.NODE_ENV === 'development') {
    // Vite dev server proxies to us during local viewer development.
    allowedOrigins.add('http://127.0.0.1:5173');
    allowedOrigins.add('http://localhost:5173');
  }
  const allowedHosts = new Set<string>([`127.0.0.1:${port}`, `localhost:${port}`]);

  let lastPayload: MeshPayload | undefined;
  let modelVersion = 'none';
  // Per-client annotation buckets: clientId -> id -> annotation. A Map
  // (rather than array) avoids duplicate-id collisions inside one tab
  // and gives O(1) replacement.
  const annotationsByClient = new Map<string, Map<string, WireAnnotation>>();
  // Pending eviction timers for disconnected clients (clientId -> Timeout).
  const pendingEvictions = new Map<string, NodeJS.Timeout>();
  const clients = new Set<WebSocket>();

  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    const hostHeader = req.headers.host;
    const reject = (reason: string): void => {
      // stderr only — stdout is reserved for the MCP JSON-RPC stream.
      process.stderr.write(`[preview-server] rejected WS upgrade: ${reason} (origin=${origin ?? 'none'}, host=${hostHeader ?? 'none'})\n`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
    };
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      reject('origin not allow-listed');
      return;
    }
    if (typeof hostHeader !== 'string' || !allowedHosts.has(hostHeader)) {
      reject('host not allow-listed (possible DNS rebinding)');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const clientId = randomUUID();
      annotationsByClient.set(clientId, new Map());
      clients.add(ws);

      ws.on('close', () => {
        clients.delete(ws);
        // Schedule eviction. If the same browser reloads it will get a
        // brand new clientId so the old bucket is just stale data; we
        // still hold it for ANNOTATION_GRACE_MS so that get_annotations()
        // called immediately after a flicker doesn't return an empty list.
        const t = setTimeout(() => {
          annotationsByClient.delete(clientId);
          pendingEvictions.delete(clientId);
        }, ANNOTATION_GRACE_MS);
        // Don't keep the event loop alive solely for this timer — the
        // server may be shutting down in tests / CLI exit.
        t.unref?.();
        pendingEvictions.set(clientId, t);
      });

      ws.on('message', (raw, isBinary) => {
        if (isBinary) {
          // Binary frames from clients are not part of the protocol.
          return;
        }
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString('utf8'));
        } catch {
          return;
        }
        if (isAnnotationsMessage(msg)) {
          // Only accept updates for the current model version. Stale
          // clients pushing for a previous version are silently ignored.
          if (msg.modelVersion !== modelVersion) {
            return;
          }
          const bucket = annotationsByClient.get(clientId) ?? new Map<string, WireAnnotation>();
          // Replace this client's snapshot wholesale — the viewer always
          // sends its full current annotation set, not deltas.
          bucket.clear();
          for (const item of msg.items) {
            bucket.set(item.id, { ...item, clientId });
          }
          annotationsByClient.set(clientId, bucket);
        }
      });

      // Hello frame: tell the viewer which clientId we assigned. The
      // viewer surfaces this in its connection status for debugging.
      ws.send(JSON.stringify({ kind: 'hello', clientId }));

      // Replay the latest cached mesh AND the current model version so
      // a freshly opened viewer can immediately tag its annotations
      // with a version the server will accept.
      if (lastPayload) {
        sendModelVersion(ws, modelVersion);
        sendMesh(ws, lastPayload);
      }
    });
  });

  await new Promise<void>(resolve => http.listen(port, host, resolve));

  return {
    url: `http://${host}:${port}/`,
    port,
    push(mesh: MeshPayload): void {
      lastPayload = mesh;
      // New model → invalidate ALL clients' annotations and bump version.
      // Each viewer will independently clear its own store on receipt of
      // the mesh, then re-push an empty list, which we accept (matches v).
      modelVersion = `v${Date.now().toString(36)}`;
      for (const bucket of annotationsByClient.values()) {
        bucket.clear();
      }
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN) {
          sendModelVersion(ws, modelVersion);
          sendMesh(ws, mesh);
        }
      }
    },
    getAnnotations(): { modelVersion: string; items: WireAnnotation[] } {
      // Flatten the union across all clients. Order across buckets is
      // arbitrary; within a bucket we preserve insertion order.
      const items: WireAnnotation[] = [];
      for (const bucket of annotationsByClient.values()) {
        for (const a of bucket.values()) {
          items.push(a);
        }
      }
      return { modelVersion, items };
    },
    async close(): Promise<void> {
      for (const t of pendingEvictions.values()) {
        clearTimeout(t);
      }
      pendingEvictions.clear();
      annotationsByClient.clear();
      for (const ws of clients) {
        ws.terminate();
      }
      clients.clear();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}

function sendModelVersion(ws: WebSocket, modelVersion: string): void {
  ws.send(JSON.stringify({ kind: 'model_version', modelVersion }));
}

function sendMesh(ws: WebSocket, mesh: MeshPayload): void {
  // Header now includes the features list (small JSON), the geometry
  // stats shown in the control panel's info section, and announces that
  // a per-triangle feature ID buffer follows the two mesh buffers.
  // Header → vertProperties (binary) → triVerts (binary) → triFeatureIds (binary).
  const header = JSON.stringify({
    kind: 'mesh',
    description: mesh.description,
    numProp: mesh.numProp,
    triangles: mesh.triangles,
    vertices: mesh.vertices,
    features: mesh.features,
    hasTriFeatureIds: mesh.triFeatureIds.byteLength > 0,
    volume: mesh.volume,
    surfaceArea: mesh.surfaceArea,
    genus: mesh.genus,
    bboxMin: mesh.bboxMin,
    bboxMax: mesh.bboxMax,
  });
  ws.send(header);
  ws.send(Buffer.from(mesh.vertProperties), { binary: true });
  ws.send(Buffer.from(mesh.triVerts), { binary: true });
  ws.send(Buffer.from(mesh.triFeatureIds), { binary: true });
}

/**
 * Cache-Control header policy for static assets served from PUBLIC_DIR.
 * Exported as `_testCacheControlFor` so the unit test can lock the
 * matrix without spinning up a server.
 */
function cacheControlFor(relativePath: string): string {
  // index.html: never cache. The HTML references hashed asset URLs and
  // is the only thing the browser must re-fetch when the bundle ships.
  if (relativePath === 'index.html' || relativePath === '') {
    return 'no-store';
  }
  // Vite emits assets under assets/ with content-hash filenames like
  // index-CJ7mf_B0.js — safe to mark immutable for a year.
  if (relativePath.startsWith('assets/') || relativePath.startsWith('assets\\')) {
    return 'public, max-age=31536000, immutable';
  }
  // Everything else (favicons, top-level JS shims, etc.) gets a short
  // browser cache so a redeploy is picked up within five minutes.
  return 'public, max-age=300';
}

// Test hook: re-exported as a stable name for unit tests.
export const _testCacheControlFor = cacheControlFor;

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawUrl = req.url ?? '/';
  // Percent-encoded sequences are a common path-traversal bypass (e.g.
  // `/..%2fpackage.json` decodes after our normalize() check). The viewer
  // only ever requests plain hashed asset names, so any percent escape is
  // suspicious — refuse outright instead of trying to decode.
  if (rawUrl.includes('%')) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  const url = rawUrl.split('?')[0];
  const safe = normalize(url).replace(/^[\\/]+/, '');
  const target = safe === '' || safe === 'index.html' ? 'index.html' : safe;
  const filePath = join(PUBLIC_DIR, target);
  // Defense in depth: even after normalize() + leading-slash strip, ensure
  // the resolved path lives strictly under PUBLIC_DIR. `path.relative`
  // returning an absolute path or one starting with `..` means we'd be
  // serving from a sibling directory like `dist/public-evil/`.
  const rel = relative(PUBLIC_DIR, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (!s.isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', mime(filePath));
    res.setHeader('Cache-Control', cacheControlFor(target));
    res.end(await readFile(filePath));
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}

function mime(p: string): string {
  if (p.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (p.endsWith('.js') || p.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (p.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (p.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (p.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (p.endsWith('.png')) {
    return 'image/png';
  }
  return 'application/octet-stream';
}

async function findFreePort(start: number, host: string): Promise<number> {
  for (let p = start; p < start + 50; p++) {
    if (await isFree(p, host)) {
      return p;
    }
  }
  throw new Error(`No free port in range ${start}-${start + 50}`);
}

function isFree(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = createServer();
    probe.once('error', () => {
      resolve(false);
    });
    probe.listen(port, host, () => {
      probe.close(() => resolve(true));
    });
  });
}
