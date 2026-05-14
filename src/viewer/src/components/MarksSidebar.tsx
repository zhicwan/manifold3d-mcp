import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAnnotations, useViewerState } from '@/store';

export function MarksSidebar() {
  const runtime = useViewerState(s => s.marksRuntime);
  const annotations = useAnnotations(runtime?.store ?? null);
  const saved = annotations.filter(a => a.note.trim() !== '');

  if (!runtime || saved.length === 0) {
    return null;
  }

  return (
    <Card className="pointer-events-auto fixed bottom-4 right-4 z-30 max-h-[45vh] w-[320px] overflow-hidden border-white/70 bg-white/85 shadow-xl backdrop-blur-xl">
      <CardHeader className="flex-row items-center justify-between gap-3 p-3">
        <CardTitle className="text-sm">Marks</CardTitle>
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          {saved.length}
        </span>
      </CardHeader>
      <CardContent className="max-h-[calc(45vh-52px)] space-y-2 overflow-y-auto p-3 pt-0">
        {saved.map(ann => (
          <button
            key={ann.id}
            className="group flex w-full items-start gap-2 rounded-lg border bg-background/80 p-2 text-left shadow-sm transition hover:bg-accent"
            type="button"
            onClick={() => runtime.flyouts.openExpanded(ann.id)}
          >
            <span
              className={cn(
                'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                ann.kind === 'point' ? 'bg-red-500' : 'bg-amber-500',
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{ann.partLabel}</span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">{ann.note}</span>
            </span>
            <Button
              aria-label="Delete annotation"
              className="h-7 w-7 opacity-70 group-hover:opacity-100"
              size="icon"
              type="button"
              variant="ghost"
              onClick={ev => {
                ev.stopPropagation();
                runtime.store.remove(ann.id);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
