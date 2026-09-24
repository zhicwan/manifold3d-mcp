import * as THREE from 'three';
import { vi } from 'vitest';
import { RulerController } from '../../packages/viewer/src/measurements/controller.js';
import type { AnnotationStore } from '../../packages/viewer/src/marks/annotation-store.js';
import type { MarksRuntime } from '../../packages/viewer/src/store.js';

export function createMarksRuntime(store: AnnotationStore) {
  const runtime = {
    store,
    ruler: new RulerController(
      { clientWidth: 400, clientHeight: 400 } as HTMLCanvasElement,
      new THREE.PerspectiveCamera(45, 1, 0.1, 100),
      new THREE.Scene(),
      store,
      () => null,
      vi.fn(),
      vi.fn(),
    ),
    openMeasurementComment: vi.fn(),
    setMeasurementAnchor: vi.fn(),
    commitOpenDraft: vi.fn(),
    cancelOpenDraft: vi.fn(),
    flushAnnotations: vi.fn(() => true),
  } satisfies MarksRuntime;
  return runtime;
}
