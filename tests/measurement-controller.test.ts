import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { ViewerModel } from '../packages/protocol/src/wire/model.js';
import type { MeasurementEvidence } from '../packages/protocol/src/wire/measurements.js';
import { AnnotationStore } from '../packages/viewer/src/marks/annotation-store.js';
import { prepareMeshPicking } from '../packages/viewer/src/scene/mesh-picking.js';
import type { MeasurementCandidate } from '../packages/viewer/src/measurements/geometry.js';
import { layoutDimension } from '../packages/viewer/src/measurements/projection.js';

const mocks = vi.hoisted(() => ({ pick: vi.fn(), center: null as MeasurementCandidate | null }));
vi.mock('../packages/viewer/src/measurements/picker.js', () => ({
  pickMeasurement: (...args: unknown[]) => ({ candidates: mocks.pick(...args), faceCenter: mocks.center }),
}));
vi.mock('../packages/viewer/src/measurements/geometry.js', () => ({
  MeasurementGeometry: class {
    measure(a: MeasurementCandidate, b?: MeasurementCandidate): MeasurementEvidence | null {
      if (!b && a.operand.kind === 'edge') {
        const { start, end } = a.operand;
        return {
          kind: 'edge-length',
          operands: [a.operand],
          distance: {
            method: 'segment-length',
            unit: 'mm',
            start,
            end,
            value: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
          },
        };
      }
      if (a.operand.kind === 'edge' && b?.operand.kind === 'point') {
        return {
          kind: 'relation',
          operands: [a.operand, b.operand],
          distance: { method: 'point-segment', unit: 'mm', value: 0, start: a.operand.end, end: b.operand.position },
        };
      }
      if (!b || a.key === b.key || a.operand.kind !== 'point' || b.operand.kind !== 'point') {
        return null;
      }
      return {
        kind: 'relation',
        operands: [a.operand, b.operand],
        distance: { method: 'point-point', unit: 'mm', value: 5, start: [0, 0, 0], end: [3, 4, 0] },
      };
    }
  },
}));
import { RulerController } from '../packages/viewer/src/measurements/controller.js';

const a: MeasurementCandidate = {
  key: 'a',
  operand: { kind: 'point', position: [0, 0, 0] },
  anchor: [0, 0, 0],
  triIds: [],
};
const b: MeasurementCandidate = {
  key: 'b',
  operand: { kind: 'point', position: [3, 4, 0] },
  anchor: [3, 4, 0],
  triIds: [],
};
const payload: ViewerModel = {
  numProp: 3,
  triangles: 0,
  vertices: 0,
  vertProperties: new Float32Array(),
  triVerts: new Uint32Array(),
  mergeFromVert: new Uint32Array(),
  mergeToVert: new Uint32Array(),
  features: [],
  triFeatureIds: new Uint32Array(),
  bboxMin: [0, 0, 0],
  bboxMax: [3, 4, 0],
  volume: 0,
  surfaceArea: 0,
  genus: 0,
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.clearAllMocks();
  mocks.center = null;
});

