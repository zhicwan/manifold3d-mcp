import { Popover } from '@base-ui/react/popover';
import { Box, Download, Info, Moon, Sun, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExportMenuHostActions, ToolbarHostActions, useHostActionsSnapshot } from '@/components/host-actions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { glassPill, glassPopup } from '@/components/glass';
import { useViewerPopupEscape } from '@/components/viewer-shortcuts';
import { getLatestHostActionStatus, hasPendingHostActionRequest, STL_EXPORT_ACTION_ID } from '@/host-actions/client';
import { cn } from '@/lib/utils';
import { useViewerState, type ViewerApi } from '@/store';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';

export function TopBar({ toolbarEnd }: { toolbarEnd?: ReactNode }) {
  const payload = useViewerState(s => s.payload);
  const status = useViewerState(s => s.status);
  const modelVersion = useViewerState(s => s.modelVersion);
  const api = useViewerState(s => s.viewerApi);
  const statusLabel =
    status === 'protocol-error'
      ? 'Protocol error'
      : status === 'disconnected'
        ? 'Disconnected'
        : modelVersion === 'demo'
          ? 'Demo'
          : status === 'connected'
            ? 'Live'
            : 'Connecting…';
  const title = payload?.description || 'Manifold 3D';

  return (
    <header className="viewer-top-bar pointer-events-none absolute inset-x-0 top-0 z-30">
      <div data-viewer-obstacle className={cn(glassPill, 'viewer-identity flex min-w-0 items-center gap-2.5 px-3.5')}>
        <Box className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm font-medium" title={title}>
          {title}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="viewer-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
                aria-label={`Status: ${statusLabel}`}
                tabIndex={0}
              />
            }
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                status === 'connected' && 'bg-teal-600 dark:bg-teal-400',
                status === 'connecting' && 'bg-amber-600 dark:bg-amber-400',
                (status === 'disconnected' || status === 'protocol-error') && 'bg-destructive',
              )}
            />
            {statusLabel !== 'Live' && <span>{statusLabel}</span>}
          </TooltipTrigger>
          <TooltipContent side="bottom">{statusLabel}</TooltipContent>
        </Tooltip>
      </div>
      <ActionsCluster payload={payload} api={api} toolbarEnd={toolbarEnd} />
    </header>
  );
}

