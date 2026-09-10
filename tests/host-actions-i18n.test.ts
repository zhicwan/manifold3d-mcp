import { describe, expect, it } from 'vitest';

import { createHostActionsManifest, type HostActionDescriptor } from '../packages/protocol/src/wire/host-actions.js';
import { createViewerI18n } from '../packages/viewer/src/i18n/index.js';
import {
  HostActionsClient,
  hostActionDisabledReason,
  hostActionLabel,
  hostActionStatusMessage,
} from '../packages/viewer/src/host-actions/client.js';

const action: HostActionDescriptor = {
  id: 'attach-annotation-batch',
  label: 'A host-provided label that is not matched by text',
  icon: 'message',
  slot: 'annotation-batch',
  tone: 'default',
  requires: ['model', 'annotations'],
};

describe('host action localization', () => {
  it('updates in-flight and completed feedback without mutating canonical request or status data', async () => {
    const sent: unknown[] = [];
    const i18n = createViewerI18n('en');
    const client = new HostActionsClient({
      send: value => sent.push(value),
      isOpen: () => true,
      flushAnnotations: () => true,
      getInvocationContext: () => ({ modelVersion: 'v1', annotationRevision: 3 }),
      createRequestId: () => 'request-1',
    });
    client.receiveManifest(createHostActionsManifest([action]));
    const completion = client.invokeAndWait(action.id, {
      annotationIds: ['annotation-1'],
      input: { batchId: 'batch-1' },
    });
    const pending = client.getSnapshot().latestStatus!;
    expect(pending.message).toBeUndefined();
    expect(hostActionStatusMessage(pending, i18n)).toBe('Attaching notes…');
    i18n.setPreference('zh-CN');
    expect(hostActionStatusMessage(pending, i18n)).toBe('正在附加批注…');
    client.receiveStatus({
      ...pending,
      state: 'succeeded',
      message: 'Arbitrary server text',
      resultDetails: { kind: 'annotations-attached', count: 1 },
    });
    const result = await completion;
    expect(hostActionStatusMessage(result, i18n)).toBe('已附加 1 条批注。');
    i18n.setPreference('en');
    expect(hostActionStatusMessage(result, i18n)).toBe('Attached 1 annotation.');
    expect(result.message).toBe('Arbitrary server text');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ annotationIds: ['annotation-1'], input: { batchId: 'batch-1' } });
    expect(sent[0]).not.toHaveProperty('locale');
  });

  it('maps known IDs and states rather than English strings and preserves host-defined actions', () => {
    const i18n = createViewerI18n('zh-CN');
    expect(hostActionLabel(action, i18n)).toBe('附加');
    const base = { kind: 'host_action_status' as const, protocolVersion: 1 as const, requestId: 'r1' };
    expect(
      hostActionStatusMessage(
        {
          ...base,
          actionId: 'fix-annotation-batch',
          state: 'succeeded',
          message: 'anything',
        },
        i18n,
      ),
    ).toBe('Copilot 已接受批注修复请求并将其加入队列。');
    expect(
      hostActionStatusMessage(
        {
          ...base,
          actionId: 'attach-location-selection',
          state: 'succeeded',
        },
        i18n,
      ),
    ).toBe('已附加所选位置。');
    expect(hostActionLabel({ ...action, id: 'custom' }, i18n)).toBe(action.label);
    expect(
      hostActionStatusMessage(
        {
          ...base,
          actionId: 'custom',
          state: 'succeeded',
          message: 'User-defined completion',
        },
        i18n,
      ),
    ).toBe('User-defined completion');
  });

  it('localizes saved-path framing and failures without translating paths or server diagnostics', () => {
    const i18n = createViewerI18n('zh-CN');
    const base = {
      kind: 'host_action_status' as const,
      protocolVersion: 1 as const,
      requestId: 'r1',
      actionId: 'export-stl-file',
    };
    expect(
      hostActionStatusMessage(
        {
          ...base,
          state: 'succeeded',
          resultDetails: { kind: 'stl-saved', path: '/exports/模型.stl' },
        },
        i18n,
      ),
    ).toBe('STL 已保存至 /exports/模型.stl');
    expect(
      hostActionStatusMessage(
        {
          ...base,
          state: 'failed',
          message: 'ENOENT: /exports/模型.stl',
        },
        i18n,
      ),
    ).toBe('操作失败：ENOENT: /exports/模型.stl');
  });

  it('localizes availability and local synchronization failures at render time', () => {
    const i18n = createViewerI18n('zh-CN');
    const availability = { connected: true, protocolReady: true, hasModel: true, annotationCount: 1, pending: false };
    expect(hostActionDisabledReason(action, { ...availability, connected: false }, i18n)).toBe(
      '查看器宿主已断开连接。',
    );
    expect(hostActionDisabledReason(action, { ...availability, pending: true }, i18n)).toBe('此操作正在执行。');
    expect(hostActionDisabledReason({ ...action, disabledReason: 'raw reason' }, availability, i18n)).toBe(
      '操作不可用：raw reason',
    );
    const client = new HostActionsClient({
      send: () => undefined,
      isOpen: () => true,
      flushAnnotations: () => false,
      getInvocationContext: () => ({ modelVersion: 'v1', annotationRevision: 0 }),
    });
    client.receiveManifest(createHostActionsManifest([action]));
    client.invoke(action.id);
    const status = client.getSnapshot().latestStatus!;
    expect(hostActionStatusMessage(status, i18n)).toBe('调用操作前无法同步批注。');
    i18n.setPreference('en');
    expect(hostActionStatusMessage(status, i18n)).toBe('Could not synchronize annotations before invoking the action.');
  });
});
