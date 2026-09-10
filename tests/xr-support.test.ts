import { describe, expect, it, vi } from 'vitest';

import {
  isImmersiveVrSupported,
  watchImmersiveVrSupport,
  describeXrError,
  xrErrorMessage,
} from '../packages/viewer/src/xr/support.js';
import { createViewerI18n } from '../packages/viewer/src/i18n/index.js';
import { createXrExperienceState } from '../packages/viewer/src/xr/state.js';

describe('WebXR support detection', () => {
  it('returns false when navigator has no XR system', async () => {
    await expect(isImmersiveVrSupported({})).resolves.toBe(false);
  });

  it('probes immersive-vr support', async () => {
    let requestedMode: XRSessionMode | null = null;
    const supported = await isImmersiveVrSupported({
      xr: {
        isSessionSupported(mode) {
          requestedMode = mode;
          return Promise.resolve(true);
        },
      },
    });

    expect(supported).toBe(true);
    expect(requestedMode).toBe('immersive-vr');
  });

  it('propagates probe failures for the UI to surface', async () => {
    const error = new DOMException('blocked', 'SecurityError');
    await expect(
      isImmersiveVrSupported({
        xr: {
          isSessionSupported() {
            return Promise.reject(error);
          },
        },
      }),
    ).rejects.toBe(error);
  });

  it('rechecks support when XR devices change and removes the listener on cleanup', async () => {
    let supported = false;
    const deviceChangeListeners = new Set<EventListener>();
    const results: boolean[] = [];
    const errors: unknown[] = [];
    const stop = watchImmersiveVrSupport(
      {
        onSupportChange(value) {
          results.push(value);
        },
        onError(error) {
          errors.push(error);
        },
      },
      {
        xr: {
          isSessionSupported() {
            return Promise.resolve(supported);
          },
          addEventListener(_type, listener) {
            deviceChangeListeners.add(listener);
          },
          removeEventListener(_type, listener) {
            deviceChangeListeners.delete(listener);
          },
        },
      },
    );

    await vi.waitFor(() => expect(results).toEqual([false]));
    supported = true;
    for (const listener of deviceChangeListeners) {
      listener(new Event('devicechange'));
    }
    await vi.waitFor(() => expect(results).toEqual([false, true]));

    stop();
    expect(deviceChangeListeners.size).toBe(0);
    expect(errors).toEqual([]);
  });
});

describe('WebXR error messages', () => {
  it('explains denied session requests', () => {
    expect(
      xrErrorMessage(describeXrError(new DOMException('denied', 'NotAllowedError')), createViewerI18n('en')),
    ).toMatch(/not allowed/i);
  });

  it('keeps useful implementation errors', () => {
    expect(xrErrorMessage(describeXrError(new Error('runtime unavailable')), createViewerI18n('en'))).toBe(
      'Unable to enter VR: runtime unavailable',
    );
  });

  it('renders existing rejected session state in the current locale without replacing diagnostics', async () => {
    const i18n = createViewerI18n('en');
    const state = createXrExperienceState();
    const failure = new DOMException('raw permission detail', 'NotAllowedError');
    state.bindEnterHandler(() => Promise.reject(failure));
    state.setHasModel(true);
    await expect(state.enter()).rejects.toBe(failure);
    const snapshot = state.getSnapshot();
    expect(snapshot.error).toEqual({ code: 'not-allowed', detail: 'raw permission detail' });
    expect(xrErrorMessage(snapshot.error!, i18n)).toContain('VR access was not allowed');
    i18n.setPreference('zh-CN');
    expect(state.getSnapshot()).toBe(snapshot);
    expect(xrErrorMessage(snapshot.error!, i18n)).toBe(
      '未获准访问 VR。请检查浏览器和头显的权限提示。 raw permission detail',
    );
    i18n.setPreference('en');
    expect(xrErrorMessage(snapshot.error!, i18n)).toContain('VR access was not allowed');
  });

  it.each([
    ['NotSupportedError', '此浏览器或连接的头显无法启动沉浸式 VR 会话。'],
    ['InvalidStateError', 'VR 会话已在运行或尚未关闭。'],
  ])('localizes %s support errors', (name, message) => {
    const state = createXrExperienceState();
    state.setSupportError(new DOMException('diagnostic', name));
    expect(state.getSnapshot().support).toBe('unsupported');
    expect(xrErrorMessage(state.getSnapshot().error!, createViewerI18n('zh-CN'))).toBe(`${message} diagnostic`);
  });
});
