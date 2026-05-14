import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type * as THREE from 'three';

import { ViewportGizmo } from 'three-viewport-gizmo';

/**
 * Wraps the third-party ViewportGizmo so the rest of the viewer can
 * stay agnostic of the library: construct, render-per-frame, dispose.
 *
 * Visual: a small cube widget in the top-left of the viewport with
 * Chinese face labels (顶 / 底 / 前 / 后 / 左 / 右) and color-coded
 * axis indicators. Clicking a face snaps the main camera to that view;
 * dragging the cube orbits the model.
 *
 * The cube's orientation auto-syncs with `controls` because we call
 * `attachControls()` once and then `update()` every frame from the
 * viewer's render loop.
 */
export class ViewCube {
  private readonly gizmo: ViewportGizmo;
  private readonly requestRender: () => void;
  private readonly onGizmoChange: () => void;
  private readonly onGizmoStart: () => void;
  private readonly onGizmoEnd: () => void;
  private animating = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    controls: OrbitControls,
    requestRender: () => void,
  ) {
    this.requestRender = requestRender;
    this.gizmo = createViewportGizmo(camera, renderer, {
      type: 'cube',
      size: 110,
      placement: 'top-left',
      offset: { left: 16, top: 16 },
      animated: true,
      speed: 1,
      // The library aliases below map to world faces with DEFAULT_UP=+Z
      // (verified against the lib's `Te = ["x","z","y","nx","nz","ny"]`
      // table in three-viewport-gizmo.js):
      //   right  → +X      left   → -X
      //   top    → +Z      bottom → -Z
      //   front  → +Y      back   → -Y    ← swapped vs what the names suggest
      // In our SolidWorks-style Z-up convention, FRONT is the -Y face
      // (camera-facing in the default iso view at +X / -Y / +Z), so we
      // swap which alias gets the FRONT/BACK label.
      top: { label: 'TOP' },
      bottom: { label: 'BOT' },
      front: { label: 'BACK' },
      back: { label: 'FRONT' },
      right: { label: 'RIGHT' },
      left: { label: 'LEFT' },
    });
    this.gizmo.attachControls(controls);

    // The viewer uses on-demand rendering: it only re-renders when an
    // input source fires a 'change' event. Clicking a gizmo face starts
    // an animated camera tween that doesn't go through OrbitControls,
    // so we have to forward the gizmo's own 'change' / 'start' / 'end'
    // events to the render loop. We also track the animating flag so the
    // viewer can keep ticking the gizmo (and re-rendering the moved
    // camera) every frame for the duration of the tween — without this,
    // a click that resolves in a single frame leaves the main scene
    // rendered with the pre-animation camera position (visible "freeze").
    this.onGizmoChange = (): void => {
      this.requestRender();
    };
    this.onGizmoStart = (): void => {
      this.animating = true;
      this.requestRender();
    };
    this.onGizmoEnd = (): void => {
      this.animating = false;
      this.requestRender();
    };
    this.gizmo.addEventListener('start', this.onGizmoStart);
    this.gizmo.addEventListener('change', this.onGizmoChange);
    this.gizmo.addEventListener('end', this.onGizmoEnd);
  }

  /**
   * True while the gizmo is mid-animation (after a face click). The
   * viewer should call requestRender() every frame while this is true so
   * the gizmo's render() (which advances the tween and moves the camera
   * as a side effect) gets ticked, and the main scene is re-rendered
   * with the updated camera position.
   */
  isAnimating(): boolean {
    return this.animating;
  }

  /** Render after the main scene render so the gizmo overlays the viewport. */
  render(): void {
    this.gizmo.render();
  }

  /** Refresh DOM-derived viewport bounds after the renderer canvas changes size. */
  updateLayout(): void {
    this.gizmo.update(false);
  }

  /** Detach controls listeners and free DOM/GL resources. */
  dispose(): void {
    this.gizmo.removeEventListener('start', this.onGizmoStart);
    this.gizmo.removeEventListener('change', this.onGizmoChange);
    this.gizmo.removeEventListener('end', this.onGizmoEnd);
    this.gizmo.detachControls();
    this.gizmo.dispose();
  }
}

function createViewportGizmo(
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  options: ConstructorParameters<typeof ViewportGizmo>[2],
): ViewportGizmo {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args[0] === 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.') {
      return;
    }
    originalWarn(...args);
  };
  try {
    return new ViewportGizmo(camera, renderer, options);
  } finally {
    console.warn = originalWarn;
  }
}
