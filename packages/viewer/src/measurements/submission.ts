import { hostActionDisabledReason, type HostActionsClient } from '../host-actions/client.js';
import type { ViewerI18n } from '../i18n/index.js';
import type { AnnotationStore } from '../marks/annotation-store.js';

export const ATTACH_MEASUREMENT = 'attach-measurement';

/** Terminal failures stay in client status; preflight and interrupted requests throw. */
export async function submitMeasurement(options: {
  id: string;
  store: AnnotationStore;
  client: HostActionsClient;
  i18n: ViewerI18n;
  isCurrent(): boolean;
  flush(): boolean;
}): Promise<'succeeded' | 'failed' | 'stale'> {
  const { id, store, client, i18n, isCurrent, flush } = options;
  if (!isCurrent()) {
    return 'stale';
  }
  const annotation = store.get(id);
  if (annotation?.intent !== 'measurement') {
    throw new Error(i18n.t('actionRequiresAnnotations'));
  }
  const snapshot = client.getSnapshot();
  const actionId = ATTACH_MEASUREMENT;
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
  const allocatedDisplayNumber = annotation.displayNumber === 0;
  const displayNumber = store.ensureMeasurementDisplayNumber(id);
  if (displayNumber === undefined) {
    throw new Error(i18n.t('actionAlreadyRunning'));
  }
  const previousState = annotation.state;
  if (!store.setMeasurementState(id, previousState, 'pending')) {
    if (allocatedDisplayNumber) {
      store.releaseMeasurementDisplayNumber(id);
    }
    throw new Error(i18n.t('actionAlreadyRunning'));
  }
  const captured = store.get(id);
  const stillCurrent = () => isCurrent() && store.get(id) === captured;
  try {
    const status = await client.invokeAndWait(actionId, {
      annotationIds: [id],
      input: { markerNumbers: [displayNumber] },
    });
    if (!stillCurrent()) {
      return 'stale';
    }
    if (status.state === 'failed') {
      store.setMeasurementState(id, 'pending', previousState);
      if (allocatedDisplayNumber) {
        store.releaseMeasurementDisplayNumber(id);
      }
      flush();
      return 'failed';
    }
    if (status.state !== 'succeeded') {
      throw new Error(status.message ?? i18n.t('measureSubmitFailed'));
    }
    store.completeMeasurementDelivery(id, 'attach');
    flush();
    return 'succeeded';
  } catch (error) {
    if (!stillCurrent()) {
      return 'stale';
    }
    store.setMeasurementState(id, 'pending', previousState);
    if (allocatedDisplayNumber) {
      store.releaseMeasurementDisplayNumber(id);
    }
    flush();
    throw error;
  }
}
