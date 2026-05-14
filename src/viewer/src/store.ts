import { useSyncExternalStore } from 'react';

import type { AnnotationStore } from '@/marks/annotation-store';
import type { FlyoutLayer } from '@/marks/flyout';
import type { Annotation } from '@/marks/types';
import type { ConnectionStatus } from '@/transport/ws-client';
import type { PreviewPayload } from '@/types';

import type { RenderMode } from '@/scene/viewer';

/**
 * Tiny external store. Single-writer per slot from the imperative
 * subsystems (mesh feed, viewer, marks). React subscribes via
 * useSyncExternalStore. NO Zustand; NO Context — both are overkill for
 * a handful of fields with no derived state.
 */
export interface MarksRuntime {
  store: AnnotationStore;
  flyouts: FlyoutLayer;
}

export interface ViewerApi {
  setRenderMode(mode: RenderMode): void;
  // VIE-4: exporters are dynamically imported on first use. The handlers
  // resolve when the module download AND the export step both complete;
  // callers can ignore the returned promise (fire-and-forget click).
  export3mf(): Promise<void>;
  exportStl(): Promise<void>;
}

export interface ViewerState {
  payload: PreviewPayload | null;
  status: ConnectionStatus;
  renderMode: RenderMode;
  modelVersion: string;
  /**
   * Owned by ViewerCanvas — swapped in once installMarks() has wired up
   * the annotation subsystem. ControlPanel and MarksSidebar read it via
   * useViewerState rather than receiving it as a prop, so an early-mount
   * sidebar doesn't see a stale `null` reference (VIE-6).
   */
  marksRuntime: MarksRuntime | null;
  /** Same lifecycle as marksRuntime. Bound by ViewerCanvas. */
  viewerApi: ViewerApi | null;
}

const INITIAL: ViewerState = {
  payload: null,
  status: 'connecting',
  renderMode: 'solid',
  modelVersion: 'unknown',
  marksRuntime: null,
  viewerApi: null,
};

type Listener = () => void;

function createViewerStore() {
  let state: ViewerState = INITIAL;
  const listeners = new Set<Listener>();

  const emit = (): void => {
    for (const fn of listeners) {
      fn();
    }
  };

  return {
    getState(): ViewerState {
      return state;
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setPayload(payload: PreviewPayload | null): void {
      if (state.payload === payload) {
        return;
      }
      state = { ...state, payload };
      emit();
    },
    setStatus(status: ConnectionStatus): void {
      if (state.status === status) {
        return;
      }
      state = { ...state, status };
      emit();
    },
    setRenderMode(renderMode: RenderMode): void {
      if (state.renderMode === renderMode) {
        return;
      }
      state = { ...state, renderMode };
      emit();
    },
    setModelVersion(modelVersion: string): void {
      if (state.modelVersion === modelVersion) {
        return;
      }
      state = { ...state, modelVersion };
      emit();
    },
    setMarksRuntime(marksRuntime: MarksRuntime | null): void {
      if (state.marksRuntime === marksRuntime) {
        return;
      }
      state = { ...state, marksRuntime };
      emit();
    },
    setViewerApi(viewerApi: ViewerApi | null): void {
      if (state.viewerApi === viewerApi) {
        return;
      }
      state = { ...state, viewerApi };
      emit();
    },
  };
}

export const viewerStore = createViewerStore();

export function useViewerState<T>(selector: (s: ViewerState) => T): T {
  return useSyncExternalStore(
    viewerStore.subscribe,
    () => selector(viewerStore.getState()),
    () => selector(INITIAL),
  );
}

/**
 * Subscribe to the existing AnnotationStore via useSyncExternalStore.
 * The annotation store already owns its own pub/sub — we don't mirror
 * it into another store; React reads it directly.
 *
 * Note: AnnotationStore.subscribe immediately invokes the callback
 * synchronously on subscribe, which works fine for SES because the
 * snapshot is read on the next paint anyway.
 */
export function useAnnotations(store: AnnotationStore | null): readonly Annotation[] {
  const subscribe = (fn: Listener): (() => void) => {
    if (!store) {
      return () => undefined;
    }
    return store.subscribe(() => fn());
  };
  const getSnapshot = (): readonly Annotation[] => (store ? store.list() : EMPTY_ANNOTATIONS);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ANNOTATIONS);
}

const EMPTY_ANNOTATIONS: readonly Annotation[] = [];