function setup() {
  const store = new AnnotationStore();
  store.setModelVersion('v1');
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  prepareMeshPicking(mesh);
  const canvas = {
    clientWidth: 500,
    clientHeight: 400,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 }),
  } as HTMLCanvasElement;
  const finished = vi.fn(() => ruler.setActive(false));
  const camera = new THREE.PerspectiveCamera(45, 1.25, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  const requestRender = vi.fn();
  const ruler = new RulerController(canvas, camera, scene, store, () => mesh, requestRender, finished);
  ruler.setPayload(payload);
  ruler.setActive(true);
  cleanups.push(() => {
    ruler.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  return { ruler, store, scene, finished, camera, canvas, mesh, requestRender };
}

describe('ruler interaction lifecycle', () => {
  it('inspects a retained dimension in Measure without exiting the tool or leaving a pending comparison', () => {
    const { ruler, store, finished } = setup();
    const edge: MeasurementCandidate = {
      key: 'edge',
      operand: { kind: 'edge', edgeId: 'edge', start: [0, 0, 0], end: [3, 4, 0] },
      anchor: [1.5, 2, 0],
      triIds: [],
    };
    mocks.pick.mockReturnValue([edge]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    const id = store.list()[0]!.id;
    ruler.inspect(id);
    expect(ruler.getSnapshot()).toMatchObject({
      active: true,
      activeMeasurementId: null,
      locked: null,
      expandedId: id,
    });
    expect(store.list()).toHaveLength(1);
    expect(finished).not.toHaveBeenCalled();
  });

  it('shows a hovered face center without persisting it, then clears it on model replacement', () => {
    const { ruler, store, scene } = setup();
    const center: MeasurementCandidate = {
      key: 'face-center:0',
      operand: { kind: 'point', position: [0, 0, 0.5], faceCenter: { patchId: 0 } },
      anchor: [0, 0, 0.5],
      triIds: [],
    };
    mocks.center = center;
    mocks.pick.mockReturnValue([]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.frame();
    expect(ruler.getSnapshot().faceCenter).toBe(center);
    expect(store.list()).toEqual([]);
    expect(scene.getObjectByName('measurement-point')?.visible).toBe(true);
    ruler.setPayload({ ...payload });
    expect(ruler.getSnapshot().faceCenter).toBeNull();
    expect(scene.getObjectByName('measurement-point')).toBeUndefined();
  });

  it('clears the face-center hint when the pointer leaves the surface', () => {
    const { ruler, scene } = setup();
    mocks.center = {
      key: 'face-center:0',
      operand: { kind: 'point', position: [0, 0, 0.5], faceCenter: { patchId: 0 } },
      anchor: [0, 0, 0.5],
      triIds: [],
    };
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.clearHover();
    expect(ruler.getSnapshot().faceCenter).toBeNull();
    expect(scene.getObjectByName('measurement-point')).toBeUndefined();
  });

  it('clears projected preview state at the model-changing boundary before a replacement arrives', () => {
    const { ruler } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    expect(ruler.getSnapshot().previewLabel).not.toBeNull();
    const states: ReturnType<typeof ruler.getSnapshot>[] = [];
    ruler.subscribe(() => states.push(ruler.getSnapshot()));
    ruler.modelChanging();
    expect(states.length).toBeGreaterThan(0);
    expect(states.every(state => state.previewLabel === null)).toBe(true);
  });

  it('keeps the length visible after locking a single edge or leaving the hovered surface', () => {
    const { ruler, store } = setup();
    const edge: MeasurementCandidate = {
      key: 'edge',
      operand: { kind: 'edge', edgeId: 'edge', start: [0, 0, 0], end: [3, 4, 0] },
      anchor: [1.5, 2, 0],
      triIds: [],
    };
    mocks.pick.mockReturnValue([edge]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    expect(ruler.getSnapshot().preview).toMatchObject({ kind: 'edge-length', distance: { value: 5 } });
    expect(ruler.getSnapshot().previewLabel).not.toBeNull();
    ruler.frame();
    expect(ruler.getSnapshot().previewLabel).not.toBeNull();
    ruler.clearHover();
    expect(ruler.getSnapshot().preview?.distance?.value).toBe(5);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.id).toBe(ruler.getSnapshot().activeMeasurementId);
    ruler.escape();
    expect(ruler.getSnapshot().active).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it('replaces the single-edge result with the selected relationship instead of adding a second result', () => {
    const { ruler, store } = setup();
    const edge: MeasurementCandidate = {
      key: 'edge',
      operand: { kind: 'edge', edgeId: 'edge', start: [0, 0, 0], end: [3, 4, 0] },
      anchor: [1.5, 2, 0],
      triIds: [],
    };
    mocks.pick.mockReturnValue([edge]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    const id = ruler.getSnapshot().activeMeasurementId;
    mocks.pick.mockReturnValue([b]);
    ruler.hover({ clientX: 250, clientY: 200 });
    ruler.confirmCandidate();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ id, measurement: { kind: 'relation' } });
    expect(ruler.getSnapshot()).toMatchObject({ active: false, activeMeasurementId: null });
  });

  it('keeps the same projected label and avoids redraw churn while moving over one snapped element', () => {
    const { ruler } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    const label = ruler.getSnapshot().previewLabel;
    expect(label).not.toBeNull();
    const listener = vi.fn();
    ruler.subscribe(listener);
    for (let offset = 1; offset <= 20; offset++) {
      ruler.hover({ clientX: 100 + offset, clientY: 100 });
    }
    expect(ruler.getSnapshot().previewLabel).toBe(label);
    expect(listener).not.toHaveBeenCalled();
  });

  it('updates a changed target atomically without publishing an empty label between targets', () => {
    const { ruler } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    const states: ReturnType<typeof ruler.getSnapshot>[] = [];
    ruler.subscribe(() => states.push(ruler.getSnapshot()));
    mocks.pick.mockReturnValue([b]);
    ruler.hover({ clientX: 200, clientY: 180 });
    expect(states).toHaveLength(1);
    expect(states[0]?.candidate).toBe(b);
    expect(states[0]?.previewLabel).not.toBeNull();
  });

  it('repicks under a stationary pointer after camera changes without losing the locked operand', () => {
    const { ruler, camera } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    mocks.pick.mockReturnValue([b]);
    ruler.hover({ clientX: 250, clientY: 200 });
    ruler.frame();
    const before = mocks.pick.mock.calls.length;
    camera.position.x = 0.5;
    camera.lookAt(0, 0, 0);
    ruler.frame();
    expect(mocks.pick.mock.calls.length).toBeGreaterThan(before);
    expect(ruler.getSnapshot()).toMatchObject({ locked: a, candidate: b });
    expect(ruler.getSnapshot().previewLabel).not.toBeNull();
  });

  it.each(['viewport', 'model'] as const)('repicks after %s transforms without moving the pointer', change => {
    const { ruler, canvas, mesh } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.frame();
    const before = mocks.pick.mock.calls.length;
    mocks.pick.mockReturnValue([b]);
    if (change === 'viewport') {
      Object.defineProperty(canvas, 'clientWidth', { value: 600 });
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400 }) as DOMRect;
    } else {
      mesh.position.x = 1;
    }
    ruler.frame();
    expect(mocks.pick.mock.calls.length).toBe(before + 1);
    expect(ruler.getSnapshot().candidate).toBe(b);
  });

  it('pauses hover during navigation and restores it at the current pointer on release', () => {
    const { ruler, camera } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    ruler.setNavigating(true);
    const before = mocks.pick.mock.calls.length;
    ruler.trackPointer({ clientX: 300, clientY: 220 });
    camera.position.x = 1;
    ruler.frame();
    expect(mocks.pick).toHaveBeenCalledTimes(before);
    expect(ruler.getSnapshot().candidate).toBeNull();
    mocks.pick.mockReturnValue([b]);
    ruler.setNavigating(false);
    expect(ruler.getSnapshot()).toMatchObject({ locked: a, candidate: b });
    expect(mocks.pick.mock.lastCall?.[0].ndc.x).toBeCloseTo(0.2);
  });

  it('repicks a fast click when pointer tracking ran ahead of the hover frame', () => {
    const { ruler } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.trackPointer({ clientX: 300, clientY: 220 });
    mocks.pick.mockReturnValue([b]);
    ruler.click({ clientX: 300, clientY: 220 });
    expect(ruler.getSnapshot().locked).toBe(b);
  });

  it('locks the visible highest-ranked candidate without a separate chooser', () => {
    const { ruler } = setup();
    const edge: MeasurementCandidate = {
      key: 'edge',
      operand: { kind: 'edge', edgeId: 'edge', start: [0, 0, 0], end: [3, 4, 0] },
      anchor: [1.5, 2, 0],
      triIds: [],
    };
    mocks.pick.mockReturnValue([edge, a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    expect(ruler.getSnapshot().candidate).toBe(edge);
    ruler.confirmCandidate();
    expect(ruler.getSnapshot().locked).toBe(edge);
  });

  it('previews without persisting, locks A, and completes explicitly back to Orbit', () => {
    const { ruler, store, finished } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    expect(store.list()).toEqual([]);
    ruler.confirmCandidate();
    expect(ruler.getSnapshot().locked).toBe(a);
    mocks.pick.mockReturnValue([]);
    ruler.hover({ clientX: 200, clientY: 200 });
    expect(ruler.getSnapshot().locked).toBe(a);
    expect(ruler.getSnapshot().preview).toBeNull();
    mocks.pick.mockReturnValue([b]);
    ruler.hover({ clientX: 250, clientY: 200 });
    expect(ruler.getSnapshot().preview?.distance?.value).toBe(5);
    expect(store.list()).toEqual([]);
    ruler.confirmCandidate();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ kind: 'measurement', note: '' });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(ruler.getSnapshot().active).toBe(false);
  });

  it('cancels a locked operand without deleting completed results', () => {
    const { ruler, store } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    expect(ruler.escape()).toBe(true);
    expect(ruler.getSnapshot().active).toBe(true);
    expect(ruler.escape()).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('invalidates an unfinished pick at the model-version boundary', () => {
    const { ruler, store, finished } = setup();
    mocks.pick.mockReturnValue([a]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    ruler.modelChanging();
    store.setModelVersion('v2');
    ruler.setPayload({ ...payload });
    expect(ruler.getSnapshot()).toMatchObject({ active: false, locked: null, candidate: null, notice: 'changed' });
    expect(store.list()).toEqual([]);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('rebuilds retained rendering without exiting Measure when the same model payload is replayed', () => {
    const { ruler, store, scene, finished } = setup();
    const edge: MeasurementCandidate = {
      key: 'edge',
      operand: { kind: 'edge', edgeId: 'edge', start: [0, 0, 0], end: [3, 4, 0] },
      anchor: [1.5, 2, 0],
      triIds: [],
    };
    mocks.pick.mockReturnValue([edge]);
    ruler.hover({ clientX: 100, clientY: 100 });
    ruler.confirmCandidate();
    expect(store.list()).toHaveLength(1);
    expect(scene.getObjectByName('measurement-point')).toBeDefined();
    finished.mockClear();

    ruler.setPayload({ ...payload });
    ruler.frame();

    expect(ruler.getSnapshot()).toMatchObject({ active: true, locked: null, notice: null });
    expect(store.list()).toHaveLength(1);
    expect(scene.getObjectByName('measurement-point')).toBeDefined();
    expect(finished).not.toHaveBeenCalled();
  });

  it('releases its scene contribution and subscriptions on disposal', () => {
    const { ruler, scene, store } = setup();
    const listener = vi.fn();
    ruler.subscribe(listener);
    ruler.dispose();
    expect(scene.children).toEqual([]);
    store.setModelVersion('later');
    expect(listener).not.toHaveBeenCalled();
  });

  it('reuses fixed evidence placement and settles dimension-layout render feedback without new snapshots', () => {
    const { ruler, store, camera, mesh, requestRender } = setup();
    ruler.setActive(false);
    const edge = { kind: 'edge', edgeId: 'edge', start: [0.5, 0.5, -0.5], end: [0.5, 0.5, 0.5] } as const;
    const annotation = store.addMeasurement(
      {
        kind: 'edge-length',
        operands: [{ ...edge, start: [...edge.start], end: [...edge.end] }],
        distance: { method: 'segment-length', value: 1, unit: 'mm', start: [...edge.start], end: [...edge.end] },
      },
      [0.5, 0.5, 0],
    );
    const tree = mesh.geometry.boundsTree;
    if (!(tree instanceof MeshBVH)) {
      throw new Error('Expected the model-owned mesh BVH.');
    }
    const clearance = vi.spyOn(tree, 'raycastFirst');
    ruler.frame();
    expect(clearance.mock.calls.length).toBeGreaterThan(0);
    clearance.mockClear();
    for (let step = 1; step <= 20; step++) {
      camera.position.x = step / 20;
      camera.lookAt(0, 0, 0);
      store.updateMeasurementNote(annotation.id, `note ${step}`);
      ruler.frame();
    }
    expect(clearance).not.toHaveBeenCalled();
    expect(store.get(annotation.id)).toMatchObject({ measurement: annotation.measurement });
    let scheduled = false;
    requestRender.mockImplementation(() => {
      scheduled = true;
    });
    const listener = vi.fn(() => {
      for (const label of ruler.getSnapshot().labels) {
        ruler.setDimension(label.id, layoutDimension(label, 30).strokes, 500, 400, '#3979e3');
      }
      // Anchor registration can request another frame independently of the
      // dimension strokes. Neither request makes projection state dirty.
      requestRender();
    });
    ruler.subscribe(listener);
    camera.position.x += 0.5;
    camera.lookAt(0, 0, 0);
    ruler.frame();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(scheduled).toBe(true);
    const settled = ruler.getSnapshot();
    const label = settled.labels[0];
    expect(label).toBeDefined();
    let followupFrames = 0;
    while (scheduled && followupFrames < 20) {
      scheduled = false;
      ruler.frame();
      followupFrames++;
    }
    expect(followupFrames).toBe(1);
    expect(scheduled).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ruler.getSnapshot()).toBe(settled);
    expect(ruler.getSnapshot().labels).toBe(settled.labels);
    expect(ruler.getSnapshot().labels[0]).toBe(label);
    listener.mockClear();
    requestRender.mockClear();
    for (let step = 0; step < 20; step++) {
      ruler.frame();
    }
    expect(ruler.getSnapshot()).toBe(settled);
    expect(listener).not.toHaveBeenCalled();
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('returns owned scene resources and subscriptions to baseline over 20 create/replace/dispose cycles', () => {
    for (let cycle = 0; cycle < 20; cycle++) {
      const { ruler, store, scene, mesh, requestRender } = setup();
      const unrelated = new THREE.Group();
      scene.add(unrelated);
      const borrowedTree = mesh.geometry.boundsTree;
      const resources = new Map<THREE.BufferGeometry | THREE.Material, number>();
      const observeResources = () =>
        scene.traverse(object => {
          if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) {
            return;
          }
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const resource of [object.geometry, ...materials]) {
            if (!resources.has(resource)) {
              resources.set(resource, 0);
              resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource)! + 1));
            }
          }
        });
      const edge: MeasurementCandidate = {
        key: 'edge',
        operand: { kind: 'edge', edgeId: 'edge', start: [0.5, 0.5, -0.5], end: [0.5, 0.5, 0.5] },
        anchor: [0.5, 0.5, 0],
        triIds: [],
      };
      mocks.pick.mockReturnValue([edge]);
      ruler.hover({ clientX: 100, clientY: 100 });
      observeResources();
      ruler.confirmCandidate();
      ruler.frame();
      const label = ruler.getSnapshot().labels[0]!;
      ruler.setDimension(label.id, layoutDimension(label, 30).strokes, 500, 400, '#3979e3');
      observeResources();
      expect(resources.size).toBeGreaterThan(8);
      ruler.modelChanging();
      store.setModelVersion(`replacement-${cycle}`);
      ruler.setPayload({ ...payload });
      expect(scene.getObjectByName('measurement-point')).toBeUndefined();
      expect(scene.getObjectByName(`dimension:${label.id}`)).toBeUndefined();
      expect([...resources.values()].every(count => count === 1)).toBe(true);
      expect(mesh.geometry.boundsTree).toBe(borrowedTree);
      ruler.setActive(true);
      ruler.hover({ clientX: 100, clientY: 100 });
      observeResources();
      const listener = vi.fn();
      ruler.subscribe(listener);
      ruler.dispose();
      expect(scene.children).toEqual([unrelated]);
      expect([...resources.values()].every(count => count === 1)).toBe(true);
      expect(mesh.geometry.boundsTree).toBe(borrowedTree);
      requestRender.mockClear();
      store.setModelVersion(`disposed-${cycle}`);
      ruler.frame();
      expect(listener).not.toHaveBeenCalled();
      expect(requestRender).not.toHaveBeenCalled();
    }
  });
});
