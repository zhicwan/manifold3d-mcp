import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type * as THREE from 'three';

import {
  createHostActionsManifest,
  createHostActionStatus,
  type HostActionDescriptor,
} from '../packages/protocol/src/wire/host-actions.js';
import { VIEWER_PROTOCOL_VERSION, type ViewerModel } from '../packages/protocol/src/wire/model.js';
import type { ViewerSceneRuntime } from '../packages/viewer/src/scene/runtime.js';
import { createViewerStore, type ViewerState, type ViewerStore } from '../packages/viewer/src/store.js';
import type { ConnectOptions } from '../packages/viewer/src/transport/ws-client.js';

const harness = vi.hoisted(() => {
  let releaseExport = (): void => undefined;
  const exportReady = new Promise<void>(resolve => {
    releaseExport = resolve;
  });
  return {
    store: null as ViewerStore | null,
    effect: null as (() => void | (() => void)) | null,
    refs: [] as unknown[],
    refIndex: 0,
    pending: null as unknown,
    pendingWrites: 0,
    feed: null as ConnectOptions | null,
    sentMessages: [] as unknown[],
    runtime: null as { scene: ViewerSceneRuntime } | null,
    selectionCreated: null as ((id: string) => void) | null,
    exportReady,
    releaseExport,
  };
});

// Drive the real component callbacks/effect without adding a DOM test dependency.
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof React>()),
  useEffect: (effect: () => void | (() => void)) => {
    harness.effect = effect;
  },
  useRef: () => ({ current: harness.refs[harness.refIndex++] }),
  useState: () => [
    harness.pending,
    (next: unknown) => {
      const value = typeof next === 'function' ? next(harness.pending) : next;
      if (!Object.is(value, harness.pending)) {
        harness.pendingWrites++;
      }
      harness.pending = value;
    },
  ],
}));
vi.mock('@/store', async () => ({
  ...(await import('../packages/viewer/src/store.js')),
  useViewerStore: () => harness.store,
  useViewerI18n: () => harness.store!.i18n,
  useViewerState: <T>(selector: (state: ViewerState) => T) => selector(harness.store!.getState()),
  useAnnotations: () => undefined,
}));
vi.mock('@/components/glass', () => ({ glass: '' }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/host-actions', () => ({
  useHostActionsSnapshot: () => harness.store!.getState().hostActionsClient!.getSnapshot(),
}));
vi.mock('@/host-actions/client', () => import('../packages/viewer/src/host-actions/client.js'));
vi.mock('@/marks', async () => {
  const module = await import('../packages/viewer/src/marks/index.js');
  return {
    ...module,
    installMarks: (deps: Parameters<typeof module.installMarks>[0]) => {
      harness.selectionCreated = deps.onSelectionCreated ?? null;
      return module.installMarks(deps);
    },
  };
});
vi.mock('@/marks/ws-uplink', () => import('../packages/viewer/src/marks/ws-uplink.js'));
vi.mock('@/scene/viewer', () => import('../packages/viewer/src/scene/viewer.js'));
vi.mock('@/scene/viewer-canvas-ownership', () => import('../packages/viewer/src/scene/viewer-canvas-ownership.js'));
vi.mock('@/viewer-runtime-lifecycle', () => import('../packages/viewer/src/viewer-runtime-lifecycle.js'));
vi.mock('@/viewer-runtime', () => ({
  useViewerRuntimeHost: () => ({
    publishRuntime: (runtime: { scene: ViewerSceneRuntime }) => {
      harness.runtime = runtime;
      return runtime;
    },
    clearRuntime: () => {
      harness.runtime = null;
      return Promise.resolve();
    },
  }),
}));
vi.mock('@/transport/ws-client', async () => ({
  ...(await import('../packages/viewer/src/transport/ws-client.js')),
  connectMeshFeed: (feed: ConnectOptions) => {
    harness.feed = feed;
    return {
      send: (message: unknown) => harness.sentMessages.push(message),
      isOpen: () => true,
      close: vi.fn(),
    };
  },
}));
vi.mock('@/exporters/model', async () => {
  await harness.exportReady;
  return import('../packages/viewer/src/exporters/model.js');
});
vi.mock('@/demo-payload', () => import('../packages/viewer/src/demo-payload.js'));

