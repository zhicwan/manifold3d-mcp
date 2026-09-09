import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createHostActionsManifest,
  type HostActionDescriptor,
  type HostActionStatusMessage,
} from '../packages/protocol/src/wire/host-actions.js';
import { HostActionsClient, type HostActionsSnapshot } from '../packages/viewer/src/host-actions/client.js';
import { AnnotationStore } from '../packages/viewer/src/marks/annotation-store.js';
import { createViewerStore, type ViewerApi, type ViewerState, type ViewerStore } from '../packages/viewer/src/store.js';

const harness = vi.hoisted(() => ({
  store: null as ViewerStore | null,
  snapshot: null as HostActionsSnapshot | null,
  effects: [] as Array<() => void | (() => void)>,
  refs: [] as unknown[],
  refIndex: 0,
  states: [] as unknown[],
  stateIndex: 0,
}));

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof React>()),
  useEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
  useRef: () => ({ current: harness.refs[harness.refIndex++] ?? null }),
  useState: (initial: unknown) => {
    const index = harness.stateIndex++;
    harness.states[index] ??= initial;
    return [
      harness.states[index],
      (value: unknown) => {
        harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value;
      },
    ];
  },
}));
vi.mock('@/store', () => ({
  useViewerState: <T>(select: (state: ViewerState) => T): T => select(harness.store!.getState()),
  useViewerStore: () => harness.store,
  useAnnotations: () => undefined,
}));
vi.mock('@/components/glass', () => ({ glass: '', glassPopup: '' }));
vi.mock('@/components/host-actions', () => ({ useHostActionsSnapshot: () => harness.snapshot }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: 'tooltip',
  TooltipTrigger: 'tooltip-trigger',
  TooltipContent: 'tooltip-content',
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: 'dropdown-menu',
  DropdownMenuContent: 'dropdown-content',
  DropdownMenuRadioGroup: 'dropdown-radio-group',
  DropdownMenuRadioItem: 'dropdown-radio-item',
  DropdownMenuTrigger: 'dropdown-trigger',
}));
vi.mock('@/host-actions/client', () => import('../packages/viewer/src/host-actions/client.js'));
vi.mock('@/lib/keyboard', () => import('../packages/viewer/src/lib/keyboard.js'));
vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' '),
}));
vi.mock('@/components/viewer-shortcuts', async () => {
  const path = '../packages/viewer/src/components/viewer-shortcuts.tsx';
  return import(path);
});

const components = '../packages/viewer/src/components';
const { RightRail } = (await import(`${components}/right-rail.tsx`)) as {
  RightRail(): React.ReactElement;
};
const { AnnotationBatchBar } = (await import(`${components}/annotation-batch-bar.tsx`)) as {
  AnnotationBatchBar(): React.ReactElement | null;
};
const { ViewerHelp, selectionDisabledReason, toolForShortcut, viewerTools } = (await import(
  `${components}/viewer-shortcuts.tsx`
)) as {
  ViewerHelp(props: { open: boolean; onOpenChange(open: boolean): void; supportsSelect: boolean }): React.ReactElement;
  selectionDisabledReason(snapshot: HostActionsSnapshot, hasModel: boolean): string | undefined;
  toolForShortcut(key: string, supportsSelect: boolean, selectDisabled: boolean): string | undefined;
  viewerTools(supportsSelect: boolean): Array<{ mode: string; label: string }>;
};

class Element {
  constructor(
    readonly parent: Element | null = null,
    readonly role: string | null = null,
  ) {}
  isContentEditable = false;
  focus = vi.fn();
  querySelector = vi.fn((selector: string) => (this === root && selector === '#view' ? canvas : null));
  contains(target: unknown): boolean {
    return target === this || (target instanceof Element && target.parent !== null && this.contains(target.parent));
  }
  closest(selector: string): Element | null {
    if (selector === '[data-viewer-root]') {
      return this.parent?.closest(selector) ?? this;
    }
    if (selector.includes('input') && this.role === 'input') {
      return this;
    }
    if (selector.includes('[role="dialog"]') && this.role === 'dialog') {
      return this;
    }
    return this.parent?.closest(selector) ?? null;
  }
}

const selectionAction: HostActionDescriptor = {
  id: 'attach-location-selection',
  label: 'Attach location',
  icon: 'message',
  slot: 'selection-gesture',
  tone: 'default',
  requires: ['model'],
};
let api: ViewerApi;
let root: Element;
let canvas: Element;
let active: Element;
let listeners: Array<{ callback: (event: KeyboardEvent) => void; capture: boolean }>;

