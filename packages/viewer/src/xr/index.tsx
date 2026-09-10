import { useEffect, useSyncExternalStore } from 'react';
import { Glasses } from 'lucide-react';

import { glass } from '@/components/glass';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerRuntime } from '@/viewer-runtime';
import { useViewerI18n } from '@/store';

import { createXrExperienceScope, useXrExperienceState, type XrExperience } from './experience.js';
import { acquireXrRendererOwnership } from './renderer-ownership.js';
import type { XrEnterBinding } from './state.js';
import { xrErrorMessage } from './support.js';
import { XrRuntime } from './xr-runtime.js';

export type { XrExperience } from './experience.js';

/**
 * Creates one immersive contribution scope. Each call owns independent state;
 * wrap the matching ViewerApp with Provider and pass its explicit slots.
 */
export function createXrExperience(): XrExperience {
  return createXrExperienceScope({
    toolbarEnd: <XrToolbar />,
    sceneLayers: <XrSceneLayer />,
    overlays: <XrOverlay />,
  });
}

function XrSceneLayer() {
  const viewerRuntime = useViewerRuntime();
  const state = useXrExperienceState();

  useEffect(() => {
    if (!viewerRuntime) {
      return;
    }

    const scene = viewerRuntime.scene;
    const acquisition = acquireXrRendererOwnership(scene.renderer);
    let cancelled = false;
    let runtime: XrRuntime | null = null;
    let removeModelHook: (() => void) | null = null;
    let enterBinding: XrEnterBinding | null = null;
    let startup = Promise.resolve();
    const disposeRuntime = viewerRuntime.registerSceneCleanup(async () => {
      cancelled = true;
      acquisition.cancel();
      enterBinding?.unbind();
      enterBinding = null;
      removeModelHook?.();
      removeModelHook = null;
      await startup;
      try {
        await runtime?.dispose();
      } finally {
        viewerRuntime.setMarksImmersivePresenting(false);
      }
    });
    startup = acquisition.acquired.then(async ownership => {
      if (!ownership) {
        return;
      }
      if (cancelled) {
        ownership.release();
        return;
      }
      try {
        const nextRuntime = new XrRuntime({
          runtime: scene,
          ownership,
          onSupportChange: supported => {
            if (!cancelled) {
              state.setSupport(supported);
            }
          },
          onSupportError: error => {
            if (!cancelled) {
              state.setSupportError(error);
            }
          },
          onRuntimeError: error => {
            console.error('XR runtime lifecycle error.', error);
            if (!cancelled) {
              state.setSupportError(error);
            }
          },
          onSessionStateChange: active => {
            viewerRuntime.setMarksImmersivePresenting(active);
            if (!cancelled) {
              enterBinding?.setSessionState(active ? 'active' : 'idle');
            }
          },
        });
        runtime = nextRuntime;
        state.setHasModel(scene.getMesh() !== null);
        removeModelHook = scene.addModelChangeHook(() => state.setHasModel(true));
        enterBinding = state.bindEnterHandler(async () => {
          // End any desktop gesture before the immersive runtime snapshots controls.
          viewerRuntime.setMarksImmersivePresenting(true);
          try {
            await nextRuntime.enter();
          } catch (error) {
            viewerRuntime.setMarksImmersivePresenting(false);
            throw error;
          }
        });
      } catch (error) {
        const failures: unknown[] = [error];
        if (runtime) {
          try {
            await runtime.dispose();
          } catch (cleanupError) {
            failures.push(cleanupError);
          }
          runtime = null;
        } else {
          ownership.release();
        }
        const failure =
          failures.length === 1 ? failures[0] : new AggregateError(failures, 'XR startup and cleanup both failed.');
        console.error('Failed to initialize the XR Viewer contribution.', failure);
        if (!cancelled) {
          state.setSupportError(failure);
        }
      }
    });

    return () => {
      void disposeRuntime().catch(error => {
        console.error('Failed to dispose the immersive Viewer contribution cleanly.', error);
      });
    };
  }, [state, viewerRuntime]);

  return null;
}

function XrToolbar() {
  const i18n = useViewerI18n();
  const state = useXrExperienceState();
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  if (snapshot.support !== 'supported') {
    return null;
  }

  return (
    <>
      <div className="h-5 w-px bg-border/70" aria-hidden="true" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-8 rounded-xl', snapshot.sessionState === 'active' && 'bg-muted text-foreground')}
              aria-label={
                snapshot.sessionState === 'active'
                  ? i18n.t('xrActive')
                  : snapshot.sessionState === 'starting'
                    ? i18n.t('xrStarting')
                    : i18n.t('xrEnter')
              }
              aria-busy={snapshot.sessionState === 'starting'}
              disabled={!snapshot.runtimeReady || !snapshot.hasModel || snapshot.sessionState !== 'idle'}
              onClick={() => {
                void state.enter().catch(() => undefined);
              }}
            />
          }
        >
          <Glasses className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {i18n.t(
            snapshot.sessionState === 'active'
              ? 'xrActive'
              : snapshot.sessionState === 'starting'
                ? 'xrStarting'
                : 'xrEnter',
          )}
        </TooltipContent>
      </Tooltip>
    </>
  );
}

function XrOverlay() {
  const i18n = useViewerI18n();
  const state = useXrExperienceState();
  const error = useSyncExternalStore(
    state.subscribe,
    () => state.getSnapshot().error,
    () => state.getSnapshot().error,
  );
  if (!error) {
    return null;
  }
  return (
    <p
      role="alert"
      className={cn(glass, 'pointer-events-auto fixed right-4 top-20 z-40 w-72 px-3 py-2 text-xs text-destructive')}
    >
      {xrErrorMessage(error, i18n)}
    </p>
  );
}
