import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MeasurementRenderer } from '../packages/viewer/src/measurements/renderer.js';
import type { MeasurementCandidate } from '../packages/viewer/src/measurements/geometry.js';
import { AnnotationStore } from '../packages/viewer/src/marks/annotation-store.js';
import { SCENE_PALETTE } from '../packages/viewer/src/scene/palette.js';

describe('measurement result rendering', () => {
  it('uses the same small spheres for points and surface centers', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.scale.set(2, 3, 1);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.up.set(0, 1, 0);
    camera.position.z = 10;
    camera.updateMatrixWorld();
    const renderer = new MeasurementRenderer(scene, () => mesh);
    const point: MeasurementCandidate = {
      key: 'point',
      operand: { kind: 'point', position: [0.5, 0, 1] },
      anchor: [0.5, 0, 1],
      triIds: [],
    };
    const center: MeasurementCandidate = {
      key: 'face-center:8',
      operand: { kind: 'point', position: [0, 0, 1], faceCenter: { patchId: 8 } },
      anchor: [0, 0, 1],
      triIds: [8, 9],
    };
    renderer.setPreview(point, null, null, center);
    renderer.updateMarkers(camera, 400, 400);
    scene.updateMatrixWorld(true);
    const sphere = scene.getObjectByName('measurement-point');
    const ring = scene.getObjectByName('face-center-marker');
    if (!(sphere instanceof THREE.Mesh)) {
      throw new Error('Expected a sphere marker mesh.');
    }
    expect(ring).toBeUndefined();
    expect(sphere.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(sphere.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(sphere.visible).toBe(true);
    const scale = new THREE.Vector3().setFromMatrixScale(sphere.matrixWorld);
    expect(scale.x).toBeCloseTo(scale.y);
    expect(scale.x).toBeCloseTo(scale.z);
    const centerWorld = new THREE.Vector3().setFromMatrixPosition(sphere.matrixWorld);
    const centerScreen = centerWorld.clone().project(camera);
    const sideScreen = centerWorld
      .clone()
      .add(new THREE.Vector3(scale.x, 0, 0))
      .project(camera);
    expect((sideScreen.x - centerScreen.x) * 200).toBeCloseTo(3.5, 4);
    renderer.setPreview(center, null, null);
    expect(scene.getObjectByName('face-center-marker')).toBeUndefined();
    const surfaceCenter = scene.getObjectByName('measurement-point');
    if (!(surfaceCenter instanceof THREE.Mesh) || !(surfaceCenter.material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('A center on the surface should use the same sphere as other points.');
    }
    const color = surfaceCenter.material.color;
    expect(color.getHex()).toBe(SCENE_PALETTE.light.spatial);
    expect(surfaceCenter.material.opacity).toBe(0.75);
    renderer.setTheme('dark');
    expect(color.getHex()).toBe(SCENE_PALETTE.dark.spatial);
    renderer.setPreview(
      point,
      {
        ...point,
        key: 'second',
        operand: { kind: 'point', position: [0, 0.5, 1] },
      },
      null,
      {
        ...center,
        operand: { kind: 'point', position: [0, 0, 1], faceCenter: { patchId: 8 } },
      },
    );
    let markerCount = 0;
    scene.traverse(object => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
        expect(object.material.color.getHex()).toBe(SCENE_PALETTE.dark.spatial);
        markerCount++;
      }
    });
    expect(markerCount).toBe(3);
    renderer.dispose();
    expect(scene.children).toEqual([]);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it('draws visible and occluded strokes in complementary depth passes and disposes both', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 10;
    camera.updateMatrixWorld();
    const renderer = new MeasurementRenderer(scene, () => mesh);
    renderer.setDimension(
      'test',
      [
        {
          start: { x: 20, y: 100, depth: 0.8 },
          end: { x: 180, y: 100, depth: 0.8 },
        },
      ],
      camera,
      200,
      200,
      '#3979e3',
    );
    const group = scene.getObjectByName('dimension:test')!;
    expect(group.children).toHaveLength(2);
    const lines = group.children.filter(
      (object): object is THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> =>
        object instanceof THREE.Line && object.material instanceof THREE.LineBasicMaterial,
    );
    expect(lines.map(line => line.material.depthFunc)).toEqual([THREE.LessEqualDepth, THREE.GreaterDepth]);
    expect(lines.every(line => line.material.depthTest && !line.material.depthWrite)).toBe(true);
    expect(lines[1]!.material).toBeInstanceOf(THREE.LineDashedMaterial);
    const resources = lines.map(line => ({ geometry: line.geometry, material: line.material }));
    renderer.setDimension(
      'test',
      [
        {
          start: { x: 30, y: 110, depth: 0.7 },
          end: { x: 170, y: 110, depth: 0.7 },
        },
      ],
      camera,
      200,
      200,
      '#123456',
    );
    const updated = scene.getObjectByName('dimension:test')!.children as THREE.Line[];
    expect(updated.map(line => ({ geometry: line.geometry, material: line.material }))).toEqual(resources);
    expect(updated.every(line => (line.material as THREE.LineBasicMaterial).color.getHexString() === '123456')).toBe(
      true,
    );
    let disposed = 0;
    for (const line of lines) {
      line.geometry.addEventListener('dispose', () => {
        disposed++;
      });
    }
    renderer.removeDimension('test');
    expect(disposed).toBe(2);
    expect(scene.getObjectByName('dimension:test')).toBeUndefined();
    renderer.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it('highlights both planar operands when an angle-only result is opened and releases its geometry', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    const renderer = new MeasurementRenderer(scene, () => mesh);
    const a: MeasurementCandidate = {
      key: 'plane-a',
      triIds: [0, 1],
      anchor: [1, 0, 0],
      operand: { kind: 'plane', patchId: 0, triangleId: 0, origin: [1, 0, 0], normal: [1, 0, 0] },
    };
    const b: MeasurementCandidate = {
      key: 'plane-b',
      triIds: [4, 5],
      anchor: [0, 1, 0],
      operand: { kind: 'plane', patchId: 1, triangleId: 4, origin: [0, 1, 0], normal: [0, 1, 0] },
    };
    const store = new AnnotationStore();
    const item = store.addMeasurement(
      {
        kind: 'relation',
        operands: [a.operand, b.operand],
        angle: { method: 'plane-plane', value: 90, unit: 'deg' },
      },
      [1, 0, 0],
    );
    renderer.setResults([item], item.id, id => (id === 0 ? a : b));
    const patches: THREE.Mesh[] = [];
    scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        patches.push(object);
      }
    });
    expect(patches).toHaveLength(2);
    expect(patches.every(patch => patch.geometry.getAttribute('position').count === 6)).toBe(true);
    let disposed = 0;
    for (const patch of patches) {
      patch.geometry.addEventListener('dispose', () => {
        disposed++;
      });
    }
    renderer.dispose();
    expect(disposed).toBe(2);
    expect(scene.children).toEqual([]);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});
