import * as THREE from 'three';

import type { AnnotationStore } from '../annotation-store.js';

/**
 * Pure per-frame screen projection helper for the flyout layer.
 *
 * Projects each annotation's world-space anchor into NDC, then maps to
 * pixel coordinates using a caller-supplied `screenSize`. Hides flyouts
 * whose anchor is behind the camera (z outside [-1, 1]).
 *
 * The caller skips unchanged frames and supplies cached editor dimensions.
 */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function placeEditor(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { x: number; y: number },
  obstacles: readonly ScreenRect[] = [],
): { x: number; y: number } {
  const pad = 12;
  const clamp = (value: number, length: number, limit: number) => Math.max(pad, Math.min(value, limit - length - pad));
  const xs = [anchor.x + 18, anchor.x - size.width - 18, (viewport.x - size.width) / 2];
  const ys = [anchor.y + 18, anchor.y - size.height - 18, viewport.y - size.height - 96, 88];
  for (const rect of obstacles) {
    xs.push(rect.x - size.width - 8, rect.x + rect.width + 8);
    ys.push(rect.y - size.height - 8, rect.y + rect.height + 8);
  }
  let best = { x: pad, y: pad };
  let bestScore = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const candidate = { x: clamp(x, size.width, viewport.x), y: clamp(y, size.height, viewport.y) };
      const overlap = obstacles.reduce((area, rect) => {
        const width = Math.max(
          0,
          Math.min(candidate.x + size.width, rect.x + rect.width + 8) - Math.max(candidate.x, rect.x - 8),
        );
        const height = Math.max(
          0,
          Math.min(candidate.y + size.height, rect.y + rect.height + 8) - Math.max(candidate.y, rect.y - 8),
        );
        return area + width * height;
      }, 0);
      const distance = Math.hypot(
        Math.max(candidate.x - anchor.x, 0, anchor.x - candidate.x - size.width),
        Math.max(candidate.y - anchor.y, 0, anchor.y - candidate.y - size.height),
      );
      const coversAnchor =
        anchor.x > candidate.x - 14 &&
        anchor.x < candidate.x + size.width + 14 &&
        anchor.y > candidate.y - 14 &&
        anchor.y < candidate.y + size.height + 14;
      const score =
        (overlap + (coversAnchor ? size.width * size.height : 0)) * 1000 +
        distance +
        Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) * 0.01;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

export function updatePositions(
  camera: THREE.Camera,
  store: AnnotationStore,
  elements: ReadonlyMap<string, HTMLElement>,
  screenSize: { x: number; y: number },
  scratch: THREE.Vector3 = new THREE.Vector3(),
  presentation?: {
    mesh: THREE.Mesh | null;
    editorSizes: ReadonlyMap<string, { width: number; height: number }>;
    obstacles: readonly ScreenRect[];
  },
): void {
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const point = new THREE.Vector3();
  presentation?.mesh?.updateWorldMatrix(true, false);
  for (const [id, el] of elements) {
    const ann = store.get(id);
    if (!ann) {
      continue;
    }
    scratch.fromArray(ann.anchorWorld).project(camera);
    const visible = scratch.z >= -1 && scratch.z <= 1 && Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1;
    if (!visible) {
      el.style.display = 'none';
      continue;
    }
    const x = (scratch.x * 0.5 + 0.5) * screenSize.x;
    const y = (1 - (scratch.y * 0.5 + 0.5)) * screenSize.y;
    el.style.display = '';
    el.style.transform = `translate(${x}px, ${y}px)`;
    if (presentation) {
      el.dataset.labelSide = x > screenSize.x - 240 ? 'left' : 'right';
      const mesh = presentation.mesh;
      let occluded = false;
      if (mesh) {
        ray.setFromCamera(new THREE.Vector2(scratch.x, scratch.y), camera);
        const distance = ray.ray.origin.distanceTo(point.fromArray(ann.anchorWorld));
        ray.far = distance - Math.max(0.0001, distance * 0.0001);
        occluded = ray.intersectObject(mesh, false).length > 0;
      }
      el.dataset.occluded = String(occluded);
      const size = presentation.editorSizes.get(id);
      if (size && el.classList.contains('expanded')) {
        const position = placeEditor({ x, y }, size, screenSize, presentation.obstacles);
        el.style.setProperty('--editor-x', `${position.x - x}px`);
        el.style.setProperty('--editor-y', `${position.y - y}px`);
        const endX = Math.max(position.x, Math.min(x, position.x + size.width));
        const endY = Math.max(position.y, Math.min(y, position.y + size.height));
        el.querySelector('.marks-leader path')?.setAttribute('d', `M0 0 L${endX - x} ${endY - y}`);
      }
    }
  }
}
