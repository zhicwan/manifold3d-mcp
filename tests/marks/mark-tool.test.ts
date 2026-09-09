import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const pickerMocks = vi.hoisted(() => ({
  pickPoint: vi.fn(),
  pickRegion: vi.fn(),
}));

vi.mock('../../packages/viewer/src/marks/picker.js', async () => {
  const threeModule = await import('three');
  return {
    eventToNdc: (event: { clientX: number; clientY: number }) =>
      new threeModule.Vector2(event.clientX / 100, event.clientY / 100),
    pickPoint: pickerMocks.pickPoint,
    pickRegion: pickerMocks.pickRegion,
  };
});

import { AnnotationStore } from '../../packages/viewer/src/marks/annotation-store.js';
import type { FlyoutLayer } from '../../packages/viewer/src/marks/flyout/index.js';
import { MarkTool } from '../../packages/viewer/src/marks/mark-tool.js';
import type { MarkMode } from '../../packages/viewer/src/marks/types.js';

type EventListener = (event: Record<string, unknown>) => void;

class FakeEventTarget {
  readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeElement extends FakeEventTarget {
  className = '';
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  removed = false;
  isContentEditable = false;
  tagName = 'CANVAS';
  closest(selector: string): FakeElement | null {
    return selector.includes('textarea') && this.tagName === 'TEXTAREA' ? this : null;
  }
  contains(target: unknown): boolean {
    return target === this || this.children.includes(target as FakeElement);
  }
  focus(): void {
    Object.assign(document, { activeElement: this });
  }

  appendChild(child: FakeElement): void {
    this.children.push(child);
  }

  remove(): void {
    this.removed = true;
  }

  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
  }
}

