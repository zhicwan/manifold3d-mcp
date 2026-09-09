import { Popover } from '@base-ui/react/popover';
import { CircleHelp, MapPin, MessageSquare, MousePointer2, X } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';

import { glassPopup } from '@/components/glass';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  hasPendingHostActionRequest,
  hostActionDisabledReason,
  LOCATION_SELECTION_ACTION_ID,
  type HostActionsSnapshot,
} from '@/host-actions/client';
import type { MarkMode } from '@/marks/types';

export const VIEWER_TOOLS = [
  { mode: 'orbit', label: 'Orbit', shortcut: 'V', icon: MousePointer2 },
  { mode: 'annotate', label: 'Annotate', shortcut: 'M', icon: MapPin },
  { mode: 'select', label: 'Select to chat', shortcut: 'S', icon: MessageSquare },
] as const;

export function viewerTools(supportsSelect: boolean) {
  return supportsSelect ? [VIEWER_TOOLS[0], VIEWER_TOOLS[2], VIEWER_TOOLS[1]] : [VIEWER_TOOLS[0], VIEWER_TOOLS[1]];
}

export function selectionDisabledReason(snapshot: HostActionsSnapshot, hasModel: boolean): string | undefined {
  const action = snapshot.actions.find(item => item.id === LOCATION_SELECTION_ACTION_ID);
  if (!action) {
    return 'Location attachment is unavailable.';
  }
  return hostActionDisabledReason(action, {
    connected: snapshot.connected,
    protocolReady: snapshot.protocolState === 'ready',
    hasModel,
    // The gesture creates the annotation; no pre-existing annotation is required.
    annotationCount: 1,
    pending: hasPendingHostActionRequest(snapshot, LOCATION_SELECTION_ACTION_ID),
  });
}

export function toolForShortcut(key: string, supportsSelect: boolean, selectDisabled: boolean): MarkMode | undefined {
  return viewerTools(supportsSelect).find(
    tool => tool.shortcut.toLowerCase() === key.toLowerCase() && (tool.mode !== 'select' || !selectDisabled),
  )?.mode;
}

/**
 * Popups can be portaled outside the Viewer root. Handle their Escape first,
 * but never consume another Viewer's or the host chat's key event.
 */
export function useViewerPopupEscape(
  open: boolean,
  close: () => void,
  trigger: RefObject<HTMLElement | null>,
  popup: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) {
        return;
      }
      const root = trigger.current?.closest('[data-viewer-root]');
      const target = event.target as Node | null;
      const active = trigger.current?.ownerDocument.activeElement;
      if (
        !target ||
        (!root?.contains(target) && !popup.current?.contains(target)) ||
        (active && !root?.contains(active) && !popup.current?.contains(active))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close, trigger, popup]);
}

export function ViewerHelp({
  open,
  onOpenChange,
  supportsSelect,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  supportsSelect: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useViewerPopupEscape(open, () => onOpenChange(false), trigger, popup);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Popover.Trigger ref={trigger} className="viewer-rail-button viewer-rail-secondary" aria-label="Help (?)" />
          }
        >
          <CircleHelp className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="left">
          Help <kbd>?</kbd>
        </TooltipContent>
      </Tooltip>
      <Popover.Portal container={trigger.current?.closest('[data-viewer-root]')}>
        <Popover.Positioner side="left" align="end" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup
            data-viewer-popup
            data-viewer-obstacle
            ref={popup}
            className={`${glassPopup} viewer-help viewer-popup p-4`}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <Popover.Title className="text-sm font-semibold">Controls</Popover.Title>
              <Popover.Close
                render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="Close help" />}
              >
                <X className="size-4" aria-hidden="true" />
              </Popover.Close>
            </div>
            <dl className="viewer-shortcut-list">
              {viewerTools(supportsSelect).map(tool => (
                <ShortcutRow key={tool.mode} label={tool.label} value={tool.shortcut} />
              ))}
              <ShortcutRow label="Fit model" value="F" />
              <ShortcutRow label="Help" value="?" />
              <ShortcutRow label="Temporary orbit" value="Hold Space" />
              <ShortcutRow label="Cancel / exit" value="Esc" />
            </dl>
            <dl className="viewer-shortcut-list mt-3 border-t border-border/60 pt-3">
              <ShortcutRow label="Point / region" value="Click / drag" />
              <ShortcutRow label="Orbit" value="Left drag" />
              <ShortcutRow label="Pan" value="Middle / right drag" />
              <ShortcutRow label="Zoom" value="Scroll / pinch" />
              <ShortcutRow label="Feature preview" value="Hold Alt" />
              <ShortcutRow label="Save / new line" value="Enter / Shift Enter" />
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ShortcutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt>{label}</dt>
      <dd className="shrink-0 text-muted-foreground">{value}</dd>
    </div>
  );
}
