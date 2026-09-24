import { X } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import type { RulerController, RulerSnapshot } from '@/measurements/controller';
import { useViewerI18n, useViewerState } from '@/store';
import { glass, glassPopup } from './glass';
import { Button } from './ui/button';

export function MeasurementControls() {
  const marks = useViewerState(state => state.marksRuntime);
  return marks ? <RulerControls ruler={marks.ruler} /> : null;
}

function RulerControls({ ruler }: { ruler: RulerController }) {
  const i18n = useViewerI18n();
  const api = useViewerState(state => state.viewerApi);
  const state = useSyncExternalStore(ruler.subscribe, ruler.getSnapshot);
  return (
    <>
      {(state.notice || state.error) && (
        <div
          data-viewer-obstacle
          className={`${glassPopup} measurement-notice`}
          role={state.error ? 'alert' : 'status'}
        >
          <span className="min-w-0 flex-1 break-words">
            {state.error
              ? `${i18n.t('measureError')} ${state.error}`
              : i18n.t(state.notice === 'limit' ? 'measureLimit' : 'measureChanged')}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="measurement-icon-button"
            aria-label={i18n.t('measureDismiss')}
            onClick={() => ruler.dismissNotice()}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
      {state.active && <MeasurementHint state={state} onExit={() => api?.setMarkMode('orbit')} />}
    </>
  );
}

function MeasurementHint({ state, onExit }: { state: RulerSnapshot; onExit(): void }) {
  const i18n = useViewerI18n();

  return (
    <section data-viewer-obstacle className={`${glass} measurement-hud`} aria-label={i18n.t('measure')}>
      <span className="measurement-hint-text">
        {i18n.t(
          state.activeMeasurementId ? 'measureCompareOptional' : state.locked ? 'measureSecond' : 'measureInspect',
        )}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="measurement-icon-button"
        title={i18n.t('measureCancel')}
        aria-label={i18n.t('measureCancel')}
        onClick={onExit}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </section>
  );
}
