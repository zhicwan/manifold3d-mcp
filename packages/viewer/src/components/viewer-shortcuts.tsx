import { Popover } from '@base-ui/react/popover';
import { CircleHelp, MapPin, MessageSquare, MousePointer2 } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';

import { glassPopup } from '@/components/glass';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  hasPendingHostActionRequest,
  hostActionDisabledReason,
  LOCATION_SELECTION_ACTION_ID,
  type HostActionsSnapshot,
} from '@/host-actions/client';
import type { MarkMode } from '@/marks/types';
import { useViewerI18n } from '@/store';
import type { ViewerI18n } from '@/i18n';

export const VIEWER_TOOLS = [
  { mode: 'orbit', shortcut: 'V', icon: MousePointer2 },
  { mode: 'annotate', shortcut: 'M', icon: MapPin },
  { mode: 'select', shortcut: 'S', icon: MessageSquare },
] as const;

export function viewerTools(supportsSelect: boolean) {
  return supportsSelect ? [VIEWER_TOOLS[0], VIEWER_TOOLS[2], VIEWER_TOOLS[1]] : [VIEWER_TOOLS[0], VIEWER_TOOLS[1]];
}

export function selectionDisabledReason(
  snapshot: HostActionsSnapshot,
  hasModel: boolean,
  i18n: ViewerI18n,
): string | undefined {
  const action = snapshot.actions.find(item => item.id === LOCATION_SELECTION_ACTION_ID);
  if (!action) {
    return i18n.t('locationUnavailable');
  }
  return hostActionDisabledReason(
    action,
    {
      connected: snapshot.connected,
      protocolReady: snapshot.protocolState === 'ready',
      hasModel,
      // The gesture creates the annotation; no pre-existing annotation is required.
      annotationCount: 1,
      pending: hasPendingHostActionRequest(snapshot, LOCATION_SELECTION_ACTION_ID),
    },
    i18n,
  );
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
  const i18n = useViewerI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useViewerPopupEscape(open, () => onOpenChange(false), trigger, popup);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Popover.Trigger
              ref={trigger}
              className="viewer-rail-button viewer-rail-secondary"
              aria-label={i18n.t('shortcutLabel', i18n.t('help'), '?')}
            />
          }
        >
          <CircleHelp className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="left">
          {i18n.t('help')} <kbd>?</kbd>
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
            <Popover.Title className="sr-only">{i18n.t('controls')}</Popover.Title>
            <dl className="viewer-shortcut-list">
              {viewerTools(supportsSelect).map(tool => (
                <ShortcutRow key={tool.mode} label={i18n.t(tool.mode)} value={tool.shortcut} />
              ))}
              <ShortcutRow label={i18n.t('fitModel')} value="F" />
              <ShortcutRow label={i18n.t('help')} value="?" />
              <ShortcutRow label={i18n.t('temporaryOrbit')} value={i18n.t('holdSpace')} />
              <ShortcutRow label={i18n.t('cancelExit')} value="Esc" />
            </dl>
            <dl className="viewer-shortcut-list mt-3 border-t border-border/60 pt-3">
              <ShortcutRow label={i18n.t('pointRegion')} value={i18n.t('clickDrag')} />
              <ShortcutRow label={i18n.t('orbit')} value={i18n.t('leftDrag')} />
              <ShortcutRow label={i18n.t('pan')} value={i18n.t('middleRightDrag')} />
              <ShortcutRow label={i18n.t('zoom')} value={i18n.t('scrollPinch')} />
              <ShortcutRow label={i18n.t('featurePreview')} value={i18n.t('holdAlt')} />
              <ShortcutRow label={i18n.t('saveNewLine')} value={i18n.t('enterShiftEnter')} />
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
      <dd className="min-w-0 text-right text-muted-foreground">{value}</dd>
    </div>
  );
}
