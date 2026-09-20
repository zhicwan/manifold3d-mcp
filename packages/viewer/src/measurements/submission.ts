import { hostActionDisabledReason, type HostActionsClient } from '../host-actions/client.js';
import type { ViewerI18n } from '../i18n/index.js';
import type { AnnotationStore } from '../marks/annotation-store.js';

export const ATTACH_MEASUREMENT = 'attach-measurement';
export const SEND_MEASUREMENT = 'fix-measurement';

/** Terminal failures stay in client status; preflight and interrupted requests throw. */
export async function submitMeasurement(options: {
  id: string;
  kind: 'attach' | 'send';
  store: AnnotationStore;
  client: HostActionsClient;
  i18n: ViewerI18n;
  isCurrent(): boolean;
  flush(): boolean;
}): Promise<'succeeded' | 'failed' | 'stale'> {
  const { id, kind, store, client, i18n, isCurrent, flush } = options;
  if (!isCurrent()) {
    return 'stale';
  }
  const annotation = store.get(id);
  if (annotation?.intent !== 'measurement') {
    throw new Error(i18n.t('actionRequiresAnnotations'));
  }
  const snapshot = client.getSnapshot();
  const actionId = kind === 'attach' ? ATTACH_MEASUREMENT : SEND_MEASUREMENT;
  const action = snapshot.actions.find(item => item.id === actionId);
  if (!action) {
    throw new Error(i18n.t('actionNotReady'));
  }
  const reason = hostActionDisabledReason(
    action,
    {
      connected: snapshot.connected,
      protocolReady: snapshot.protocolState === 'ready',
      hasModel: true,
      annotationCount: 1,
      pending: annotation.state === 'pending',
    },
    i18n,
  );
  if (reason) {
    throw new Error(reason);
  }
  if (kind === 'send' && !annotation.note.trim()) {
    throw new Error(i18n.t('measureInstructionRequired'));
  }
  const previousState = annotation.state;
  if (!store.setMeasurementState(id, previousState, 'pending')) {
    throw new Error(i18n.t('actionAlreadyRunning'));
  }
  const captured = store.get(id);
  const stillCurrent = () => isCurrent() && store.get(id) === captured;
  try {
    const status = await client.invokeAndWait(actionId, {
      annotationIds: [id],
      input: { markerNumbers: [annotation.displayNumber] },
    });
    if (!stillCurrent()) {
      return 'stale';
    }
    if (status.state === 'failed') {
      store.setMeasurementState(id, 'pending', previousState);
      flush();
      return 'failed';
    }
    if (status.state !== 'succeeded') {
      throw new Error(status.message ?? i18n.t('measureSubmitFailed'));
    }
    store.completeMeasurementDelivery(id, kind);
    flush();
    return 'succeeded';
  } catch (error) {
    if (!stillCurrent()) {
      return 'stale';
    }
    store.setMeasurementState(id, 'pending', previousState);
    flush();
    throw error;
  }
}