// Keep Viewer, MarkTool, their stores and HostActionsClient real; only replace
// WebGL and visual decorations that require a browser DOM.
vi.mock('three', async importOriginal => ({
  ...(await importOriginal<typeof THREE>()),
  WebGLRenderer: class {
    setPixelRatio = vi.fn();
    setAnimationLoop = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('three/addons/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return {
    OrbitControls: class {
      target = new Vector3();
      enabled = true;
      update = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      dispose = vi.fn();
    },
  };
});
vi.mock('../packages/viewer/src/scene/view-cube.js', () => ({
  ViewCube: class {
    dispose = vi.fn();
  },
}));
vi.mock('../packages/viewer/src/marks/flyout/index.js', () => ({
  FlyoutLayer: class {
    dismissAll = vi.fn();
    cancelOpenDraft = vi.fn();
    updatePositions = vi.fn();
    dispose = vi.fn();
    setMeasurementAction = vi.fn();
    setMeasurementAnchor = vi.fn();
    toggleMeasurement = vi.fn();
  },
}));
vi.mock('@/measurements/submission', () => import('../packages/viewer/src/measurements/submission.js'));
vi.mock('../packages/viewer/src/marks/marker-renderer.js', () => ({
  MarkerRenderer: class {
    dispose = vi.fn();
  },
}));
vi.mock('../packages/viewer/src/marks/hover-highlight.js', () => ({
  HoverHighlight: class {
    reset = vi.fn();
    setEnabled = vi.fn();
    dispose = vi.fn();
  },
}));

// Runtime imports keep the Node-only test tsconfig independent of the browser
// package's JSX/alias compilation settings.
const components = '../packages/viewer/src/components';
const { ViewerCanvas } = (await import(`${components}/viewer-canvas.tsx`)) as {
  ViewerCanvas(props: { resumeIdentity: string }): React.ReactElement;
};
const { AnnotationBatchBar } = (await import(`${components}/annotation-batch-bar.tsx`)) as {
  AnnotationBatchBar(): React.ReactElement | null;
};

const fixAction: HostActionDescriptor = {
  id: 'fix-annotation-batch',
  label: 'Fix them',
  icon: 'wand',
  slot: 'annotation-batch',
  tone: 'default',
  requires: ['model', 'annotations'],
};
const attachAction: HostActionDescriptor = { ...fixAction, id: 'attach-annotation-batch', label: 'Attach' };
const exportAction: HostActionDescriptor = {
  id: 'export-model-file',
  label: 'Export model',
  icon: 'download',
  slot: 'export-handler',
  tone: 'default',
  requires: ['model'],
};
let unmount: (() => void) | undefined;
let store: ViewerStore;
let download: { name: string; blob: Blob } | undefined;

beforeEach(() => {
  store = createViewerStore();
  harness.store = store;
  harness.pending = null;
  harness.pendingWrites = 0;
  harness.runtime = null;
  harness.feed = null;
  harness.sentMessages = [];
  download = undefined;
  const element = () => ({
    style: {},
    dataset: {},
    closest: () => null,
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    remove: vi.fn(),
  });
  harness.refs = [element(), element()];
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
  });
  let downloadedBlob: Blob;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    downloadedBlob = blob as Blob;
    return 'blob:download';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    body: { dataset: {}, appendChild: vi.fn() },
    createElement: () => ({
      ...element(),
      download: '',
      click(this: { download: string }) {
        download = { name: this.download, blob: downloadedBlob };
      },
    }),
  });
});

