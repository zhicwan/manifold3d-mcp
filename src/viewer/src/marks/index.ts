import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { AnnotationStore } from './annotation-store.js';
import { FeatureResolver } from './feature-resolver.js';
import { FlyoutLayer } from './flyout.js';
import { HoverHighlight } from './hover-highlight.js';
import { MarkerRenderer } from './marker-renderer.js';
import { MarkTool } from './mark-tool.js';
import type { PreviewPayload } from '../types.js';

interface MarksDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  overlayHost: HTMLElement;
  getMesh(): THREE.Mesh | null;
  requestRender(): void;
}

/**
 * Top-level entry point for the marks subsystem. Wires together the
 * store, picker, marker renderer, flyouts and tool. Returns a small
 * handle exposing the few methods the rest of the viewer needs to
 * call: `frame()` once per render frame; `setModelVersion()` and
 * `setPayload()` whenever a new mesh arrives.
 *
 * The sidebar is rendered by React (see <MarksSidebar/>); React reads
 * the same store via useSyncExternalStore and dispatches edits/deletes
 * straight into it.
 */
export function installMarks(deps: MarksDeps): MarksHandle {
  const store = new AnnotationStore();
  const flyouts = new FlyoutLayer(deps.overlayHost, deps.canvas, deps.camera, store, deps.requestRender);
  const markers = new MarkerRenderer(deps.scene, store, deps.getMesh, deps.requestRender);
  let resolver: FeatureResolver | null = null;
  const tool = new MarkTool(
    deps.overlayHost,
    deps.canvas,
    deps.camera,
    deps.controls,
    store,
    flyouts,
    deps.getMesh,
    () => resolver,
  );
  const hover = new HoverHighlight(
    deps.scene,
    deps.canvas,
    deps.camera,
    deps.getMesh,
    () => resolver,
    deps.requestRender,
  );

  return {
    store,
    flyouts,
    frame(): void {
      flyouts.updatePositions();
    },
    setModelVersion(v: string): void {
      store.setModelVersion(v);
    },
    setPayload(payload: PreviewPayload): void {
      // Build a fresh resolver per model so old per-feature AABBs are
      // discarded along with the old mesh.
      resolver = payload.features.length > 0 && payload.triFeatureIds.length > 0 ? new FeatureResolver(payload) : null;
      hover.reset();
    },
    dispose(): void {
      hover.dispose();
      tool.dispose();
      markers.dispose();
      flyouts.dispose();
    },
  };
}

export interface MarksHandle {
  store: AnnotationStore;
  flyouts: FlyoutLayer;
  frame(): void;
  setModelVersion(v: string): void;
  setPayload(payload: PreviewPayload): void;
  dispose(): void;
}
