import { Box } from 'lucide-react';
import { useViewerI18n, useViewerState } from '@/store';

export function EmptyState() {
  const i18n = useViewerI18n();
  const payload = useViewerState(s => s.payload);
  const status = useViewerState(s => s.status);

  if (payload) {
    return null;
  }

  return (
    <div className="viewer-empty-state pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <Box className="size-7 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-sm font-medium">
        {status === 'connected'
          ? i18n.t('waitingModel')
          : status === 'connecting'
            ? i18n.t('connecting')
            : status === 'protocol-error'
              ? i18n.t('protocolError')
              : i18n.t('viewerDisconnected')}
      </h1>
    </div>
  );
}
