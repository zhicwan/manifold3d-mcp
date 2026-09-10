import {
  Bot,
  Check,
  CircleAlert,
  Download,
  LoaderCircle,
  MessageSquare,
  Play,
  Sparkles,
  WandSparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import { glass } from '@/components/glass';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getLatestHostActionStatus,
  hasPendingHostActionRequest,
  hostActionDisabledReason,
  hostActionLabel,
  hostActionStatusMessage,
  type HostActionsSnapshot,
} from '@/host-actions/client';
import { cn } from '@/lib/utils';
import { useAnnotations, useViewerI18n, useViewerState } from '@/store';
import type { HostActionDescriptor, HostActionIcon, HostActionTone } from '@manifold3d/protocol/wire/host-actions.js';

const EMPTY_HOST_ACTIONS: HostActionsSnapshot = {
  actions: [],
  statuses: {},
  requestOrder: [],
  latestStatus: null,
  clientId: null,
  connected: false,
  protocolState: 'awaiting-manifest',
};

const ICONS: Record<HostActionIcon, LucideIcon> = {
  bot: Bot,
  check: Check,
  download: Download,
  message: MessageSquare,
  play: Play,
  sparkles: Sparkles,
  wand: WandSparkles,
};

export function ToolbarHostActions() {
  const view = useHostActionsView();
  const actions = view.snapshot.actions.filter(action => action.slot === 'toolbar');
  if (actions.length === 0) {
    return null;
  }
  return (
    <>
      {actions.map(action => {
        const status = getLatestHostActionStatus(view.snapshot, action.id);
        const pending = view.pending(action);
        const disabledReason = view.disabledReason(action);
        const Icon = status?.state === 'failed' ? CircleAlert : ICONS[action.icon];
        return (
          <Tooltip key={action.id}>
            <TooltipTrigger
              render={
                <Button
                  variant={buttonVariant(action.tone)}
                  size="sm"
                  className="viewer-host-action viewer-top-button rounded-xl px-3"
                  disabled={disabledReason !== undefined}
                  aria-label={hostActionLabel(action, view.i18n)}
                  aria-busy={pending}
                  onClick={() => view.invoke(action)}
                />
              }
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Icon className={cn('size-4', status?.state === 'failed' && 'text-destructive')} aria-hidden="true" />
              )}
              <span className="viewer-host-action-label">{hostActionLabel(action, view.i18n)}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {disabledReason ??
                (status ? hostActionStatusMessage(status, view.i18n) : hostActionLabel(action, view.i18n))}
            </TooltipContent>
          </Tooltip>
        );
      })}
      <div className="h-5 w-px bg-border/70" aria-hidden="true" />
    </>
  );
}

export function ExportMenuHostActions() {
  const view = useHostActionsView();
  const actions = view.snapshot.actions.filter(action => action.slot === 'export-menu');
  if (actions.length === 0) {
    return null;
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{view.i18n.t('actionHost')}</DropdownMenuLabel>
      {actions.map(action => {
        const status = getLatestHostActionStatus(view.snapshot, action.id);
        const pending = view.pending(action);
        const disabledReason = view.disabledReason(action);
        const Icon = pending ? LoaderCircle : ICONS[action.icon];
        return (
          <DropdownMenuItem
            key={action.id}
            disabled={disabledReason !== undefined}
            title={disabledReason}
            onClick={() => view.invoke(action)}
          >
            <Icon className={cn(pending && 'animate-spin')} aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{hostActionLabel(action, view.i18n)}</span>
              {(disabledReason || status) && (
                <span
                  className={cn(
                    'break-words text-xs text-muted-foreground',
                    status?.state === 'failed' && 'text-destructive',
                  )}
                >
                  {disabledReason ?? (status ? hostActionStatusMessage(status, view.i18n) : undefined)}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

export function HostActionStatusRegion() {
  const { snapshot, i18n } = useHostActionsView();
  const protocolError = useViewerState(state => state.protocolError);
  const viewerError = useViewerState(state => state.viewerError);
  const [dismissed, setDismissed] = useState<object | null>(null);
  const status = snapshot.latestStatus;
  const error = protocolError
    ? i18n.t('actionProtocolError', protocolError)
    : viewerError
      ? i18n.t(viewerError.key, viewerError.detail)
      : null;
  if (!error && (!status || dismissed === status)) {
    return null;
  }
  const action = snapshot.actions.find(item => item.id === status?.actionId);
  const label = action ? hostActionLabel(action, i18n) : i18n.t('actionFallback');
  const message = status ? hostActionStatusMessage(status, i18n) : '';
  const failed = Boolean(error) || status?.state === 'failed';
  return (
    <div
      data-viewer-obstacle
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
      className={cn(
        glass,
        'viewer-action-status flex items-start gap-2 px-3 py-2 text-xs',
        failed && 'text-destructive',
      )}
    >
      <div className="min-w-0 flex-1 select-text break-words leading-relaxed">
        {error && <p>{error}</p>}
        {status && dismissed !== status && (
          <p>
            <span className="font-medium">{label}:</span> {message}
          </p>
        )}
      </div>
      {!error && status?.state === 'succeeded' && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-xl"
          aria-label={i18n.t('actionDismiss')}
          onClick={() => setDismissed(status)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function useHostActionsSnapshot(): HostActionsSnapshot {
  const client = useViewerState(state => state.hostActionsClient);
  return useSyncExternalStore(
    client?.subscribe ?? subscribeNoop,
    client?.getSnapshot ?? getEmptySnapshot,
    getEmptySnapshot,
  );
}

function useHostActionsView() {
  const i18n = useViewerI18n();
  const client = useViewerState(state => state.hostActionsClient);
  const payload = useViewerState(state => state.payload);
  const marksRuntime = useViewerState(state => state.marksRuntime);
  const annotations = useAnnotations(marksRuntime?.store ?? null);
  const snapshot = useHostActionsSnapshot();

  return {
    snapshot,
    i18n,
    invoke(action: HostActionDescriptor): void {
      client?.invoke(action.id);
    },
    pending(action: HostActionDescriptor): boolean {
      return hasPendingHostActionRequest(snapshot, action.id);
    },
    disabledReason(action: HostActionDescriptor): string | undefined {
      return hostActionDisabledReason(
        action,
        {
          connected: snapshot.connected,
          protocolReady: snapshot.protocolState === 'ready',
          hasModel: payload !== null,
          annotationCount: annotations.length,
          pending: hasPendingHostActionRequest(snapshot, action.id),
        },
        i18n,
      );
    },
  };
}

function buttonVariant(tone: HostActionTone): 'ghost' | 'default' | 'destructive' {
  if (tone === 'primary') {
    return 'default';
  }
  if (tone === 'danger') {
    return 'destructive';
  }
  return 'ghost';
}

function subscribeNoop(): () => void {
  return () => undefined;
}

function getEmptySnapshot(): HostActionsSnapshot {
  return EMPTY_HOST_ACTIONS;
}
