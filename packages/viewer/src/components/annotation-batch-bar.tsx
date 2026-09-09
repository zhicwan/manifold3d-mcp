import { Check, LoaderCircle, MessageSquare, WandSparkles } from 'lucide-react';
import { useState } from 'react';

import { glass } from '@/components/glass';
import { useHostActionsSnapshot } from '@/components/host-actions';
import { Button } from '@/components/ui/button';
import { hasPendingHostActionRequest, hostActionDisabledReason } from '@/host-actions/client';
import { useAnnotations, useViewerState, useViewerStore, type MarksRuntime } from '@/store';
import { MAX_HOST_ACTION_ANNOTATION_IDS, type HostActionDescriptor } from '@manifold3d/protocol/wire/host-actions.js';

const ATTACH_BATCH_ACTION = 'attach-annotation-batch';
const FIX_BATCH_ACTION = 'fix-annotation-batch';

export function AnnotationBatchBar() {
  const viewerStore = useViewerStore();
  const markMode = useViewerState(state => state.markMode);
  const payload = useViewerState(state => state.payload);
  const viewerApi = useViewerState(state => state.viewerApi);
  const marks = useViewerState(state => state.marksRuntime);
  const client = useViewerState(state => state.hostActionsClient);
  const hostActions = useHostActionsSnapshot();
  useAnnotations(marks?.store ?? null);
  const [pending, setPending] = useState<{ actionId: string; marks: MarksRuntime } | null>(null);
  const pendingAction = pending?.marks === marks ? pending.actionId : null;

  if (markMode !== 'annotate' || !marks) {
    return null;
  }

  const batch = marks.store.getDraftBatch();
  if (batch.annotationIds.length === 0) {
    return null;
  }
  const attachAction = hostActions.actions.find(action => action.id === ATTACH_BATCH_ACTION);
  const fixAction = hostActions.actions.find(action => action.id === FIX_BATCH_ACTION);
  const hasHostBatchActions = attachAction !== undefined || fixAction !== undefined;
  const batchEmpty = batch.annotationIds.length === 0;
  const batchTooLarge = batch.annotationIds.length > MAX_HOST_ACTION_ANNOTATION_IDS;
  const busy = pendingAction !== null;
  const isCurrent = (): boolean => {
    const state = viewerStore.getState();
    return state.marksRuntime === marks && state.viewerApi === viewerApi && state.hostActionsClient === client;
  };
  const disabledReason = (action: HostActionDescriptor): string | undefined =>
    batchTooLarge
      ? `A batch can contain at most ${MAX_HOST_ACTION_ANNOTATION_IDS} annotations.`
      : hostActionDisabledReason(action, {
          connected: hostActions.connected,
          protocolReady: hostActions.protocolState === 'ready',
          hasModel: payload !== null,
          annotationCount: batch.annotationIds.length,
          pending: hasPendingHostActionRequest(hostActions, action.id),
        });

  const finishLocally = (kind: 'freeze' | 'cancel'): void => {
    if (!isCurrent()) {
      return;
    }
    if (kind === 'freeze') {
      marks.commitOpenDraft();
      marks.store.freezeBatch(batch.batchId);
    } else {
      marks.store.cancelBatch(batch.batchId);
    }
    marks.flushAnnotations();
    viewerApi?.setMarkMode('orbit');
  };

  const invoke = (actionId: string): void => {
    if (!client || batchEmpty || busy || !isCurrent()) {
      return;
    }
    marks.commitOpenDraft();
    const committedDraft = marks.store.getDraftBatch();
    if (committedDraft.annotationIds.length === 0) {
      return;
    }
    if (!marks.store.sealBatch(committedDraft.batchId)) {
      return;
    }
    marks.flushAnnotations();
    viewerApi?.setMarkMode('orbit');
    const request = { actionId, marks };
    setPending(request);
    const operation = client
      .invokeAndWait(actionId, {
        annotationIds: committedDraft.annotationIds,
        input: { batchId: committedDraft.batchId },
      })
      .then(status => {
        if (!isCurrent()) {
          return;
        }
        if (status.state === 'succeeded') {
          marks.store.freezeBatch(committedDraft.batchId);
        } else {
          if (marks.store.restoreBatch(committedDraft.batchId)) {
            viewerApi?.setMarkMode('annotate');
          }
        }
        marks.flushAnnotations();
      })
      .catch(() => {
        if (!isCurrent()) {
          return;
        }
        const restored = marks.store.restoreBatch(committedDraft.batchId);
        marks.flushAnnotations();
        if (restored) {
          viewerApi?.setMarkMode('annotate');
        }
      });
    void operation.then(clearPending, clearPending);
    function clearPending(): void {
      setPending(current => (current === request ? null : current));
    }
  };

  return (
    <section
      data-viewer-obstacle
      aria-label="Annotation batch actions"
      className={`${glass} viewer-batch-bar flex items-center gap-1 p-1.5`}
    >
      <span
        className="viewer-batch-count px-2 text-xs font-medium text-muted-foreground"
        aria-label={`${batch.annotationIds.length} annotations`}
      >
        {batch.annotationIds.length}
        <span className="viewer-batch-count-label"> {batch.annotationIds.length === 1 ? 'note' : 'notes'}</span>
      </span>
      {attachAction && (
        <Button
          size="sm"
          className="viewer-batch-button rounded-full"
          disabled={batchEmpty || busy || disabledReason(attachAction) !== undefined}
          title={disabledReason(attachAction) ?? 'Add notes to chat context'}
          onClick={() => invoke(attachAction.id)}
        >
          {pendingAction === attachAction.id ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <MessageSquare aria-hidden="true" />
          )}
          Attach
        </Button>
      )}
      {fixAction && (
        <Button
          variant="ghost"
          size="sm"
          className="viewer-batch-button rounded-full"
          disabled={batchEmpty || busy || disabledReason(fixAction) !== undefined}
          title={disabledReason(fixAction) ?? 'Send notes and ask AI to fix'}
          onClick={() => invoke(fixAction.id)}
        >
          {pendingAction === fixAction.id ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <WandSparkles aria-hidden="true" />
          )}
          Fix
        </Button>
      )}
      {!hasHostBatchActions && (
        <Button
          size="sm"
          className="viewer-batch-button rounded-full"
          disabled={batchEmpty || busy}
          onClick={() => finishLocally('freeze')}
        >
          <Check aria-hidden="true" />
          Done
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="viewer-batch-button rounded-full text-muted-foreground"
        disabled={busy}
        onClick={() => finishLocally('cancel')}
      >
        Cancel
      </Button>
    </section>
  );
}
