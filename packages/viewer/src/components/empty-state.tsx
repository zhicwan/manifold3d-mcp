import { Box } from 'lucide-react';
import { useViewerState } from '@/store';

export function EmptyState() {
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
          ? 'Waiting for a model'
          : status === 'connecting'
            ? 'Connecting…'
            : 'Viewer disconnected'}
      </h1>
    </div>
  );
}
