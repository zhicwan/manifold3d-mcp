import type { ViewerI18n } from '../i18n/index.js';

export interface XrSystemProbe {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  addEventListener?(type: 'devicechange', listener: EventListener): void;
  removeEventListener?(type: 'devicechange', listener: EventListener): void;
}

export interface XrNavigatorProbe {
  xr?: XrSystemProbe;
}

export async function isImmersiveVrSupported(
  nav: XrNavigatorProbe = navigator as Navigator & XrNavigatorProbe,
): Promise<boolean> {
  if (!nav.xr) {
    return false;
  }
  return nav.xr.isSessionSupported('immersive-vr');
}

export interface XrSupportObserver {
  onSupportChange(supported: boolean): void;
  onError(error: unknown): void;
}

export function watchImmersiveVrSupport(
  observer: XrSupportObserver,
  nav: XrNavigatorProbe = navigator as Navigator & XrNavigatorProbe,
): () => void {
  let stopped = false;
  let probeVersion = 0;
  const probe = (): void => {
    const version = ++probeVersion;
    void isImmersiveVrSupported(nav).then(
      supported => {
        if (!stopped && version === probeVersion) {
          observer.onSupportChange(supported);
        }
      },
      error => {
        if (!stopped && version === probeVersion) {
          observer.onError(error);
        }
      },
    );
  };
  const handleDeviceChange: EventListener = () => probe();

  nav.xr?.addEventListener?.('devicechange', handleDeviceChange);
  probe();
  return () => {
    stopped = true;
    nav.xr?.removeEventListener?.('devicechange', handleDeviceChange);
  };
}

export interface XrPresentationError {
  code: 'not-allowed' | 'not-supported' | 'invalid-state' | 'unknown';
  detail?: string;
}

export function describeXrError(error: unknown): XrPresentationError {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return { code: 'not-allowed', ...(detail ? { detail } : {}) };
    }
    if (error.name === 'NotSupportedError') {
      return { code: 'not-supported', ...(detail ? { detail } : {}) };
    }
    if (error.name === 'InvalidStateError') {
      return { code: 'invalid-state', ...(detail ? { detail } : {}) };
    }
  }
  return { code: 'unknown', ...(detail ? { detail } : {}) };
}

export function xrErrorMessage(error: XrPresentationError, i18n: ViewerI18n): string {
  if (error.code === 'unknown') {
    return error.detail ? i18n.t('xrErrorDetail', error.detail) : i18n.t('xrUnableToEnter');
  }
  const guidance = i18n.t(
    error.code === 'not-allowed'
      ? 'xrNotAllowed'
      : error.code === 'not-supported'
        ? 'xrNotSupported'
        : 'xrInvalidState',
  );
  return error.detail ? `${guidance} ${error.detail}` : guidance;
}