beforeEach(() => {
  harness.store = createViewerStore();
  harness.snapshot = {
    actions: [],
    statuses: {},
    requestOrder: [],
    latestStatus: null,
    clientId: 'client',
    connected: true,
    protocolState: 'ready',
  };
  harness.effects = [];
  harness.refIndex = 0;
  harness.stateIndex = 0;
  harness.states = [];
  root = new Element();
  canvas = new Element(root);
  canvas.focus.mockImplementation(() => {
    active = canvas;
  });
  active = canvas;
  harness.refs = [new Element(root), new Element(root), null];
  listeners = [];
  api = {
    setMarkMode: vi.fn(),
    setRenderMode: vi.fn(),
    setTheme: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitToModel: vi.fn(),
    exportStl: vi.fn(() => Promise.resolve()),
  };
  harness.store.setViewerApi(api);
  harness.store.setPayload({
    description: 'Test',
    numProp: 3,
    triangles: 1,
    vertices: 3,
    vertProperties: new Float32Array(9),
    triVerts: new Uint32Array([0, 1, 2]),
    features: [],
    triFeatureIds: new Uint32Array(1),
    volume: 1,
    surfaceArea: 1,
    genus: 1,
    bboxMin: [0, 0, 0],
    bboxMax: [1, 1, 1],
  });
  vi.stubGlobal('React', React);
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', {
    get activeElement() {
      return active;
    },
  });
  vi.stubGlobal('window', {
    addEventListener: (name: string, callback: (event: KeyboardEvent) => void, capture = false) => {
      if (name === 'keydown') {
        listeners.push({ callback, capture });
      }
    },
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(): React.ReactElement {
  const tree = RightRail();
  for (const effect of harness.effects) {
    effect();
  }
  return tree;
}

function key(value: string, options: Partial<KeyboardEvent> = {}) {
  let prevented = false;
  let stopped = false;
  const event = {
    key: value,
    target: active,
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
    ...options,
  } as KeyboardEvent;
  for (const listener of [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))) {
    listener.callback(event);
    if (stopped) {
      break;
    }
  }
  return { prevented, stopped };
}

interface NodeProps {
  children?: React.ReactNode;
  render?: React.ReactNode;
  label?: string;
  'aria-label'?: string;
  'data-viewer-obstacle'?: boolean;
  container?: unknown;
  disabled?: boolean;
  onClick?: () => void;
}

function nodes(tree: React.ReactNode): Array<React.ReactElement<NodeProps>> {
  const result: Array<React.ReactElement<NodeProps>> = [];
  React.Children.forEach(tree, node => {
    if (React.isValidElement<NodeProps>(node)) {
      result.push(node, ...nodes(node.props.children), ...nodes(node.props.render));
    }
  });
  return result;
}

describe('Viewer controls', () => {
  it('keeps tool buttons icon-only while preserving names and shortcuts in tooltips', () => {
    harness.snapshot!.actions = [selectionAction];
    const tree = nodes(mount());
    for (const [name, label] of [
      ['Orbit (V)', 'Orbit'],
      ['Select to chat (S)', 'Select to chat'],
      ['Annotate (M)', 'Annotate'],
    ] as const) {
      const trigger = tree.find(node => {
        const render = node.props.render;
        return (
          node.type === 'tooltip-trigger' &&
          React.isValidElement<NodeProps>(render) &&
          render.props['aria-label'] === name
        );
      });
      expect(trigger).toBeDefined();
      expect(React.Children.toArray(trigger!.props.children)).toHaveLength(1);
      expect(
        tree.some(
          node => node.type === 'tooltip-content' && React.Children.toArray(node.props.children).includes(label),
        ),
      ).toBe(true);
    }
  });

  it('prioritizes only the advertised host capability and retains tool names', () => {
    expect(viewerTools(false).map(tool => tool.mode)).toEqual(['orbit', 'annotate']);
    expect(viewerTools(true).map(tool => tool.mode)).toEqual(['orbit', 'select', 'annotate']);
    expect(toolForShortcut('S', false, false)).toBeUndefined();
    expect(toolForShortcut('S', true, true)).toBeUndefined();
    expect(toolForShortcut('S', true, false)).toBe('select');
  });

  it.each(['disconnected', 'awaiting-manifest', 'error', 'pending', 'disabled'] as const)(
    'disables Select buttons and shortcuts while %s',
    reason => {
      harness.snapshot!.actions = [selectionAction];
      if (reason === 'disconnected') {
        harness.snapshot!.connected = false;
      }
      if (reason === 'awaiting-manifest' || reason === 'error') {
        harness.snapshot!.protocolState = reason;
      }
      if (reason === 'disabled') {
        harness.snapshot!.actions = [{ ...selectionAction, disabledReason: 'Unavailable now' }];
      }
      if (reason === 'pending') {
        const pending: HostActionStatusMessage = {
          kind: 'host_action_status',
          protocolVersion: 1,
          requestId: 'old-pending',
          actionId: selectionAction.id,
          state: 'running',
        };
        harness.snapshot!.statuses = {
          [pending.requestId]: pending,
          newer: { ...pending, requestId: 'newer', state: 'succeeded' },
        };
        harness.snapshot!.latestStatus = harness.snapshot!.statuses.newer!;
      }
      expect(selectionDisabledReason(harness.snapshot!, true)).toBeDefined();
      const select = nodes(mount()).find(node => node.props['aria-label'] === 'Select to chat (S)');
      expect(select?.props.disabled).toBe(true);
      select?.props.onClick?.();
      key('s');
      expect(api.setMarkMode).not.toHaveBeenCalled();
      expect(canvas.focus).not.toHaveBeenCalled();
      key('m');
      expect(api.setMarkMode).toHaveBeenCalledWith('annotate');
    },
  );

  it('uses the same tools and Fit action for clicks and scoped shortcuts', () => {
    harness.snapshot!.actions = [selectionAction];
    const tree = mount();
    key('s');
    key('f');
    key('v');
    nodes(tree).find(node => node.props.label === 'Fit model')!.props.onClick!();
    expect(api.setMarkMode).toHaveBeenNthCalledWith(1, 'select');
    expect(api.setMarkMode).toHaveBeenNthCalledWith(2, 'orbit');
    expect(api.fitToModel).toHaveBeenCalledTimes(2);
    expect(key('?').prevented).toBe(true);
    expect(harness.states[1]).toBe(true);
  });

  it('returns focus to this Viewer canvas after activating a tool button', () => {
    const tree = mount();
    active = harness.refs[0] as Element;
    nodes(tree).find(node => node.props['aria-label'] === 'Annotate (M)')!.props.onClick!();
    expect(api.setMarkMode).toHaveBeenCalledWith('annotate');
    expect(canvas.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(active).toBe(canvas);
    expect(root.querySelector).toHaveBeenCalledWith('#view');
  });

  it('returns focus to the canvas after switching tools by shortcut from a control', () => {
    mount();
    active = harness.refs[0] as Element;
    key('m');
    expect(api.setMarkMode).toHaveBeenCalledWith('annotate');
    expect(canvas.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(active).toBe(canvas);
  });

  it('keeps popup obstacles inside the owning Viewer for editor avoidance', () => {
    const rail = mount();
    expect(rail.props).toEqual(expect.objectContaining({ 'data-viewer-obstacle': true }));
    const renderMenu = nodes(rail).find(node => node.type === 'dropdown-content');
    expect(renderMenu?.props).toEqual(
      expect.objectContaining({
        'data-viewer-obstacle': true,
        container: root,
      }),
    );
    harness.refIndex = 0;
    const help = ViewerHelp({ open: true, onOpenChange: vi.fn(), supportsSelect: false });
    expect(nodes(help).some(node => node.props.container === root)).toBe(true);
    expect(nodes(help).some(node => node.props['data-viewer-obstacle'] === true)).toBe(true);
  });

  it.each(['outside', 'typing', 'popup', 'composing', 'modifier', 'repeat', 'prevented'] as const)(
    'leaves %s keyboard input untouched',
    scenario => {
      mount();
      if (scenario === 'outside') {
        active = new Element();
      }
      if (scenario === 'typing') {
        active = new Element(root, 'input');
      }
      if (scenario === 'popup') {
        active = new Element(root, 'dialog');
      }
      const options: Partial<KeyboardEvent> =
        scenario === 'composing'
          ? { isComposing: true }
          : scenario === 'modifier'
            ? { ctrlKey: true }
            : scenario === 'repeat'
              ? { repeat: true }
              : scenario === 'prevented'
                ? { defaultPrevented: true }
                : {};
      key('m', options);
      key('f', options);
      key('?', options);
      expect(api.setMarkMode).not.toHaveBeenCalled();
      expect(api.fitToModel).not.toHaveBeenCalled();
      expect(harness.states[1]).toBe(false);
    },
  );

  it('opens help without a model but does not run model controls', () => {
    harness.store!.setPayload(null);
    mount();
    key('m');
    key('f');
    key('?');
    expect(api.setMarkMode).not.toHaveBeenCalled();
    expect(api.fitToModel).not.toHaveBeenCalled();
    expect(harness.states[1]).toBe(true);
  });

  it('only includes S in help when location selection is supported', () => {
    const onOpenChange = vi.fn();
    const text = (supportsSelect: boolean) => JSON.stringify(ViewerHelp({ open: false, onOpenChange, supportsSelect }));
    expect(text(false)).not.toContain('Select to chat');
    expect(text(true)).toContain('Select to chat');
  });

  it('consumes Escape for an open menu before a tool can exit', () => {
    const trigger = new Element(root);
    Object.assign(trigger, {
      ownerDocument: {
        get activeElement() {
          return active;
        },
      },
    });
    const popup = new Element(null, 'dialog');
    active = popup;
    harness.refs = [new Element(root), trigger, popup];
    harness.states = [true, false];
    mount();
    const result = key('Escape');
    expect(result).toEqual({ prevented: true, stopped: true });
    expect(harness.states[0]).toBe(false);
    expect(trigger.focus).toHaveBeenCalled();
    expect(api.setMarkMode).not.toHaveBeenCalled();
  });

  it('does not consume Escape when no popup is open', () => {
    mount();
    expect(key('Escape')).toEqual({ prevented: false, stopped: false });
  });

  it.each(['prevented', 'composing', 'outside'] as const)(
    'leaves %s Escape untouched even with an open menu',
    scenario => {
      const trigger = new Element(root);
      Object.assign(trigger, {
        ownerDocument: {
          get activeElement() {
            return active;
          },
        },
      });
      const popup = new Element(null, 'dialog');
      active = scenario === 'outside' ? new Element() : popup;
      harness.refs = [new Element(root), trigger, popup];
      harness.states = [true, false];
      mount();
      key(
        'Escape',
        scenario === 'prevented' ? { defaultPrevented: true } : scenario === 'composing' ? { isComposing: true } : {},
      );
      expect(harness.states[0]).toBe(true);
      expect(trigger.focus).not.toHaveBeenCalled();
    },
  );
});

describe('Viewer batch controls', () => {
  function prepareBatch(host = true) {
    const annotations = new AnnotationStore();
    const marks = {
      store: annotations,
      commitOpenDraft: vi.fn(),
      flushAnnotations: vi.fn(() => true),
    };
    const send = vi.fn();
    const client = new HostActionsClient({
      send,
      isOpen: () => true,
      flushAnnotations: () => true,
      getInvocationContext: () => ({ modelVersion: 'test-model', annotationRevision: annotations.getRevision() }),
    });
    const actions: HostActionDescriptor[] = host
      ? [
          { ...selectionAction, id: 'attach-annotation-batch', slot: 'annotation-batch', label: 'Attach' },
          { ...selectionAction, id: 'fix-annotation-batch', slot: 'annotation-batch', label: 'Fix them' },
        ]
      : [];
    client.receiveManifest(createHostActionsManifest(actions));
    harness.snapshot = client.getSnapshot();
    harness.store!.setHostActionsClient(client);
    harness.store!.setMarksRuntime(marks);
    harness.store!.setMarkMode('annotate');
    const add = (note: string) =>
      annotations.addComment({
        kind: 'point',
        anchorWorld: [0, 0, 0],
        worldCoord: [0, 0, 0],
        triIds: [],
        note,
      });
    return { annotations, marks, client, send, add };
  }

  function buttons() {
    return nodes(AnnotationBatchBar()).filter(node => node.type === 'button');
  }

  function button(label: string) {
    return buttons().find(node => React.Children.toArray(node.props.children).includes(label))!;
  }

  it('does not render a zero-count batch island', () => {
    prepareBatch();
    expect(AnnotationBatchBar()).toBeNull();
  });

  it('keeps Attach primary, Fix secondary, and Cancel understated', () => {
    const { add } = prepareBatch();
    add('A detail');
    expect(
      buttons().map(node =>
        React.Children.toArray(node.props.children)
          .filter(child => typeof child === 'string')
          .join(''),
      ),
    ).toEqual(['Attach', 'Fix', 'Cancel']);
    expect((button('Attach').props as { variant?: string }).variant).toBeUndefined();
    expect((button('Fix').props as { variant?: string }).variant).toBe('ghost');
  });

  it('does not invoke a host action when closing the only empty live draft', () => {
    const { add, annotations, marks, send } = prepareBatch();
    const live = add('');
    marks.commitOpenDraft.mockImplementation(() => {
      annotations.remove(live.id);
    });
    button('Attach').props.onClick!();
    expect(send).not.toHaveBeenCalled();
    expect(annotations.list()).toEqual([]);
    expect(api.setMarkMode).not.toHaveBeenCalled();
  });

  it('preserves saved notes when an empty live draft closes before Attach', () => {
    const { add, annotations, marks, send } = prepareBatch();
    const saved = add('Keep this note');
    const live = add('');
    marks.commitOpenDraft.mockImplementation(() => {
      annotations.remove(live.id);
    });
    button('Attach').props.onClick!();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'attach-annotation-batch',
        annotationIds: [saved.id],
      }),
    );
    expect(annotations.get(saved.id)?.state).toBe('pending');
  });

  it('makes local Done primary and freezes the saved batch', () => {
    const { add, annotations } = prepareBatch(false);
    const saved = add('Keep this note');
    expect((button('Done').props as { variant?: string }).variant).toBeUndefined();
    button('Done').props.onClick!();
    expect(annotations.get(saved.id)?.state).toBe('committed');
    expect(api.setMarkMode).toHaveBeenCalledWith('orbit');
  });
});
