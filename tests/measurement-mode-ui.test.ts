import * as React from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeasurementEvidence } from '../packages/protocol/src/wire/measurements.js';
import { createHostActionsManifest } from '../packages/protocol/src/wire/host-actions.js';
import { createViewerStore, type ViewerState, type ViewerStore } from '../packages/viewer/src/store.js';
import { AnnotationStore } from '../packages/viewer/src/marks/annotation-store.js';
import { RulerController } from '../packages/viewer/src/measurements/controller.js';
import { prepareMeshPicking } from '../packages/viewer/src/scene/mesh-picking.js';
import { HostActionsClient } from '../packages/viewer/src/host-actions/client.js';
import type { Annotation } from '../packages/viewer/src/marks/types.js';

const harness = vi.hoisted(() => ({ store: null as ViewerStore | null }));
vi.mock('react', async original => ({
  ...(await original<typeof React>()),
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useRef: () => ({ current: null }),
  useState: (value: unknown) => [value, () => undefined],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@/store', () => ({
  useViewerState: <T>(select: (state: ViewerState) => T) => select(harness.store!.getState()),
  useViewerStore: () => harness.store,
  useViewerI18n: () => harness.store!.i18n,
  useAnnotations: (store: { list(): readonly Annotation[] }) => store.list(),
}));
vi.mock('../packages/viewer/src/components/host-actions.tsx', () => ({
  useHostActionsSnapshot: () => harness.store!.getState().hostActionsClient!.getSnapshot(),
}));
vi.mock('../packages/viewer/src/components/ui/button.tsx', () => ({ Button: 'button' }));
vi.mock('../packages/viewer/src/components/viewer-shortcuts.tsx', () => ({ useViewerPopupEscape: () => undefined }));
vi.mock('@/measurements/projection', () => import('../packages/viewer/src/measurements/projection.js'));
vi.mock('@/measurements/presentation', () => import('../packages/viewer/src/measurements/presentation.js'));
vi.mock('@/measurements/submission', () => import('../packages/viewer/src/measurements/submission.js'));
vi.mock('@/host-actions/client', () => import('../packages/viewer/src/host-actions/client.js'));
const overlayModule = '../packages/viewer/src/components/measurement-overlay.tsx';
const { MeasurementOverlay } = (await import(overlayModule)) as {
  MeasurementOverlay(): React.ReactElement | null;
};

interface ElementProps {
  children?: React.ReactNode;
  text?: string;
  disabled?: boolean;
  onClick?: () => void;
  badges?: { commented: boolean; attached: boolean };
  comment?: string;
  displayNumber?: number;
  selected?: boolean;
}
function nodes(tree: React.ReactNode): Array<React.ReactElement<ElementProps>> {
  const result: Array<React.ReactElement<ElementProps>> = [];
  React.Children.forEach(tree, child => {
    if (React.isValidElement<ElementProps>(child)) {
      result.push(child, ...nodes(child.props.children));
    }
  });
  return result;
}
function render() {
  const root = MeasurementOverlay()!;
  const component = root.type as React.FunctionComponent<Record<string, unknown>>;
  return nodes(component(root.props as Record<string, unknown>) as React.ReactNode);
}

let ruler: RulerController;
let annotations: AnnotationStore;
let client: HostActionsClient;
let mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
let id: string;
let sent: unknown[];
let openComment: ReturnType<typeof vi.fn<(id: string) => void>>;

beforeEach(() => {
  vi.stubGlobal('React', React);
  const store = createViewerStore();
  harness.store = store;
  annotations = new AnnotationStore();
  annotations.setModelVersion('v1');
  mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial());
  prepareMeshPicking(mesh);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 30;
  camera.updateMatrixWorld();
  const canvas = { clientWidth: 400, clientHeight: 400 } as HTMLCanvasElement;
  ruler = new RulerController(
    canvas,
    camera,
    new THREE.Scene(),
    annotations,
    () => mesh,
    () => undefined,
    () => undefined,
  );
  const evidence: MeasurementEvidence = {
    kind: 'edge-length',
    operands: [{ kind: 'edge', edgeId: 'e', start: [-5, -5, 5], end: [5, -5, 5] }],
    distance: { method: 'segment-length', unit: 'mm', value: 10, start: [-5, -5, 5], end: [5, -5, 5] },
  };
  id = annotations.addMeasurement(evidence, [0, -5, 5]).id;
  ruler.frame();
  openComment = vi.fn((selected: string) => ruler.expand(selected));
  store.setMarksRuntime({
    store: annotations,
    ruler,
    commitOpenDraft: vi.fn(),
    cancelOpenDraft: vi.fn(),
    setMeasurementAnchor: vi.fn(),
    flushAnnotations: () => true,
    openMeasurementComment: openComment,
  });
  store.setViewerApi({
    setMarkMode: mode => {
      ruler.setActive(mode === 'measure');
      store.setMarkMode(mode);
    },
    setRenderMode: vi.fn(),
    setTheme: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitToModel: vi.fn(),
    exportModel: () => Promise.resolve(),
  });
  sent = [];
  client = new HostActionsClient({
    send: message => sent.push(message),
    isOpen: () => true,
    flushAnnotations: () => true,
    getInvocationContext: () => ({ modelVersion: 'v1', annotationRevision: annotations.getRevision() }),
  });
  client.receiveManifest(
    createHostActionsManifest([
      {
        id: 'attach-measurement',
        label: 'Attach',
        icon: 'message',
        slot: 'measurement-result',
        tone: 'default',
        requires: ['model', 'annotations'],
      },
    ]),
  );
  store.setHostActionsClient(client);
});

