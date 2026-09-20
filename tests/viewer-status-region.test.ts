import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostActionStatus } from '../packages/protocol/src/wire/host-actions.js';
import { HostActionsClient } from '../packages/viewer/src/host-actions/client.js';
import { createViewerStore, type ViewerState, type ViewerStore } from '../packages/viewer/src/store.js';

const harness = vi.hoisted(() => ({ store: null as ViewerStore | null }));
vi.mock('react', async original => ({
  ...(await original<typeof React>()),
  useState: (value: unknown) => [value, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('@/store', () => ({
  useViewerI18n: () => harness.store!.i18n,
  useViewerState: <T>(select: (state: ViewerState) => T) => select(harness.store!.getState()),
  useAnnotations: () => [],
}));
vi.mock('@/components/glass', () => ({ glass: '' }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: 'menuitem',
  DropdownMenuLabel: 'label',
  DropdownMenuSeparator: 'hr',
}));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: 'tooltip',
  TooltipTrigger: 'trigger',
  TooltipContent: 'content',
}));
vi.mock('@/host-actions/client', () => import('../packages/viewer/src/host-actions/client.js'));
vi.mock('@/lib/utils', () => ({ cn: (...classes: unknown[]) => classes.filter(Boolean).join(' ') }));

const component = '../packages/viewer/src/components/host-actions.tsx';
const { HostActionStatusRegion } = (await import(component)) as {
  HostActionStatusRegion(): React.ReactElement | null;
};

function text(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map(child =>
      React.isValidElement<{ children?: React.ReactNode }>(child)
        ? text(child.props.children)
        : typeof child === 'string'
          ? child
          : '',
    )
    .join('');
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  harness.store = createViewerStore();
  const client = new HostActionsClient({
    send: vi.fn(),
    isOpen: () => true,
    flushAnnotations: () => true,
    getInvocationContext: () => ({ modelVersion: 'v1', annotationRevision: 1 }),
  });
  harness.store.setHostActionsClient(client);
  client.receiveStatus(
    createHostActionStatus({
      requestId: 'request',
      actionId: 'attach-measurement',
      state: 'failed',
      message: 'host diagnostic',
    }),
  );
});

afterEach(() => {
  harness.store?.getState().hostActionsClient?.dispose();
  vi.unstubAllGlobals();
});

describe('Viewer status ownership', () => {
  it('shows the host diagnostic once when no Viewer operation error takes precedence', () => {
    expect(text(HostActionStatusRegion()).match(/host diagnostic/g)).toHaveLength(1);
  });

  it('does not repeat a host failure alongside a local measurement delivery error', () => {
    harness.store!.setViewerError({ key: 'measurementDeliveryFailed', detail: 'host diagnostic' });
    const region = HostActionStatusRegion();
    expect(region?.props).toMatchObject({ role: 'alert' });
    expect(text(region).match(/host diagnostic/g)).toHaveLength(1);
    expect(text(region)).toContain('Measurement request failed');
  });

  it('keeps a protocol failure readable without appending an unrelated host action status', () => {
    harness.store!.setProtocolError('Unsupported protocol');
    expect(text(HostActionStatusRegion())).toContain('Unsupported protocol');
    expect(text(HostActionStatusRegion())).not.toContain('host diagnostic');
  });

  it('preserves another operation result while showing a local measurement error', () => {
    harness.store!.setViewerError({ key: 'measurementDeliveryFailed', detail: 'measurement diagnostic' });
    harness.store!.getState().hostActionsClient!.receiveStatus(
      createHostActionStatus({
        requestId: 'export',
        actionId: 'export-model-file',
        state: 'succeeded',
        resultDetails: { kind: 'model-saved', path: '/exports/model.3mf', format: '3mf' },
      }),
    );
    const content = text(HostActionStatusRegion());
    expect(content).toContain('measurement diagnostic');
    expect(content).toContain('/exports/model.3mf');
  });
});
