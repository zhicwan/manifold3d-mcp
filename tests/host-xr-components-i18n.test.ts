import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerStore } from '../packages/viewer/src/store.js';
import type { XrExperienceState } from '../packages/viewer/src/xr/state.js';
import type * as XrExperienceModule from '../packages/viewer/src/xr/experience.js';

const harness = vi.hoisted(() => ({
  store: null as ViewerStore | null,
  xr: null as XrExperienceState | null,
}));

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof React>()),
  useState: (initial: unknown) => [initial, () => undefined],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@/store', async () => ({
  ...(await import('../packages/viewer/src/store.js')),
  useViewerI18n: () => harness.store!.i18n,
  useViewerState: (selector: (state: ReturnType<ViewerStore['getState']>) => unknown) =>
    selector(harness.store!.getState()),
  useAnnotations: () => [],
}));
vi.mock('@/components/glass', () => ({ glass: '' }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: 'tooltip',
  TooltipContent: 'tooltip-content',
  TooltipTrigger: 'tooltip-trigger',
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: 'menu-item',
  DropdownMenuLabel: 'menu-label',
  DropdownMenuSeparator: 'menu-separator',
}));
vi.mock('@/lib/utils', () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(' ') }));
vi.mock('@/host-actions/client', () => import('../packages/viewer/src/host-actions/client.js'));
vi.mock('@/viewer-runtime', () => ({ useViewerRuntime: () => null }));
vi.mock('../packages/viewer/src/xr/experience.js', async importOriginal => ({
  ...(await importOriginal<typeof XrExperienceModule>()),
  useXrExperienceState: () => harness.xr,
}));

import { createViewerStore } from '../packages/viewer/src/store.js';
import { createXrExperienceState } from '../packages/viewer/src/xr/state.js';
import { HostActionsClient } from '../packages/viewer/src/host-actions/client.js';
import { HOST_ACTION_PROTOCOL_VERSION, createHostActionsManifest } from '../packages/protocol/src/wire/host-actions.js';

// As in the ownership tests, Vitest transforms TSX while this project's test
// typecheck covers the explicit callback surface without React path aliases.
const viewer = '../packages/viewer/src';
const { createXrExperience } = (await import(`${viewer}/xr/index.tsx`)) as {
  createXrExperience(): XrExperienceModule.XrExperience;
};
const { HostActionStatusRegion, ToolbarHostActions } = (await import(`${viewer}/components/host-actions.tsx`)) as {
  HostActionStatusRegion(): React.ReactNode;
  ToolbarHostActions(): React.ReactNode;
};

