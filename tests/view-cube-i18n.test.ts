import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createViewerI18n } from '../packages/viewer/src/i18n/index.js';
import { ViewCube } from '../packages/viewer/src/scene/view-cube.js';

class Element {
  readonly style = {};
  readonly attributes = new Map<string, string>();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  readonly remove = vi.fn();
  readonly context = { clearRect: vi.fn(), fillText: vi.fn() };
  getContext() {
    return this.context;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 104, height: 104 };
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

describe('View cube localization', () => {
  const canvases: Element[] = [];
  const overlays: Element[] = [];
  beforeEach(() => {
    canvases.length = 0;
    overlays.length = 0;
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const element = new Element();
        (tag === 'canvas' ? canvases : overlays).push(element);
        return element;
      },
      body: { appendChild: vi.fn() },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(i18n = createViewerI18n('en')) {
    const render = vi.fn();
    const cube = new ViewCube(
      new THREE.PerspectiveCamera(),
      {} as THREE.WebGLRenderer,
      { target: new THREE.Vector3(), update: vi.fn() } as unknown as OrbitControls,
      render,
      'light',
      i18n,
    );
    return { cube, render };
  }

  it('redraws all six face textures and live ARIA, disposing replaced textures and subscriptions', () => {
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const i18n = createViewerI18n('en');
    const { cube, render } = setup(i18n);
    expect(canvases.map(canvas => canvas.context.fillText.mock.calls[0]?.[0])).toEqual([
      'RIGHT',
      'LEFT',
      'BACK',
      'FRONT',
      'TOP',
      'BOT',
    ]);
    expect(overlays[0]!.attributes.get('aria-label')).toBe('View cube');
    expect(overlays[0]!.attributes.get('lang')).toBe('en');
    i18n.setPreference('zh-CN');
    expect(canvases.slice(6).map(canvas => canvas.context.fillText.mock.calls[0]?.[0])).toEqual([
      '右',
      '左',
      '后',
      '前',
      '顶',
      '底',
    ]);
    expect(overlays[0]!.attributes.get('aria-label')).toBe('视图立方体');
    expect(overlays[0]!.attributes.get('lang')).toBe('zh-CN');
    expect(dispose).toHaveBeenCalledTimes(6);
    expect(render).toHaveBeenCalledOnce();
    cube.dispose();
    expect(dispose).toHaveBeenCalledTimes(12);
    render.mockClear();
    i18n.setPreference('en');
    expect(canvases).toHaveLength(12);
    expect(render).not.toHaveBeenCalled();
    expect(overlays[0]!.remove).toHaveBeenCalledOnce();
    dispose.mockRestore();
  });

  it('keeps two cube locales independent and preserves locale during theme redraws', () => {
    const firstLocale = createViewerI18n('en');
    const first = setup(firstLocale);
    const second = setup(createViewerI18n('en'));
    firstLocale.setPreference('zh-CN');
    expect(overlays[0]!.attributes.get('aria-label')).toBe('视图立方体');
    expect(overlays[1]!.attributes.get('aria-label')).toBe('View cube');
    first.cube.setTheme('dark');
    expect(canvases.slice(-6).map(canvas => canvas.context.fillText.mock.calls[0]?.[0])).toEqual([
      '右',
      '左',
      '后',
      '前',
      '顶',
      '底',
    ]);
    first.cube.dispose();
    second.cube.dispose();
  });

  it('updates the hovered face name without changing the active face', () => {
    const i18n = createViewerI18n('en');
    const { cube } = setup(i18n);
    const face = new THREE.Mesh();
    face.userData.faceIndex = 3;
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { distance: 1, point: new THREE.Vector3(), object: face },
    ]);
    const overlay = overlays[0]!;
    const move = overlay.addEventListener.mock.calls.find(([name]) => name === 'pointermove')![1];
    const leave = overlay.addEventListener.mock.calls.find(([name]) => name === 'pointerleave')![1];
    move({ clientX: 52, clientY: 52 });
    expect(overlay.attributes.get('aria-label')).toBe('View cube: FRONT');
    i18n.setPreference('zh-CN');
    expect(overlay.attributes.get('aria-label')).toBe('视图立方体：前');
    leave();
    expect(overlay.attributes.get('aria-label')).toBe('视图立方体');
    cube.dispose();
  });
});
