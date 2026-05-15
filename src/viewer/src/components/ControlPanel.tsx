import { Check, Download, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { RenderMode } from '@/scene/viewer';
import { useViewerState } from '@/store';
import type { PreviewPayload } from '@/types';

const RENDER_OPTIONS: Array<[RenderMode, string]> = [
  ['solid', 'Solid'],
  ['wireframe', 'Wire'],
  ['edges', 'Edges'],
  ['xray', 'X-Ray'],
];

export function ControlPanel() {
  const payload = useViewerState(s => s.payload);
  const status = useViewerState(s => s.status);
  const renderMode = useViewerState(s => s.renderMode);
  const api = useViewerState(s => s.viewerApi);
  const actionsEnabled = payload !== null && api !== null;

  return (
    <Card className="pointer-events-auto fixed right-4 top-4 z-30 w-[300px] border-white/70 bg-white/70 shadow-xl backdrop-blur-xl">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="truncate text-sm">{payload?.description || 'manifold-mcp'}</CardTitle>
          {/*
            VIE-8 a11y: the dot is purely visual; sighted users get the
            color, screen-reader users get an aria-live announcement
            whenever the connection state changes ("Status: connected",
            etc.). role="status" + polite means the announcement is made
            without interrupting any other speech in progress.
          */}
          <span
            className="inline-flex h-5 w-5 items-center justify-center"
            title={status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
            role="status"
            aria-live="polite"
            aria-label={`Status: ${status}`}
          >
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                status === 'connected' && 'bg-teal-500',
                status === 'connecting' && 'bg-amber-500',
                status === 'disconnected' && 'bg-red-500',
              )}
            />
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-4 pb-4">
        {payload && <ModelInfo payload={payload} />}

        <div className="h-px bg-border" />

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Render</div>
          <ToggleGroup
            aria-label="Render mode"
            type="single"
            value={renderMode}
            onValueChange={value => {
              if (value) {
                api?.setRenderMode(value as RenderMode);
              }
            }}
          >
            {RENDER_OPTIONS.map(([value, label]) => (
              <ToggleGroupItem key={value} aria-label={`${label} render mode`} disabled={!api} size="sm" value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>

        <div className="h-px bg-border" />

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Export</div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!actionsEnabled}
              onClick={() => {
                // VIE-4: exporters are now async (dynamic import). The
                // click handler fires-and-forgets — there's no UI we can
                // do during the brief module load that the disabled
                // state on the button doesn't already convey.
                void api?.export3mf();
              }}
              title="3MF preserves manifold topology — recommended for slicers."
            >
              <Download />
              3MF
            </Button>
            <Button
              className="flex-1"
              disabled={!actionsEnabled}
              onClick={() => {
                void api?.exportStl();
              }}
              title="STL is widely supported but lossy; vertices are duplicated per face."
              variant="outline"
            >
              <Download />
              STL
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function ModelInfo({ payload }: { payload: PreviewPayload }) {
  const sx = payload.bboxMax[0] - payload.bboxMin[0];
  const sy = payload.bboxMax[1] - payload.bboxMin[1];
  const sz = payload.bboxMax[2] - payload.bboxMin[2];
  const watertight = payload.genus === 0;

  return (
    <section>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Bounding Box</dt>
        <dd className="truncate text-right tabular-nums">
          {fmt(sx)} x {fmt(sy)} x {fmt(sz)} mm
        </dd>
        <dt className="text-muted-foreground">Volume</dt>
        <dd className="text-right tabular-nums">{(payload.volume / 1000).toFixed(2)} cm3</dd>
        <dt className="text-muted-foreground">Surface Area</dt>
        <dd className="text-right tabular-nums">{(payload.surfaceArea / 100).toFixed(1)} cm2</dd>
        <dt className="text-muted-foreground">Triangles</dt>
        <dd className="text-right tabular-nums">{payload.triangles.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Watertight</dt>
        <dd className="flex items-center justify-end gap-1">
          {watertight ? <Check className="size-3 text-teal-600" /> : <X className="size-3 text-red-600" />}
          {watertight ? 'Yes' : `No (genus ${payload.genus})`}
        </dd>
      </dl>
    </section>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    return '-';
  }
  if (Math.abs(n) >= 100) {
    return n.toFixed(0);
  }
  return n.toFixed(1);
}
