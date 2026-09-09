import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { AnnotationStore } from '../../packages/viewer/src/marks/annotation-store.js';
import { placeEditor, updatePositions } from '../../packages/viewer/src/marks/flyout/flyout-projection.js';

interface FakeStyle {
  display: string;
  transform: string;
}

function fakeElement(): { style: FakeStyle } {
  return { style: { display: '', transform: '' } };
}

function makeCamera(): THREE.PerspectiveCamera {
  // Camera at z=5 looking at origin. With default fov/aspect/near/far, a
  // point at the origin lands dead-centre and is in front of the camera.
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('updatePositions', () => {
  it('slides past a nearby rail instead of sending the editor to the bottom edge', () => {
    const result = placeEditor({ x: 819, y: 420 }, { width: 320, height: 44 }, { x: 1280, y: 798 }, [
      { x: 1164, y: 256, width: 100, height: 264 },
    ]);
    expect(result.x + 320).toBeLessThanOrEqual(1156);
    expect(result.y).toBeGreaterThan(434);
    expect(result.y).toBeLessThan(450);
  });

  it.each([320, 400, 720, 1280])('keeps an expanded editor inside a %ipx viewport and away from tools', width => {
    const editor = { width: Math.min(width - 24, 320), height: 48 };
    const rail = { x: width - 60, y: 200, width: 48, height: 300 };
    for (const anchor of [
      { x: width - 10, y: 300 },
      { x: 5, y: 5 },
      { x: width / 2, y: 695 },
    ]) {
      const result = placeEditor(anchor, editor, { x: width, y: 720 }, [rail]);
      expect(result.x).toBeGreaterThanOrEqual(12);
      expect(result.x + editor.width).toBeLessThanOrEqual(width - 12);
      expect(result.y).toBeGreaterThanOrEqual(12);
      expect(result.y + editor.height).toBeLessThanOrEqual(708);
      expect(
        result.x + editor.width <= rail.x - 8 ||
          result.y + editor.height <= rail.y - 8 ||
          result.y >= rail.y + rail.height + 8,
      ).toBe(true);
    }
  });

  it('does not pin an off-screen anchor to an unrelated position on the model', () => {
    const store = new AnnotationStore();
    const ann = store.addComment({
      kind: 'point',
      worldCoord: [50, 0, 0],
      anchorWorld: [50, 0, 0],
      triIds: [],
      note: '',
    });
    const el = fakeElement();
    updatePositions(makeCamera(), store, new Map([[ann.id, el as unknown as HTMLElement]]), { x: 800, y: 600 });
    expect(el.style.display).toBe('none');
  });

  it('distinguishes a back-surface anchor from a visible anchor without moving either', () => {
    const store = new AnnotationStore();
    const front = store.addComment({
      kind: 'point',
      worldCoord: [0, 0, 1],
      anchorWorld: [0, 0, 1],
      triIds: [],
      note: 'front',
    });
    const back = store.addComment({
      kind: 'point',
      worldCoord: [0, 0, -1],
      anchorWorld: [0, 0, -1],
      triIds: [],
      note: 'back',
    });
    const make = () => ({
      ...fakeElement(),
      dataset: {} as Record<string, string>,
      classList: { contains: () => false },
    });
    const a = make();
    const b = make();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    updatePositions(
      makeCamera(),
      store,
      new Map([
        [front.id, a as unknown as HTMLElement],
        [back.id, b as unknown as HTMLElement],
      ]),
      { x: 800, y: 600 },
      new THREE.Vector3(),
      { mesh, editorSizes: new Map(), obstacles: [] },
    );
    expect(a.dataset.occluded).toBe('false');
    expect(b.dataset.occluded).toBe('true');
    expect(a.style.transform).toBe(b.style.transform);
    expect(store.get(back.id)?.anchorWorld).toEqual([0, 0, -1]);
    mesh.geometry.dispose();
  });
  it('places an anchor at the origin in the centre of the screen', () => {
    const store = new AnnotationStore();
    const ann = store.addComment({
      kind: 'point',
      worldCoord: [0, 0, 0],
      anchorWorld: [0, 0, 0],
      triIds: [],
      note: '',
    });
    const el = fakeElement();
    const elements = new Map<string, HTMLElement>([[ann.id, el as unknown as HTMLElement]]);

    updatePositions(makeCamera(), store, elements, { x: 800, y: 600 });

    expect(el.style.display).toBe('');
    // Center of the screen → translate(400, 300)
    expect(el.style.transform).toMatch(/^translate\(400(\.\d+)?px,\s*300(\.\d+)?px\)$/);
  });

  it('hides anchors that project behind the camera', () => {
    const store = new AnnotationStore();
    // Behind the camera (camera at z=5 looks down -z, so positive z way
    // beyond the camera lies behind).
    const ann = store.addComment({
      kind: 'point',
      worldCoord: [0, 0, 50],
      anchorWorld: [0, 0, 50],
      triIds: [],
      note: '',
    });
    const el = fakeElement();
    el.style.display = '';
    const elements = new Map<string, HTMLElement>([[ann.id, el as unknown as HTMLElement]]);

    updatePositions(makeCamera(), store, elements, { x: 800, y: 600 });

    expect(el.style.display).toBe('none');
  });

  it('skips elements whose annotation no longer exists in the store', () => {
    const store = new AnnotationStore();
    const el = fakeElement();
    el.style.display = 'preserved';
    el.style.transform = 'preserved';
    const elements = new Map<string, HTMLElement>([['ghost', el as unknown as HTMLElement]]);

    updatePositions(makeCamera(), store, elements, { x: 800, y: 600 });

    expect(el.style.display).toBe('preserved');
    expect(el.style.transform).toBe('preserved');
  });
});
