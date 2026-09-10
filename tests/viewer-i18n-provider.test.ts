import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  effect: null as (() => void | (() => void)) | null,
}));

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof React>()),
  useRef: () => ({ current: null }),
  useEffect: (effect: () => void | (() => void)) => {
    harness.effect = effect;
  },
}));

import { ViewerStoreProvider } from '../packages/viewer/src/store.js';

afterEach(() => vi.unstubAllGlobals());

describe('Viewer language listener ownership', () => {
  it('follows browser changes only in auto mode and releases its own listener', () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal('navigator', { languages: ['en-US'] });
    vi.stubGlobal('window', {
      addEventListener: (name: string, callback: () => void) => {
        expect(name).toBe('languagechange');
        listeners.add(callback);
      },
      removeEventListener: (name: string, callback: () => void) => {
        expect(name).toBe('languagechange');
        listeners.delete(callback);
      },
    });
    const first = ViewerStoreProvider({ children: null });
    const firstStore = first.props.value!;
    const cleanupFirst = harness.effect!();
    const second = ViewerStoreProvider({ children: null });
    const secondStore = second.props.value!;
    const cleanupSecond = harness.effect!();
    expect(listeners.size).toBe(2);
    firstStore.i18n.setPreference('en');
    vi.stubGlobal('navigator', { languages: ['zh-Hans'] });
    for (const listener of listeners) {
      listener();
    }
    expect(firstStore.i18n.getLocale()).toBe('en');
    expect(secondStore.i18n.getLocale()).toBe('zh-CN');
    firstStore.i18n.setPreference('auto');
    expect(firstStore.i18n.getLocale()).toBe('zh-CN');
    if (cleanupFirst) {
      cleanupFirst();
    }
    expect(listeners.size).toBe(1);
    vi.stubGlobal('navigator', { languages: ['en-GB'] });
    for (const listener of listeners) {
      listener();
    }
    expect(firstStore.i18n.getLocale()).toBe('zh-CN');
    expect(secondStore.i18n.getLocale()).toBe('en');
    if (cleanupSecond) {
      cleanupSecond();
    }
    expect(listeners.size).toBe(0);
  });
});
