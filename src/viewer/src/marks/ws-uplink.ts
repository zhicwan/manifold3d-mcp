import type { AnnotationStore } from './annotation-store.js';
import type { Annotation } from './types.js';
import type { WireAnnotation } from '../../../shared/wire/annotations.js';

interface UplinkSink {
  send(message: unknown): void;
  isOpen(): boolean;
}

/**
 * Subscribes to the annotation store and pushes a debounced JSON
 * snapshot of all annotations to the preview server over the WebSocket.
 * The server caches these and returns them to AI clients via the
 * `get_annotations` MCP tool.
 *
 * Debounce window: ~150ms - a balance between responsiveness (AI sees
 * fresh data) and avoiding a flood during rapid typing.
 *
 * Reconnect safety: when the WS is closed at flush time, we record that
 * a flush is owed and replay it as soon as `flushNow()` is invoked
 * again (typically on the next reconnect via `onOpen`). Without this
 * the server's cached annotations would silently drift out of sync
 * after a transient network blip.
 *
 * The wire format is intentionally smaller than the in-memory
 * Annotation: per-triangle indices for region selections are reduced
 * to a triCount, since AI consumers only care about the part label,
 * location, and note.
 */
export function installAnnotationsUplink(store: AnnotationStore, sink: UplinkSink): UplinkHandle {
  let timer: number | undefined;
  let pendingFlush = false;

  const flushNow = (): void => {
    if (!sink.isOpen()) {
      pendingFlush = true;
      return;
    }
    pendingFlush = false;
    const items: WireAnnotation[] = store.list().map(a => toWire(a));
    sink.send({ kind: 'annotations', modelVersion: store.getModelVersion(), items });
  };

  const unsubscribe = store.subscribe(() => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(flushNow, 150);
  });

  return {
    flushNow,
    dispose(): void {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      unsubscribe();
    },
    hasPendingFlush(): boolean {
      return pendingFlush;
    },
  };
}

export interface UplinkHandle {
  /**
   * Force a flush attempt now. If the socket is open, sends the current
   * snapshot and clears the pending-flush flag. If closed, marks a
   * flush as pending so the next call (e.g. from onOpen) will retry.
   */
  flushNow(): void;
  dispose(): void;
  hasPendingFlush(): boolean;
}

function toWire(a: Annotation): WireAnnotation {
  const wire: WireAnnotation = {
    id: a.id,
    modelVersion: a.modelVersion,
    kind: a.kind,
    partLabel: a.partLabel,
    note: a.note,
    worldCoord: a.worldCoord,
  };
  if (a.kind === 'region') {
    wire.triCount = a.triIds.length;
  }
  return wire;
}