function ActionsCluster({
  payload,
  api,
  toolbarEnd,
}: {
  payload: ViewerModel | null;
  api: ViewerApi | null;
  toolbarEnd?: ReactNode;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const infoTrigger = useRef<HTMLButtonElement>(null);
  const infoPopup = useRef<HTMLDivElement>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const exportPopup = useRef<HTMLDivElement>(null);
  const snapshot = useHostActionsSnapshot();
  const exportStatus = getLatestHostActionStatus(snapshot, STL_EXPORT_ACTION_ID);
  const savedExport = [...snapshot.requestOrder]
    .reverse()
    .map(requestId => snapshot.statuses[requestId])
    .find(status => status?.actionId === STL_EXPORT_ACTION_ID && status.state === 'succeeded');
  const actionsEnabled = payload !== null && api !== null;
  useViewerPopupEscape(infoOpen, () => setInfoOpen(false), infoTrigger, infoPopup);
  useViewerPopupEscape(exportOpen, () => setExportOpen(false), exportTrigger, exportPopup);

  return (
    <div data-viewer-obstacle className={cn(glassPill, 'viewer-top-actions flex shrink-0 items-center gap-0.5 px-1')}>
      <ToolbarHostActions />
      <ThemeToggle />
      {toolbarEnd}
      <div className="mx-0.5 h-5 w-px bg-border/70" aria-hidden="true" />
      <DropdownMenu open={exportOpen} onOpenChange={setExportOpen} modal={false}>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                ref={exportTrigger}
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="viewer-top-button rounded-full"
                    aria-label="Export"
                    disabled={!actionsEnabled || hasPendingHostActionRequest(snapshot, STL_EXPORT_ACTION_ID)}
                  />
                }
              />
            }
          >
            <Download className="size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Export</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          data-viewer-popup
          data-viewer-obstacle
          container={exportTrigger.current?.closest('[data-viewer-root]')}
          ref={exportPopup}
          align="end"
          className={cn(glassPopup, 'viewer-popup w-56')}
        >
          <DropdownMenuItem className="min-h-10 rounded-xl" onClick={() => void api?.exportStl()}>
            <Download className="size-4" aria-hidden="true" />
            Export STL
          </DropdownMenuItem>
          <ExportMenuHostActions />
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover.Root open={infoOpen} onOpenChange={setInfoOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Popover.Trigger
                ref={infoTrigger}
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="viewer-top-button rounded-full"
                    aria-label="Model information"
                    disabled={!payload && !exportStatus}
                  />
                }
              />
            }
          >
            <Info className="size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Model information</TooltipContent>
        </Tooltip>
        <Popover.Portal container={infoTrigger.current?.closest('[data-viewer-root]')}>
          <Popover.Positioner align="end" sideOffset={8} collisionPadding={12} className="z-50">
            <Popover.Popup
              data-viewer-popup
              data-viewer-obstacle
              ref={infoPopup}
              className={cn(glassPopup, 'viewer-popup viewer-model-info p-4')}
            >
              <div className="mb-3 flex items-center justify-between gap-4">
                <Popover.Title className="text-sm font-semibold">Model information</Popover.Title>
                <Popover.Close
                  render={
                    <Button variant="ghost" size="icon" className="rounded-full" aria-label="Close model information" />
                  }
                >
                  <X className="size-4" aria-hidden="true" />
                </Popover.Close>
              </div>
              {payload && (
                <>
                  <p className="mb-3 max-h-24 overflow-auto break-words text-sm font-medium">
                    {payload.description || 'Untitled model'}
                  </p>
                  <ModelStats payload={payload} />
                </>
              )}
              {(savedExport?.message || exportStatus?.message) && (
                <div className="mt-3 border-t border-border/60 pt-3 text-xs">
                  <h3 className="mb-1 font-medium">{savedExport ? 'Last saved STL' : 'Last STL export'}</h3>
                  <p
                    className={cn(
                      'select-text break-words',
                      !savedExport && exportStatus?.state === 'failed' && 'text-destructive',
                    )}
                  >
                    {savedExport?.message ?? exportStatus?.message}
                  </p>
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function ModelStats({ payload }: { payload: ViewerModel }) {
  const sx = payload.bboxMax[0] - payload.bboxMin[0];
  const sy = payload.bboxMax[1] - payload.bboxMin[1];
  const sz = payload.bboxMax[2] - payload.bboxMin[2];

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
      <dt className="text-muted-foreground">Dimensions</dt>
      <dd className="text-right tabular-nums">
        {fmt(sx)} × {fmt(sy)} × {fmt(sz)} mm
      </dd>
      <dt className="text-muted-foreground">Volume</dt>
      <dd className="text-right tabular-nums">{(payload.volume / 1000).toFixed(2)} cm³</dd>
      <dt className="text-muted-foreground">Surface area</dt>
      <dd className="text-right tabular-nums">{(payload.surfaceArea / 100).toFixed(1)} cm²</dd>
      <dt className="text-muted-foreground">Triangles</dt>
      <dd className="text-right tabular-nums">{payload.triangles.toLocaleString()}</dd>
      <dt className="text-muted-foreground">Genus</dt>
      <dd className="text-right tabular-nums">{payload.genus}</dd>
    </dl>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="viewer-top-button rounded-full"
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          />
        }
      >
        {isDark ? <Moon className="size-4" aria-hidden="true" /> : <Sun className="size-4" aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{isDark ? 'Light theme' : 'Dark theme'}</TooltipContent>
    </Tooltip>
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    return '-';
  }
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
}
