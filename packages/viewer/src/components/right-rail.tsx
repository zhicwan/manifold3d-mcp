import { useEffect, useRef, useState } from 'react';
import { Box, Focus, Grid3X3, PenLine, Scan, ZoomIn, ZoomOut } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useHostActionsSnapshot } from '@/components/host-actions';
import { glass, glassPopup } from '@/components/glass';
import {
  selectionDisabledReason,
  toolForShortcut,
  useViewerPopupEscape,
  ViewerHelp,
  viewerTools,
} from '@/components/viewer-shortcuts';
import { supportsLocationSelection } from '@/host-actions/client';
import { isViewerShortcutEvent } from '@/lib/keyboard';
import { cn } from '@/lib/utils';
import type { RenderMode } from '@/scene/viewer';
import { useViewerState } from '@/store';

const RENDER_OPTIONS: Array<{ value: RenderMode; label: string; icon: typeof Box }> = [
  { value: 'solid', label: 'Solid', icon: Box },
  { value: 'wireframe', label: 'Wireframe', icon: Grid3X3 },
  { value: 'edges', label: 'Edges', icon: PenLine },
  { value: 'xray', label: 'X-Ray', icon: Scan },
];

export function RightRail() {
  const markMode = useViewerState(s => s.markMode);
  const renderMode = useViewerState(s => s.renderMode);
  const api = useViewerState(s => s.viewerApi);
  const payload = useViewerState(s => s.payload);
  const hostActions = useHostActionsSnapshot();
  const supportsSelect = supportsLocationSelection(hostActions.actions);
  const selectReason = selectionDisabledReason(hostActions, payload !== null);
  const enabled = api !== null && payload !== null;
  const [renderOpen, setRenderOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const renderTrigger = useRef<HTMLButtonElement>(null);
  const renderPopup = useRef<HTMLDivElement>(null);
  useViewerPopupEscape(renderOpen, () => setRenderOpen(false), renderTrigger, renderPopup);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current?.closest<HTMLElement>('[data-viewer-root]') ?? null;
      if (event.repeat || renderOpen || helpOpen || !isViewerShortcutEvent(event, root)) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (!enabled) {
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        api.fitToModel();
        return;
      }
      const mode = toolForShortcut(event.key, supportsSelect, selectReason !== undefined);
      if (mode) {
        event.preventDefault();
        api.setMarkMode(mode);
        root?.querySelector<HTMLCanvasElement>('#view')?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api, enabled, supportsSelect, selectReason, renderOpen, helpOpen]);

  useEffect(() => {
    if (markMode === 'select' && !supportsSelect) {
      api?.setMarkMode('orbit');
    }
  }, [api, markMode, supportsSelect]);

  const ActiveRenderIcon = RENDER_OPTIONS.find(option => option.value === renderMode)!.icon;

  return (
    <nav data-viewer-obstacle ref={rootRef} aria-label="Viewer tools" className={cn(glass, 'viewer-right-rail')}>
      <div className="flex flex-col gap-1">
        {viewerTools(supportsSelect).map(tool => {
          const Icon = tool.icon;
          const primary = tool.mode === (supportsSelect ? 'select' : 'annotate');
          const disabled = !enabled || (tool.mode === 'select' && selectReason !== undefined);
          return (
            <Tooltip key={tool.mode}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${tool.label} (${tool.shortcut})`}
                    aria-pressed={markMode === tool.mode}
                    data-primary={primary || undefined}
                    disabled={disabled}
                    title={tool.mode === 'select' ? selectReason : undefined}
                    className="viewer-rail-button viewer-tool-button"
                    onClick={() => {
                      if (disabled) {
                        return;
                      }
                      api?.setMarkMode(tool.mode);
                      rootRef.current
                        ?.closest('[data-viewer-root]')
                        ?.querySelector<HTMLCanvasElement>('#view')
                        ?.focus({ preventScroll: true });
                    }}
                  />
                }
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="left">
                {tool.label} <kbd>{tool.shortcut}</kbd>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="viewer-rail-divider" aria-hidden="true" />
      <div className="viewer-view-controls">
        <RailAction label="Zoom in" icon={ZoomIn} disabled={!enabled} onClick={() => api?.zoomIn()} />
        <RailAction label="Zoom out" icon={ZoomOut} disabled={!enabled} onClick={() => api?.zoomOut()} />
        <RailAction label="Fit model" shortcut="F" icon={Focus} disabled={!enabled} onClick={() => api?.fitToModel()} />
        <DropdownMenu open={renderOpen} onOpenChange={setRenderOpen} modal={false}>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  ref={renderTrigger}
                  className="viewer-rail-button viewer-rail-secondary"
                  aria-label="Render mode"
                  disabled={!enabled}
                />
              }
            >
              <ActiveRenderIcon className="size-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="left">Render mode</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            data-viewer-popup
            data-viewer-obstacle
            container={rootRef.current?.closest('[data-viewer-root]')}
            ref={renderPopup}
            side="left"
            align="center"
            sideOffset={8}
            className={cn(glassPopup, 'viewer-popup w-40')}
          >
            <DropdownMenuRadioGroup value={renderMode} onValueChange={value => api?.setRenderMode(value as RenderMode)}>
              {RENDER_OPTIONS.map(option => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-9 gap-2 rounded-xl">
                  <option.icon className="size-4" aria-hidden="true" />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="viewer-rail-divider" aria-hidden="true" />
      <ViewerHelp open={helpOpen} onOpenChange={setHelpOpen} supportsSelect={supportsSelect} />
    </nav>
  );
}

function RailAction({
  label,
  shortcut,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  icon: typeof Box;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={shortcut ? `${label} (${shortcut})` : label}
            disabled={disabled}
            className="viewer-rail-button viewer-rail-secondary"
            onClick={onClick}
          />
        }
      >
        <Icon className="size-4" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="left">
        {label} {shortcut && <kbd>{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
