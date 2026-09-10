import { Popover } from '@base-ui/react/popover';
import { Box, Download, Info, Languages, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExportMenuHostActions, ToolbarHostActions, useHostActionsSnapshot } from '@/components/host-actions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { glass, glassPopup } from '@/components/glass';
import { useViewerPopupEscape } from '@/components/viewer-shortcuts';
import {
  getLatestHostActionStatus,
  hasPendingHostActionRequest,
  hostActionStatusMessage,
  STL_EXPORT_ACTION_ID,
} from '@/host-actions/client';
import { cn } from '@/lib/utils';
import { useViewerI18n, useViewerState, type ViewerApi } from '@/store';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';

export function TopBar({ toolbarEnd }: { toolbarEnd?: ReactNode }) {
  const i18n = useViewerI18n();
  const payload = useViewerState(s => s.payload);
  const status = useViewerState(s => s.status);
  const modelVersion = useViewerState(s => s.modelVersion);
  const api = useViewerState(s => s.viewerApi);
  const statusLabel =
    status === 'protocol-error'
      ? i18n.t('protocolError')
      : status === 'disconnected'
        ? i18n.t('disconnected')
        : modelVersion === 'demo'
          ? i18n.t('demo')
          : status === 'connected'
            ? i18n.t('live')
            : i18n.t('connecting');
  const title = payload?.description || 'Manifold 3D';

  return (
    <header className="viewer-top-bar pointer-events-none absolute inset-x-0 top-0 z-30">
      <div data-viewer-obstacle className={cn(glass, 'viewer-top-island')}>
        <div className="viewer-identity flex min-w-0 items-center gap-2.5 px-3.5">
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
                  aria-label={i18n.t('connectionStatus', statusLabel)}
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
              {(status !== 'connected' || modelVersion === 'demo') && <span>{statusLabel}</span>}
            </TooltipTrigger>
            <TooltipContent side="bottom">{statusLabel}</TooltipContent>
          </Tooltip>
        </div>
        <div className="viewer-top-divider" aria-hidden="true" />
        <ActionsCluster payload={payload} api={api} toolbarEnd={toolbarEnd} />
      </div>
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
  const i18n = useViewerI18n();
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
  const displayedExport = savedExport ?? exportStatus;
  const actionsEnabled = payload !== null && api !== null;
  useViewerPopupEscape(infoOpen, () => setInfoOpen(false), infoTrigger, infoPopup);
  useViewerPopupEscape(exportOpen, () => setExportOpen(false), exportTrigger, exportPopup);

  return (
    <div className="viewer-top-actions flex shrink-0 items-center gap-0.5 px-1">
      <ToolbarHostActions />
      <ThemeToggle />
      <LanguageMenu />
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
                    className="viewer-top-button rounded-xl"
                    aria-label={i18n.t('export')}
                    disabled={!actionsEnabled || hasPendingHostActionRequest(snapshot, STL_EXPORT_ACTION_ID)}
                  />
                }
              />
            }
          >
            <Download className="size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{i18n.t('export')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          data-viewer-popup
          data-viewer-obstacle
          container={exportTrigger.current?.closest('[data-viewer-root]')}
          ref={exportPopup}
          align="end"
          className={cn(glassPopup, 'viewer-popup')}
        >
          <DropdownMenuItem className="min-h-10 rounded-xl" onClick={() => void api?.exportStl()}>
            <Download className="size-4" aria-hidden="true" />
            {i18n.t('exportStl')}
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
                    className="viewer-top-button rounded-xl"
                    aria-label={i18n.t('modelInformation')}
                    disabled={!payload && !exportStatus}
                  />
                }
              />
            }
          >
            <Info className="size-4" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{i18n.t('modelInformation')}</TooltipContent>
        </Tooltip>
        <Popover.Portal container={infoTrigger.current?.closest('[data-viewer-root]')}>
          <Popover.Positioner align="end" sideOffset={8} collisionPadding={12} className="z-50">
            <Popover.Popup
              data-viewer-popup
              data-viewer-obstacle
              ref={infoPopup}
              className={cn(glassPopup, 'viewer-popup viewer-model-info p-4')}
            >
              <Popover.Title className="sr-only">{i18n.t('modelInformation')}</Popover.Title>
              {payload && (
                <>
                  <p className="mb-3 max-h-24 overflow-auto break-words text-sm font-medium">
                    {payload.description || i18n.t('untitledModel')}
                  </p>
                  <ModelStats payload={payload} />
                </>
              )}
              {displayedExport && (
                <div className="mt-3 border-t border-border/60 pt-3 text-xs">
                  <h3 className="mb-1 font-medium">{i18n.t(savedExport ? 'lastSavedStl' : 'lastStlExport')}</h3>
                  <p
                    className={cn(
                      'select-text break-words',
                      !savedExport && exportStatus?.state === 'failed' && 'text-destructive',
                    )}
                  >
                    {hostActionStatusMessage(displayedExport, i18n)}
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
  const i18n = useViewerI18n();
  const fmt = (n: number) =>
    i18n.number(n, {
      minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 1,
      maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1,
    });
  const sx = payload.bboxMax[0] - payload.bboxMin[0];
  const sy = payload.bboxMax[1] - payload.bboxMin[1];
  const sz = payload.bboxMax[2] - payload.bboxMin[2];

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
      <dt className="text-muted-foreground">{i18n.t('dimensions')}</dt>
      <dd className="text-right tabular-nums">
        {fmt(sx)} × {fmt(sy)} × {fmt(sz)} mm
      </dd>
      <dt className="text-muted-foreground">{i18n.t('volume')}</dt>
      <dd className="text-right tabular-nums">
        {i18n.number(payload.volume / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} cm³
      </dd>
      <dt className="text-muted-foreground">{i18n.t('surfaceArea')}</dt>
      <dd className="text-right tabular-nums">
        {i18n.number(payload.surfaceArea / 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cm²
      </dd>
      <dt className="text-muted-foreground">{i18n.t('triangles')}</dt>
      <dd className="text-right tabular-nums">{i18n.number(payload.triangles)}</dd>
      <dt className="text-muted-foreground">{i18n.t('genus')}</dt>
      <dd className="text-right tabular-nums">{i18n.number(payload.genus)}</dd>
    </dl>
  );
}

function ThemeToggle() {
  const i18n = useViewerI18n();
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
            className="viewer-top-button rounded-xl"
            aria-label={i18n.t(isDark ? 'switchLightTheme' : 'switchDarkTheme')}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          />
        }
      >
        {isDark ? <Moon className="size-4" aria-hidden="true" /> : <Sun className="size-4" aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{i18n.t(isDark ? 'lightTheme' : 'darkTheme')}</TooltipContent>
    </Tooltip>
  );
}

function LanguageMenu() {
  const i18n = useViewerI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useViewerPopupEscape(open, () => setOpen(false), trigger, popup);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              ref={trigger}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="viewer-top-button rounded-xl"
                  aria-label={i18n.t('language')}
                />
              }
            />
          }
        >
          <Languages className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="bottom">{i18n.t('language')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        ref={popup}
        data-viewer-popup
        data-viewer-obstacle
        container={trigger.current?.closest('[data-viewer-root]')}
        align="end"
        className={cn(glassPopup, 'viewer-popup')}
      >
        <DropdownMenuRadioGroup
          value={i18n.getLocale()}
          onValueChange={value => {
            if (value === 'en' || value === 'zh-CN') {
              i18n.setPreference(value);
            }
          }}
        >
          <DropdownMenuRadioItem
            value="en"
            lang="en"
            className="min-h-10 rounded-xl"
            onClick={() => i18n.setPreference('en')}
          >
            English
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="zh-CN"
            lang="zh-CN"
            className="min-h-10 rounded-xl"
            onClick={() => i18n.setPreference('zh-CN')}
          >
            简体中文
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