afterEach(() => {
  ruler.dispose();
  client.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
  vi.unstubAllGlobals();
});

describe('measurement label mode routing', () => {
  it('shows a number only for a nonempty comment or a successful attachment', () => {
    const number = () => render().find(node => node.props.text === '10 mm')?.props.displayNumber;
    expect(number()).toBeUndefined();
    annotations.updateMeasurementNote(id, '   ');
    expect(number()).toBeUndefined();
    annotations.updateMeasurementNote(id, 'Please change this');
    expect(number()).toBe(annotations.get(id)?.displayNumber);
    annotations.updateMeasurementNote(id, '');
    expect(number()).toBeUndefined();
    annotations.setMeasurementState(id, 'draft', 'pending');
    expect(number()).toBeUndefined();
    annotations.setMeasurementState(id, 'pending', 'draft');
    expect(number()).toBeUndefined();
    annotations.setMeasurementState(id, 'draft', 'pending');
    annotations.completeMeasurementDelivery(id, 'attach');
    expect(number()).toBe(annotations.get(id)?.displayNumber);
  });

  it.each(['measure', 'orbit'] as const)(
    'does not open a comment popup or attach on a label click in %s mode',
    mode => {
      harness.store!.getState().viewerApi!.setMarkMode(mode);
      const label = render().find(node => node.props.text === '10 mm')!;
      expect(label.props.disabled).toBe(false);
      label.props.onClick!();
      expect(openComment).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
      expect(harness.store!.getState().markMode).toBe(mode);
      if (mode === 'orbit') {
        expect(label.props.selected).toBe(false);
        expect(ruler.getSnapshot().expandedId).toBe(id);
        render().find(node => node.props.text === '10 mm')!.props.onClick!();
        expect(ruler.getSnapshot().expandedId).toBeNull();
      }
    },
  );

  it('opens the measurement comment editor only in Annotate and closes it when tools change', () => {
    harness.store!.getState().viewerApi!.setMarkMode('annotate');
    render().find(node => node.props.text === '10 mm')!.props.onClick!();
    expect(openComment).toHaveBeenCalledWith(id);
    expect(ruler.getSnapshot().expandedId).toBe(id);
    expect(sent).toEqual([]);
    harness.store!.getState().viewerApi!.setMarkMode('measure');
    expect(ruler.getSnapshot().expandedId).toBeNull();
  });

  it('shows separate comment and attachment badges after editing an already attached label', () => {
    annotations.setMeasurementState(id, 'draft', 'pending');
    annotations.completeMeasurementDelivery(id, 'attach');
    annotations.updateMeasurementNote(id, 'Change this after attachment');
    harness.store!.getState().viewerApi!.setMarkMode('annotate');
    const label = render().find(node => node.props.text === '10 mm')!;
    expect(label.props.badges).toMatchObject({ commented: true, attached: true, attachmentChanged: true });
    expect(label.props.displayNumber).toBe(annotations.get(id)?.displayNumber);
    expect(label.props.comment).toBe('Change this after attachment');
    label.props.onClick!();
    expect(openComment).toHaveBeenCalledWith(id);
    expect(render().find(node => node.props.text === '10 mm')?.props.comment).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('attaches the clicked measurement in Select mode without creating a point annotation or opening an editor', async () => {
    harness.store!.getState().viewerApi!.setMarkMode('select');
    render().find(node => node.props.text === '10 mm')!.props.onClick!();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ actionId: 'attach-measurement', annotationIds: [id] });
    expect(annotations.list()).toHaveLength(1);
    expect(harness.store!.getState().markMode).toBe('orbit');
    expect(openComment).not.toHaveBeenCalled();
    client.dispose();
    await Promise.resolve();
  });
});