function mouse(clientX: number, clientY: number): Record<string, unknown> {
  return {
    button: 0,
    clientX,
    clientY,
    ctrlKey: false,
    metaKey: false,
    target: null,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('MarkTool annotate/select gestures', () => {
  let fakeWindow: FakeEventTarget;
  let fakeDocument: FakeEventTarget;
  let body: FakeElement;
  let overlay: FakeElement;
  let canvas: FakeElement;
  let store: AnnotationStore;
  let flyouts: {
    ownsTarget: ReturnType<typeof vi.fn>;
    openExpanded: ReturnType<typeof vi.fn>;
    dismissAll: ReturnType<typeof vi.fn>;
  };
  let controls: { enabled: boolean; mouseButtons: OrbitControls['mouseButtons']; touches: OrbitControls['touches'] };
  let modeChanged: ReturnType<typeof vi.fn<(mode: MarkMode) => void>>;
  let selectionCreated: ReturnType<typeof vi.fn<(id: string) => void>>;
  let tool: MarkTool;

  beforeEach(() => {
    fakeWindow = new FakeEventTarget();
    fakeDocument = new FakeEventTarget();
    body = new FakeElement();
    overlay = new FakeElement();
    canvas = new FakeElement();
    store = new AnnotationStore();
    flyouts = {
      ownsTarget: vi.fn(() => false),
      openExpanded: vi.fn(),
      dismissAll: vi.fn(),
    };
    controls = {
      enabled: true,
      mouseButtons: { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN },
      touches: { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN },
    };
    modeChanged = vi.fn();
    selectionCreated = vi.fn();
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('Node', FakeElement);
    vi.stubGlobal(
      'document',
      Object.assign(fakeDocument, {
        body,
        activeElement: canvas,
        createElement: () => new FakeElement(),
      }),
    );
    pickerMocks.pickPoint.mockReturnValue({
      triId: 7,
      worldCoord: new THREE.Vector3(1, 2, 3),
    });
    pickerMocks.pickRegion.mockReturnValue({
      triIds: [1, 2],
      centroidWorld: new THREE.Vector3(4, 5, 6),
    });
    tool = new MarkTool(
      overlay as unknown as HTMLElement,
      canvas as unknown as HTMLCanvasElement,
      new THREE.PerspectiveCamera(),
      controls as unknown as OrbitControls,
      store,
      flyouts as unknown as FlyoutLayer,
      () => ({}) as THREE.Mesh,
      () => null,
      modeChanged,
      selectionCreated,
    );
  });

  afterEach(() => {
    tool.dispose();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { mode: 'annotate' as const, drag: false, kind: 'point' as const },
    { mode: 'annotate' as const, drag: true, kind: 'region' as const },
    { mode: 'select' as const, drag: false, kind: 'point' as const },
    { mode: 'select' as const, drag: true, kind: 'region' as const },
  ])('$mode gesture (drag=$drag) creates a $kind annotation', ({ mode, drag, kind }) => {
    performGesture(mode, drag);

    const annotation = store.list()[0]!;
    expect(annotation.kind).toBe(kind);
    if (mode === 'annotate') {
      expect(annotation).toMatchObject({ intent: 'comment', state: 'draft' });
      expect(flyouts.openExpanded).toHaveBeenCalledWith(annotation.id);
      expect(selectionCreated).not.toHaveBeenCalled();
    } else {
      expect(annotation).toMatchObject({ intent: 'selection', state: 'pending', note: '' });
      expect(selectionCreated).toHaveBeenCalledWith(annotation.id);
      expect(flyouts.openExpanded).not.toHaveBeenCalled();
    }
  });

  it.each(['annotate', 'select'] as const)('does not mark a non-primary touch in %s mode', mode => {
    tool.setMode(mode);
    const secondary = { ...mouse(10, 10), pointerType: 'touch', isPrimary: false };
    canvas.emit('pointerdown', secondary);
    fakeDocument.emit('pointerup', secondary);
    expect(store.list()).toEqual([]);
    expect(selectionCreated).not.toHaveBeenCalled();
  });

  it('does not let modifier keys bypass orbit mode', () => {
    canvas.emit('pointerdown', mouse(10, 10));
    fakeDocument.emit('pointerup', mouse(10, 10));
    canvas.emit('pointerdown', { ...mouse(10, 10), ctrlKey: true });
    fakeDocument.emit('pointerup', { ...mouse(10, 10), ctrlKey: true });

    expect(store.list()).toEqual([]);
    expect(controls.enabled).toBe(true);
  });

  it('returns an armed tool to orbit on Escape', () => {
    tool.setMode('annotate');
    expect(canvas.dataset.markMode).toBe('annotate');

    fakeWindow.emit('keydown', { key: 'Escape', target: canvas, preventDefault: vi.fn() });

    expect(canvas.dataset.markMode).toBe('orbit');
    expect(body.dataset.markMode).toBeUndefined();
    expect(modeChanged).toHaveBeenNthCalledWith(1, 'annotate');
    expect(modeChanged).toHaveBeenNthCalledWith(2, 'orbit');
  });

  function performGesture(mode: Exclude<MarkMode, 'orbit'>, drag: boolean): void {
    tool.setMode(mode);
    canvas.emit('pointerdown', mouse(10, 10));
    if (drag) {
      fakeDocument.emit('pointermove', mouse(30, 30));
    }
    fakeDocument.emit('pointerup', mouse(drag ? 30 : 10, drag ? 30 : 10));
  }

  it.each(['annotate', 'select'] as const)('preserves pan, zoom and two-finger navigation in %s', mode => {
    tool.setMode(mode);
    expect(controls.enabled).toBe(true);
    expect(controls.mouseButtons).toEqual({ LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN });
    expect(controls.touches).toEqual({ ONE: null, TWO: THREE.TOUCH.DOLLY_PAN });
    canvas.emit('pointerdown', { ...mouse(10, 10), button: 2 });
    fakeDocument.emit('pointermove', mouse(30, 30));
    fakeDocument.emit('pointerup', { ...mouse(30, 30), button: 2 });
    expect(store.list()).toHaveLength(0);
  });

  it('temporarily navigates with Space and restores the tool after the gesture ends', () => {
    tool.setMode('annotate');
    fakeWindow.emit('keydown', { key: ' ', code: 'Space', target: canvas, preventDefault: vi.fn() });
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    canvas.emit('pointerdown', mouse(10, 10));
    fakeWindow.emit('keyup', { key: ' ', code: 'Space' });
    expect(canvas.dataset.markMode).toBe('orbit');
    fakeDocument.emit('pointerup', mouse(30, 30));
    expect(canvas.dataset.markMode).toBe('annotate');
    expect(controls.mouseButtons.LEFT).toBeNull();
    expect(store.list()).toHaveLength(0);
  });

  it('cancels marking when a second touch arrives', () => {
    tool.setMode('annotate');
    canvas.emit('pointerdown', { ...mouse(10, 10), pointerType: 'touch' });
    canvas.emit('pointerdown', { ...mouse(20, 20), pointerId: 2, pointerType: 'touch' });
    fakeDocument.emit('pointerup', { ...mouse(20, 20), pointerId: 2, pointerType: 'touch' });
    fakeDocument.emit('pointerup', { ...mouse(10, 10), pointerType: 'touch' });
    expect(store.list()).toHaveLength(0);
    expect(canvas.dataset.markMode).toBe('annotate');
  });

  it.each(['pointercancel', 'lostpointercapture'])('does not create a mark after %s', event => {
    tool.setMode('annotate');
    canvas.emit('pointerdown', mouse(10, 10));
    (event === 'pointercancel' ? fakeDocument : canvas).emit(event, mouse(10, 10));
    fakeDocument.emit('pointerup', mouse(10, 10));
    expect(store.list()).toHaveLength(0);
  });

  it('cancels the current drag before exiting the tool on a second Escape', () => {
    tool.setMode('annotate');
    canvas.emit('pointerdown', mouse(10, 10));
    fakeWindow.emit('keydown', { key: 'Escape', target: canvas, preventDefault: vi.fn() });
    expect(canvas.dataset.markMode).toBe('annotate');
    fakeDocument.emit('pointerup', mouse(10, 10));
    expect(store.list()).toHaveLength(0);
    fakeWindow.emit('keydown', { key: 'Escape', target: canvas, preventDefault: vi.fn() });
    expect(canvas.dataset.markMode).toBe('orbit');
  });

  it('exits after a single selection and prevents another attachment while pending', () => {
    performGesture('select', false);
    expect(canvas.dataset.markMode).toBe('orbit');
    performGesture('select', false);
    expect(store.list()).toHaveLength(1);
    store.commitSelection(store.list()[0]!.id);
    tool.setMode('select');
    expect(canvas.dataset.markMode).toBe('select');
  });

  it('does not intercept typing, IME, or keys after focus leaves the Viewer', () => {
    tool.setMode('annotate');
    const input = new FakeElement();
    input.tagName = 'TEXTAREA';
    input.focus();
    fakeWindow.emit('keydown', { key: 'Escape', target: input, preventDefault: vi.fn() });
    canvas.focus();
    fakeWindow.emit('keydown', { key: 'Escape', target: canvas, isComposing: true, preventDefault: vi.fn() });
    expect(canvas.dataset.markMode).toBe('annotate');
  });

  it('clears a held navigation modifier and cancels a gesture on blur', () => {
    tool.setMode('annotate');
    fakeWindow.emit('keydown', { key: ' ', target: canvas, preventDefault: vi.fn() });
    canvas.emit('pointerdown', mouse(10, 10));
    fakeWindow.emit('blur', {});
    fakeDocument.emit('pointerup', mouse(10, 10));
    expect(store.list()).toHaveLength(0);
    expect(canvas.dataset.markMode).toBe('annotate');
  });
});