beforeEach(() => {
  harness.store = createViewerStore();
  harness.store.i18n.setPreference('en');
  harness.xr = createXrExperienceState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localized host and optional XR component presentation', () => {
  it('localizes structured Viewer errors and raw protocol diagnostics at render time', () => {
    harness.store!.setViewerError({ key: 'annotationSyncFailed', detail: 'raw sync detail' });
    expect(text(HostActionStatusRegion())).toBe('Annotation sync failed: raw sync detail');
    harness.store!.i18n.setPreference('zh-CN');
    expect(text(HostActionStatusRegion())).toBe('批注同步失败：raw sync detail');
    harness.store!.setProtocolError('raw protocol detail');
    expect(text(HostActionStatusRegion())).toBe('协议错误：raw protocol detail');
    harness.store!.i18n.setPreference('en');
    expect(text(HostActionStatusRegion())).toBe('Protocol error: raw protocol detail');
    expect(harness.store!.getState().viewerError).toEqual({
      key: 'annotationSyncFailed',
      detail: 'raw sync detail',
    });
    expect(harness.store!.getState().protocolError).toBe('raw protocol detail');
  });

  it('rerenders an existing host completion and toolbar label while retaining request state', () => {
    const client = new HostActionsClient({
      send: () => undefined,
      isOpen: () => true,
      flushAnnotations: () => true,
      getInvocationContext: () => ({ modelVersion: 'v1', annotationRevision: 0 }),
    });
    client.receiveManifest(
      createHostActionsManifest([
        {
          id: 'fix-annotation-batch',
          label: 'host label',
          slot: 'toolbar',
          icon: 'wand',
          tone: 'default',
          requires: [],
        },
      ]),
    );
    harness.store!.setHostActionsClient(client);
    client.receiveStatus({
      kind: 'host_action_status',
      protocolVersion: HOST_ACTION_PROTOCOL_VERSION,
      requestId: 'r1',
      actionId: 'fix-annotation-batch',
      state: 'succeeded',
      message: 'untranslated host text',
    });
    const status = client.getSnapshot().latestStatus;
    expect(text(HostActionStatusRegion())).toContain('Annotation fix was accepted by Copilot for enqueueing.');
    expect(findElement(ToolbarHostActions(), element => element.props['aria-label'] === 'Fix')).not.toBeNull();
    harness.store!.i18n.setPreference('zh-CN');
    expect(text(HostActionStatusRegion())).toContain('Copilot 已接受批注修复请求并将其加入队列。');
    expect(findElement(ToolbarHostActions(), element => element.props['aria-label'] === '修复')).not.toBeNull();
    expect(client.getSnapshot().latestStatus).toBe(status);
  });

  it('renders the localized ManifoldCAD toolbar action with an external-link icon', () => {
    const client = new HostActionsClient({
      send: () => undefined,
      isOpen: () => true,
      flushAnnotations: () => true,
      getInvocationContext: () => ({ modelVersion: 'v1', annotationRevision: 0 }),
    });
    client.receiveManifest(
      createHostActionsManifest([
        {
          id: 'open-in-manifoldcad',
          label: 'host label',
          slot: 'toolbar',
          icon: 'external-link',
          tone: 'default',
          requires: ['model'],
        },
      ]),
    );
    client.setConnectionStatus('connected');
    harness.store!.setHostActionsClient(client);

    const toolbar = ToolbarHostActions();
    expect(findElement(toolbar, element => element.props['aria-label'] === 'Open in ManifoldCAD')).not.toBeNull();
    expect(findElement(toolbar, element => element.type === ExternalLink)).not.toBeNull();
    expect(findElement(toolbar, element => element.props.className === 'viewer-host-action-label')).toBeNull();
    harness.store!.i18n.setPreference('zh-CN');
    expect(
      findElement(ToolbarHostActions(), element => element.props['aria-label'] === '在 ManifoldCAD 中打开'),
    ).not.toBeNull();
  });

  it('shows concise model export feedback and copies the saved path', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const client = new HostActionsClient({
      send: () => undefined,
      isOpen: () => true,
      flushAnnotations: () => true,
      getInvocationContext: () => ({ modelVersion: 'v1', annotationRevision: 0 }),
    });
    client.receiveManifest(
      createHostActionsManifest([
        {
          id: 'export-model-file',
          label: 'Export model',
          slot: 'export-handler',
          icon: 'download',
          tone: 'default',
          requires: ['model'],
        },
      ]),
    );
    harness.store!.setHostActionsClient(client);
    client.receiveStatus({
      kind: 'host_action_status',
      protocolVersion: HOST_ACTION_PROTOCOL_VERSION,
      requestId: 'export-1',
      actionId: 'export-model-file',
      state: 'succeeded',
      resultDetails: { kind: 'model-saved', format: '3mf', path: '/exports/model.3mf' },
    });

    const region = HostActionStatusRegion();
    expect(text(region)).toContain('3MF saved to');
    expect(text(region)).toContain('/exports/model.3mf');
    expect(text(region)).toContain('Copy path');
    const copyButton = findElement(
      region,
      element => element.type === 'button' && element.props['aria-label'] === 'Copy path',
    );
    expect(copyButton).not.toBeNull();
    copyButton?.props.onClick?.();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('/exports/model.3mf');
  });

  it('rerenders XR controls and retained errors without changing session ownership', async () => {
    const experience = createXrExperience();
    harness.xr!.setSupport(true);
    harness.xr!.setHasModel(true);
    const binding = harness.xr!.bindEnterHandler(() => Promise.reject(new Error('raw runtime detail')));
    expect(text(renderSlot(experience.slots.toolbarEnd))).toContain('Enter VR preview');
    harness.store!.i18n.setPreference('zh-CN');
    expect(text(renderSlot(experience.slots.toolbarEnd))).toContain('进入 VR 预览');
    await expect(harness.xr!.enter()).rejects.toThrow('raw runtime detail');
    const snapshot = harness.xr!.getSnapshot();
    expect(text(renderSlot(experience.slots.overlays))).toBe('无法进入 VR：raw runtime detail');
    harness.store!.i18n.setPreference('en');
    expect(text(renderSlot(experience.slots.overlays))).toBe('Unable to enter VR: raw runtime detail');
    expect(harness.xr!.getSnapshot()).toBe(snapshot);
    binding.setSessionState('active');
    harness.store!.i18n.setPreference('zh-CN');
    expect(text(renderSlot(experience.slots.toolbarEnd))).toContain('VR 会话进行中');
    expect(renderSlot(experience.slots.overlays)).toBeNull();
  });
});

function renderSlot(node: React.ReactNode): React.ReactNode {
  if (!React.isValidElement(node) || typeof node.type !== 'function') {
    throw new Error('Expected a component slot.');
  }
  return (node.type as (props: unknown) => React.ReactNode)(node.props);
}

function text(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(text).join('');
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return text(node.props.children);
  }
  return '';
}

function findElement(
  node: React.ReactNode,
  predicate: (
    element: React.ReactElement<{
      'aria-label'?: string;
      className?: string;
      children?: React.ReactNode;
      onClick?: () => void;
      render?: React.ReactNode;
    }>,
  ) => boolean,
): React.ReactElement<{
  'aria-label'?: string;
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  render?: React.ReactNode;
}> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (
    !React.isValidElement<{
      'aria-label'?: string;
      className?: string;
      children?: React.ReactNode;
      onClick?: () => void;
      render?: React.ReactNode;
    }>(node)
  ) {
    return null;
  }
  if (predicate(node)) {
    return node;
  }
  return findElement(node.props.render, predicate) ?? findElement(node.props.children, predicate);
}
