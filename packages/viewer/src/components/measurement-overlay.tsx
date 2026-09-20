import { ArrowUp, LoaderCircle, Paperclip, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Tooltip } from '@base-ui/react/tooltip';
import type { RulerController } from '@/measurements/controller';
import type { MeasurementAnnotation } from '@/marks/types';
import { useAnnotations, useViewerI18n, useViewerState, useViewerStore, type MarksRuntime } from '@/store';
import { layoutDimension, type ProjectedMeasurement } from '@/measurements/projection';
import {
  formatMeasurement,
  measurementHint,
  measurementBadges,
  measurementLabelAction,
} from '@/measurements/presentation';
import { ATTACH_MEASUREMENT, submitMeasurement } from '@/measurements/submission';
import { useHostActionsSnapshot } from './host-actions';
import { hostActionDisabledReason } from '@/host-actions/client';

export function MeasurementOverlay() {
  const marks = useViewerState(state => state.marksRuntime);
  return marks ? <RulerLayer marks={marks} ruler={marks.ruler} /> : null;
}

function RulerLayer({ marks, ruler }: { marks: MarksRuntime; ruler: RulerController }) {
  const i18n = useViewerI18n();
  const api = useViewerState(state => state.viewerApi);
  const mode = useViewerState(state => state.markMode);
  const client = useViewerState(state => state.hostActionsClient);
  const viewerStore = useViewerStore();
  const host = useHostActionsSnapshot();
  const attachAction = host.actions.find(action => action.id === ATTACH_MEASUREMENT);
  const state = useSyncExternalStore(ruler.subscribe, ruler.getSnapshot);
  const annotations = useAnnotations(marks.store);
  const measurements = annotations.filter((item): item is MeasurementAnnotation => item.intent === 'measurement');
  const expanded = measurements.find(item => item.id === state.expandedId);
  const editing = mode === 'annotate' && expanded !== undefined;

  const clickMeasurement = (annotation: MeasurementAnnotation) => {
    const action = measurementLabelAction(mode);
    if (action === 'comment') {
      marks.openMeasurementComment(annotation.id);
    } else if (action === 'attach' && client) {
      marks.commitOpenDraft();
      if (viewerStore.getState().viewerError?.key === 'measurementDeliveryFailed') {
        viewerStore.setViewerError(null);
      }
      const current = () =>
        viewerStore.getState().marksRuntime === marks &&
        viewerStore.getState().hostActionsClient === client &&
        marks.store.getModelVersion() === annotation.modelVersion;
      const operation = submitMeasurement({
        id: annotation.id,
        kind: 'attach',
        store: marks.store,
        client,
        i18n,
        isCurrent: current,
        flush: marks.flushAnnotations,
      });
      // Match the existing one-shot Select tool, never change modes on a late reply.
      api?.setMarkMode('orbit');
      void operation.catch(error => {
        if (current() && marks.store.get(annotation.id)?.modelVersion === annotation.modelVersion) {
          viewerStore.setViewerError({
            key: 'measurementDeliveryFailed',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
    } else {
      ruler.inspect(annotation.id);
    }
  };

  return (
    <>
      <section className="measurement-labels" aria-label={i18n.t('measureResults')}>
        {state.labels.map(label => {
          const annotation = measurements.find(item => item.id === label.id);
          const current = label.id === state.activeMeasurementId;
          if (!annotation || (current && state.preview?.kind === 'relation')) {
            return null;
          }
          const badges = measurementBadges(annotation);
          const attachReason =
            mode !== 'select'
              ? undefined
              : !attachAction
                ? i18n.t('actionNotReady')
                : hostActionDisabledReason(
                    attachAction,
                    {
                      connected: host.connected,
                      protocolReady: host.protocolState === 'ready',
                      hasModel: true,
                      annotationCount: 1,
                      pending: badges.pending,
                    },
                    i18n,
                  );
          const statuses = [
            badges.commented ? i18n.t('measureHasComment') : '',
            badges.attached ? i18n.t(badges.attachmentChanged ? 'measureAttachedOlderComment' : 'measureAttached') : '',
            badges.sent ? i18n.t('measureSent') : '',
          ].filter(Boolean);
          return (
            <MeasurementDimension
              key={label.id}
              ruler={ruler}
              dimensionId={`annotation:${label.id}`}
              width={state.width}
              height={state.height}
              annotationId={label.id}
              registerAnchor={marks.setMeasurementAnchor}
              placement={label}
              text={formatMeasurement(annotation.measurement, i18n)}
              title={[measurementHint(annotation.measurement, i18n), ...statuses, attachReason ?? '']
                .filter(Boolean)
                .join(' · ')}
              selected={label.id === state.expandedId}
              badges={badges}
              {...(badges.commented || badges.attached ? { displayNumber: annotation.displayNumber } : {})}
              comment={editing && label.id === state.expandedId ? undefined : annotation.note}
              disabled={badges.pending || attachReason !== undefined}
              removeDisabled={badges.pending}
              onRemove={mode === 'measure' ? () => marks.store.removeMeasurement(annotation.id) : undefined}
              onClick={() => clickMeasurement(annotation)}
            />
          );
        })}
        {state.active &&
          state.previewLabel &&
          state.preview &&
          !(state.activeMeasurementId && state.preview.kind === 'edge-length') && (
            <MeasurementDimension
              ruler={ruler}
              dimensionId="preview"
              width={state.width}
              height={state.height}
              placement={state.previewLabel}
              text={formatMeasurement(state.preview, i18n)}
              title={measurementHint(state.preview, i18n)}
              preview
            />
          )}
      </section>
    </>
  );
}

function MeasurementDimension({
  ruler,
  dimensionId,
  width,
  height,
  placement,
  text,
  title,
  selected = false,
  disabled = false,
  preview = false,
  annotationId,
  registerAnchor,
  onClick,
  onRemove,
  removeDisabled = false,
  badges,
  comment,
  displayNumber,
}: {
  ruler: RulerController;
  dimensionId: string;
  width: number;
  height: number;
  placement: ProjectedMeasurement;
  text: string;
  title: string;
  selected?: boolean;
  disabled?: boolean;
  preview?: boolean;
  annotationId?: string;
  registerAnchor?: MarksRuntime['setMeasurementAnchor'];
  onClick?: () => void;
  onRemove?: (() => void) | undefined;
  removeDisabled?: boolean;
  badges?: ReturnType<typeof measurementBadges>;
  comment?: string | undefined;
  displayNumber?: number;
}) {
  const i18n = useViewerI18n();
  const { resolvedTheme } = useTheme();
  const textRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState(60);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }
    const update = () => setTextWidth(element.offsetWidth + 10);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, displayNumber, badges?.commented, badges?.attached, badges?.sent, badges?.pending]);
  const layout = useMemo(() => layoutDimension(placement, textWidth), [placement, textWidth]);
  useLayoutEffect(() => {
    if (annotationId && registerAnchor) {
      return () => registerAnchor(annotationId, null);
    }
    return undefined;
  }, [registerAnchor, annotationId]);
  useLayoutEffect(() => {
    if (annotationId && registerAnchor) {
      registerAnchor(annotationId, textRef.current?.closest('button') ?? null);
    }
  }, [registerAnchor, annotationId, layout]);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }
    const color = getComputedStyle(element).getPropertyValue('--spatial').trim();
    ruler.setDimension(dimensionId, layout.strokes, width, height, color);
    return () => ruler.removeDimension(dimensionId);
  }, [ruler, dimensionId, layout, width, height, resolvedTheme]);
  const style = { left: layout.x, top: layout.y, transform: `translate(-50%, -50%) rotate(${layout.rotation}deg)` };
  const radians = (layout.rotation * Math.PI) / 180;
  return (
    <div
      className="measurement-dimension"
      data-preview={preview || undefined}
      data-selected={selected || undefined}
      data-commented={badges?.commented || undefined}
      data-attached={badges?.attached || undefined}
      data-attachment-changed={badges?.attachmentChanged || undefined}
      data-pending={badges?.pending || undefined}
    >
      {preview ? (
        <span className="measurement-label measurement-preview-label" style={style}>
          <span ref={textRef}>{text}</span>
        </span>
      ) : (
        <>
          <Tooltip.Root disabled={!comment?.trim()}>
            <Tooltip.Trigger
              render={
                <button
                  type="button"
                  className="measurement-label"
                  style={style}
                  aria-label={`${displayNumber === undefined ? '' : `#${displayNumber} · `}${text} · ${title}`}
                  aria-expanded={selected}
                  aria-busy={badges?.pending}
                  disabled={disabled}
                  onClick={onClick}
                />
              }
            >
              <span ref={textRef} className="measurement-label-content">
                {displayNumber !== undefined && (
                  <span className="measurement-label-number" aria-hidden="true">
                    #{i18n.number(displayNumber)} ·
                  </span>
                )}
                <span>{text}</span>
                {badges?.attached && <Paperclip size={11} aria-hidden="true" />}
                {badges?.sent && <ArrowUp size={11} aria-hidden="true" />}
                {badges?.pending && <LoaderCircle size={11} className="animate-spin" aria-hidden="true" />}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal container={textRef.current?.closest('[data-viewer-root]')}>
              <Tooltip.Positioner side="right" sideOffset={8} collisionPadding={12} className="z-50">
                <Tooltip.Popup className="marks-flyout-preview measurement-comment-preview" lang={i18n.getLocale()}>
                  {comment}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
          {onRemove && (
            <button
              type="button"
              className="measurement-remove"
              aria-label={i18n.t('measureRemove')}
              title={i18n.t('measureRemove')}
              disabled={removeDisabled}
              onClick={onRemove}
              style={{
                left: layout.x + Math.cos(radians) * (textWidth / 2 + 14),
                top: layout.y + Math.sin(radians) * (textWidth / 2 + 14),
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