afterEach(async () => {
  unmount?.();
  unmount = undefined;
  await settle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function mount(identity = 'first', withModel = true): Promise<void> {
  harness.refIndex = 0;
  ViewerCanvas({ resumeIdentity: identity });
  unmount = harness.effect?.() || undefined;
  await settle();
  expect(store.getState().viewerApi).not.toBeNull();
  if (withModel) {
    harness.feed!.onMesh(model('Original model', 10));
    harness.feed!.onModelVersion?.('model-v1');
  }
  harness.feed!.onHostActionsManifest?.(createHostActionsManifest([fixAction, attachAction]));
}

function addDraft() {
  const { viewerApi, marksRuntime } = store.getState();
  viewerApi!.setMarkMode('annotate');
  return marksRuntime!.store.addComment({
    kind: 'point',
    anchorWorld: [0, 0, 0],
    worldCoord: [0, 0, 0],
    triIds: [],
    note: 'Adjust this face',
  });
}

interface ButtonProps {
  children?: React.ReactNode;
  onClick(): void;
  disabled: boolean;
}

function button(label: string): ButtonProps {
  let result: ButtonProps | undefined;
  const visit = (node: React.ReactNode): void => {
    React.Children.forEach(node, child => {
      if (!React.isValidElement<{ children?: React.ReactNode }>(child)) {
        return;
      }
      if (child.type === 'button' && React.Children.toArray(child.props.children).includes(label)) {
        result = child.props as ButtonProps;
      }
      visit(child.props.children);
    });
  };
  visit(AnnotationBatchBar());
  expect(result, `button ${label}`).toBeDefined();
  return result!;
}

async function settle(): Promise<void> {
  for (let step = 0; step < 30; step++) {
    await Promise.resolve();
  }
}

function model(description: string, width: number): ViewerModel {
  return {
    description,
    numProp: 3,
    triangles: 4,
    vertices: 4,
    vertProperties: new Float32Array([0, 0, 0, width, 0, 0, 0, 20, 0, 0, 0, 30]),
    triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
    mergeFromVert: new Uint32Array(),
    mergeToVert: new Uint32Array(),
    features: [],
    triFeatureIds: new Uint32Array(4),
    volume: (width * 20 * 30) / 6,
    surfaceArea: 0,
    genus: 0,
    bboxMin: [0, 0, 0],
    bboxMax: [width, 20, 30],
  };
}

describe('Viewer component ownership', () => {
  it('lazy-loads the data-only union in offline demo mode', async () => {
    vi.stubEnv('MODE', 'demo');
    await mount('demo', false);
    const timer = vi.mocked(window.setTimeout).mock.calls.find(([, delay]) => delay === 600)!;
    expect(timer).toBeDefined();
    (timer[0] as () => void)();
    await vi.dynamicImportSettled();
    expect(store.getState().payload?.description).toBe('Demo bracket (union)');
    expect(store.getState().payload?.triangles).toBe(350);
    expect(store.getState().modelVersion).toBe('demo');
    expect(store.getState().marksRuntime!.store.getModelVersion()).toBe('demo');
    expect(store.getState().status).toBe('connected');
    expect(store.getState().viewerError).toBeNull();
  });

  it('does not replace a server model while the demo import is pending', async () => {
    vi.stubEnv('MODE', 'demo');
    await mount('demo', false);
    const timer = vi.mocked(window.setTimeout).mock.calls.find(([, delay]) => delay === 600)!;
    (timer[0] as () => void)();
    const remote = model('Remote model', 20);
    harness.feed!.onMesh(remote);
    harness.feed!.onModelVersion?.('remote-v1');
    await vi.dynamicImportSettled();
    expect(store.getState().payload).toBe(remote);
    expect(store.getState().modelVersion).toBe('remote-v1');
  });

  it('does not publish a pending demo import after unmount', async () => {
    vi.stubEnv('MODE', 'demo');
    await mount('demo', false);
    const setPayload = vi.spyOn(store, 'setPayload');
    const timer = vi.mocked(window.setTimeout).mock.calls.find(([, delay]) => delay === 600)!;
    (timer[0] as () => void)();
    unmount!();
    unmount = undefined;
    await vi.dynamicImportSettled();
    await settle();
    expect(setPayload.mock.calls.every(([payload]) => payload === null)).toBe(true);
    expect(store.getState().payload).toBeNull();
    expect(store.getState().viewerApi).toBeNull();
  });

  it('does not schedule an offline fixture outside demo mode', async () => {
    vi.stubEnv('MODE', 'production');
    await mount('production', false);
    expect(vi.mocked(window.setTimeout).mock.calls.some(([, delay]) => delay === 600)).toBe(false);
    expect(store.getState().payload).toBeNull();
  });

  it.each(['viewerStartupFailed', 'modelExportFailed', 'locationAttachmentFailed'] as const)(
    'preserves %s when annotation synchronization succeeds',
    async key => {
      await mount();
      const error = { key, detail: 'Operation diagnostic' };
      store.setViewerError(error);

      expect(store.getState().marksRuntime!.flushAnnotations()).toBe(true);
      expect(store.getState().viewerError).toBe(error);
    },
  );

  it('clears an annotation synchronization error after a successful retry', async () => {
    await mount();
    const marks = store.getState().marksRuntime!;
    vi.spyOn(harness.sentMessages, 'push').mockImplementationOnce(() => {
      throw new Error('Annotation transport failed');
    });
    expect(marks.flushAnnotations()).toBe(false);
    expect(store.getState().viewerError).toEqual({
      key: 'annotationSyncFailed',
      detail: 'Annotation transport failed',
    });

    expect(marks.flushAnnotations()).toBe(true);
    expect(store.getState().viewerError).toBeNull();
  });

  it.each(['succeeded', 'failed'] as const)(
    'preserves a pending batch through language changes and %s completion',
    async outcome => {
      await mount();
      const marks = store.getState().marksRuntime!;
      const api = store.getState().viewerApi;
      const client = store.getState().hostActionsClient!;
      const draft = addDraft();
      const camera = harness.runtime!.scene.camera;
      const cameraPosition = camera.position.clone();
      button('Fix').onClick();
      const request = client.getSnapshot().latestStatus!;
      const pending = marks.store.get(draft.id);
      const writes = harness.pendingWrites;
      store.i18n.setPreference('zh-CN');
      expect(store.getState().viewerApi).toBe(api);
      expect(store.getState().marksRuntime).toBe(marks);
      expect(client.getSnapshot().latestStatus).toBe(request);
      expect(marks.store.get(draft.id)).toBe(pending);
      expect(harness.pendingWrites).toBe(writes);
      expect(camera.position.equals(cameraPosition)).toBe(true);
      client.receiveStatus(createHostActionStatus({ ...request, state: outcome }));
      await settle();
      expect(marks.store.get(draft.id)?.state).toBe(outcome === 'succeeded' ? 'committed' : 'draft');
      expect(marks.store.get(draft.id)?.note).toBe('Adjust this face');
      expect(harness.pending).toBeNull();
    },
  );

  it('does not restore a disposed generation or change its replacement tool mode', async () => {
    await mount();
    const oldMarks = store.getState().marksRuntime!;
    const oldApi = store.getState().viewerApi!;
    const draft = addDraft();
    button('Fix').onClick();
    expect(oldMarks.store.get(draft.id)?.state).toBe('pending');
    const oldSetMode = vi.spyOn(oldApi, 'setMarkMode');
    const oldFlush = vi.spyOn(oldMarks, 'flushAnnotations');

    unmount!();
    await mount('replacement');

    expect(oldMarks.store.get(draft.id)?.state).toBe('pending');
    expect(oldSetMode).not.toHaveBeenCalled();
    expect(oldFlush).not.toHaveBeenCalled();
    expect(harness.pending).toBeNull();
    expect(store.getState().markMode).toBe('orbit');
    expect(document.body.dataset.markMode).toBeUndefined();
    addDraft();
    expect(button('Fix').disabled).toBe(false);
  });

  it.each(['succeeded', 'failed', 'disposed'] as const)(
    'ignores a late %s completion while the replacement has its own pending batch',
    async outcome => {
      await mount();
      const oldMarks = store.getState().marksRuntime!;
      const oldClient = store.getState().hostActionsClient!;
      const invokeAndWait = oldClient.invokeAndWait.bind(oldClient);
      let release = (): void => undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      vi.spyOn(oldClient, 'invokeAndWait').mockImplementation((...args) =>
        invokeAndWait(...args).then(
          async status => {
            await gate;
            return status;
          },
          async error => {
            await gate;
            throw error;
          },
        ),
      );
      const oldDraft = addDraft();
      button('Fix').onClick();
      if (outcome !== 'disposed') {
        oldClient.receiveStatus(
          createHostActionStatus({
            ...oldClient.getSnapshot().latestStatus!,
            state: outcome,
          }),
        );
      }
      unmount!();
      await mount('replacement');
      const newMarks = store.getState().marksRuntime!;
      const newDraft = addDraft();
      button('Attach').onClick();
      const writes = harness.pendingWrites;
      const pending = harness.pending;
      const oldFlush = vi.spyOn(oldMarks, 'flushAnnotations');

      release();
      await settle();

      expect(oldMarks.store.get(oldDraft.id)?.state).toBe('pending');
      expect(oldFlush).not.toHaveBeenCalled();
      expect(newMarks.store.get(newDraft.id)?.state).toBe('pending');
      expect(store.getState().markMode).toBe('orbit');
      expect(document.body.dataset.markMode).toBeUndefined();
      expect(harness.pending).toBe(pending);
      expect(harness.pendingWrites).toBe(writes);
      addDraft();
      expect(button('Cancel').disabled).toBe(true);
    },
  );

  it.each(['failed', 'identity-change'] as const)('restores editable drafts on a current %s failure', async failure => {
    await mount();
    const marks = store.getState().marksRuntime!;
    const client = store.getState().hostActionsClient!;
    const draft = addDraft();
    button('Fix').onClick();
    if (failure === 'failed') {
      client.receiveStatus(createHostActionStatus({ ...client.getSnapshot().latestStatus!, state: 'failed' }));
    } else {
      client.receiveHello({
        kind: 'hello',
        protocolVersion: VIEWER_PROTOCOL_VERSION,
        clientId: 'new-client',
        resumeToken: 'new-token',
        resumed: false,
      });
    }
    await settle();

    expect(marks.store.get(draft.id)?.state).toBe('draft');
    expect(marks.store.update(draft.id, { note: 'Recovered edit' })).toBe(true);
    expect(store.getState().markMode).toBe('annotate');
    expect((harness.refs[0] as { dataset: Record<string, string> }).dataset.markMode).toBe('annotate');
    expect(document.body.dataset.markMode).toBeUndefined();
    expect(button('Cancel').disabled).toBe(false);
    expect(harness.pending).toBeNull();
  });

  it.each(['succeeded', 'failed'] as const)(
    'does not block the next model or settle its batch on an old model %s reply',
    async outcome => {
      await mount();
      const marks = store.getState().marksRuntime!;
      const client = store.getState().hostActionsClient!;
      const old = addDraft();
      button('Attach').onClick();
      const oldRequest = client.getSnapshot().latestStatus!;
      harness.feed!.onModelVersion?.('model-v2');
      expect(marks.store.get(old.id)).toBeUndefined();
      const current = addDraft();
      expect(button('Attach').disabled).toBe(false);
      button('Attach').onClick();
      const pending = harness.pending;
      expect(marks.store.get(current.id)?.state).toBe('pending');
      client.receiveStatus(createHostActionStatus({ ...oldRequest, state: outcome }));
      await settle();
      expect(harness.pending).toBe(pending);
      expect(marks.store.get(current.id)?.state).toBe('pending');
      expect(store.getState().markMode).toBe('orbit');
      expect(store.getState().viewerError).toBeNull();
    },
  );

  it('reports an unavailable batch delivery and restores notes without fabricating host success', async () => {
    await mount();
    const draft = addDraft();
    const submit = button('Fix').onClick;
    store.getState().hostActionsClient!.receiveManifest(createHostActionsManifest([]));
    submit();
    await settle();
    expect(store.getState().marksRuntime!.store.get(draft.id)?.state).toBe('draft');
    expect(store.getState().markMode).toBe('annotate');
    expect(store.getState().viewerError).toMatchObject({ key: 'annotationDeliveryFailed' });
  });

  it.each(['Fix', 'Attach'])('freezes only the submitted batch after %s succeeds', async label => {
    await mount();
    const marks = store.getState().marksRuntime!;
    const client = store.getState().hostActionsClient!;
    const submitted = addDraft();
    button(label).onClick();
    const newer = addDraft();
    client.receiveStatus(createHostActionStatus({ ...client.getSnapshot().latestStatus!, state: 'succeeded' }));
    await settle();

    expect(marks.store.get(submitted.id)?.state).toBe('committed');
    expect(marks.store.get(newer.id)?.state).toBe('draft');
    expect(store.getState().markMode).toBe('annotate');
    expect(button('Cancel').disabled).toBe(false);
    expect(harness.pending).toBeNull();
  });

  it.each(['Done', 'Cancel'])('preserves local %s without host batch actions', async label => {
    await mount();
    const marks = store.getState().marksRuntime!;
    store.getState().hostActionsClient!.receiveManifest(createHostActionsManifest([]));
    const draft = addDraft();
    button(label).onClick();

    expect(marks.store.get(draft.id)?.state).toBe(label === 'Done' ? 'committed' : undefined);
    expect(store.getState().markMode).toBe('orbit');
    expect(document.body.dataset.markMode).toBeUndefined();
  });

  it('captures the canonical payload and filename before a lazy model exporter import completes', async () => {
    await mount();
    const payload = store.getState().payload!;
    const runtime = harness.runtime!.scene;
    runtime.modelRoot.scale.setScalar(0.001);
    runtime.modelRoot.rotation.set(-Math.PI / 2, 0, Math.PI / 3);
    runtime.modelRoot.position.set(1, 2, 3);
    runtime.modelRoot.updateMatrixWorld(true);
    const transform = runtime.modelRoot.matrixWorld.clone();
    const exporting = store.getState().viewerApi!.exportModel('glb');
    await settle();
    expect(download).toBeUndefined();
    payload.description = 'Changed description during import';
    harness.feed!.onMesh(model('Replacement model', 100));

    harness.releaseExport();
    await exporting;
    expect(download?.name).toBe('original-model.glb');
    expect(download?.blob.type).toBe('model/gltf-binary');
    expect(download?.blob.size).toBeGreaterThan(100);
    expect(runtime.modelRoot.matrixWorld.equals(transform)).toBe(true);
    expect(store.getState().payload?.description).toBe('Replacement model');
  });

  it('delegates export to a host export handler instead of starting a browser download', async () => {
    await mount();
    harness.feed!.onHostActionsManifest?.(createHostActionsManifest([fixAction, attachAction, exportAction]));

    await store.getState().viewerApi!.exportModel('3mf');

    expect(download).toBeUndefined();
    expect(harness.sentMessages).toContainEqual(
      expect.objectContaining({
        kind: 'host_action_invoke',
        actionId: 'export-model-file',
        input: { format: '3mf' },
      }),
    );
  });

  it('falls back to browser export when a retained host manifest is disconnected', async () => {
    await mount();
    harness.feed!.onHostActionsManifest?.(createHostActionsManifest([exportAction]));
    harness.feed!.onStatusChange?.('disconnected');

    await store.getState().viewerApi!.exportModel('3mf');

    expect(download?.name).toBe('original-model.3mf');
    expect(harness.sentMessages).not.toContainEqual(
      expect.objectContaining({
        kind: 'host_action_invoke',
        actionId: 'export-model-file',
      }),
    );
  });

  it.each(['succeeded', 'failed'] as const)('ignores a late location %s after model replacement', async state => {
    await mount();
    const marks = store.getState().marksRuntime!;
    const client = store.getState().hostActionsClient!;
    client.receiveManifest(
      createHostActionsManifest([
        {
          ...attachAction,
          id: 'attach-location-selection',
          label: 'Attach location',
          slot: 'selection-gesture',
        },
      ]),
    );
    const oldSelection = marks.store.addSelection({
      kind: 'point',
      anchorWorld: [1, 2, 3],
      worldCoord: [1, 2, 3],
      triIds: [],
    });
    harness.selectionCreated!(oldSelection.id);
    const pending = client.getSnapshot().latestStatus!;
    harness.feed!.onModelVersion?.('model-v2');
    const replacement = marks.store.addSelection({
      kind: 'point',
      anchorWorld: [4, 5, 6],
      worldCoord: [4, 5, 6],
      triIds: [],
    });
    store.getState().viewerApi!.setMarkMode('annotate');
    client.receiveStatus(createHostActionStatus({ ...pending, state }));
    await settle();
    expect(marks.store.get(replacement.id)?.state).toBe('pending');
    expect(store.getState().markMode).toBe('annotate');
    expect(store.getState().viewerError).toBeNull();
  });
});
