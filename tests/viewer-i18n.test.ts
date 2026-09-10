import { describe, expect, it, vi } from 'vitest';

import { catalogs, createViewerI18n, negotiateLocale } from '../packages/viewer/src/i18n/index.js';
import { enUi } from '../packages/viewer/src/i18n/ui.js';
import { enMarks } from '../packages/viewer/src/i18n/marks.js';
import { enActions } from '../packages/viewer/src/i18n/actions.js';
import { enXr } from '../packages/viewer/src/i18n/xr.js';
import { createViewerStore } from '../packages/viewer/src/store.js';
import { AnnotationStore } from '../packages/viewer/src/marks/annotation-store.js';

describe('Viewer localization', () => {
  it('keeps complete catalogs with matching static and parameterized messages', () => {
    expect(Object.keys(catalogs.en)).toHaveLength(
      [enUi, enMarks, enActions, enXr].reduce((count, messages) => count + Object.keys(messages).length, 0),
    );
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs['zh-CN']).sort());
    for (const key of Object.keys(catalogs.en) as Array<keyof typeof catalogs.en>) {
      expect(typeof catalogs['zh-CN'][key], key).toBe(typeof catalogs.en[key]);
      if (typeof catalogs.en[key] === 'string') {
        expect(catalogs.en[key], key).not.toBe('');
        expect(catalogs['zh-CN'][key], key).not.toBe('');
      }
    }
  });

  it.each([
    [[], 'en'],
    [['en-US'], 'en'],
    [['en-GB', 'zh-CN'], 'en'],
    [['fr-FR', 'zh-CN', 'en'], 'zh-CN'],
    [['zh'], 'zh-CN'],
    [['zh-Hans'], 'zh-CN'],
    [['zh-SG'], 'zh-CN'],
    [['zh-Hans-HK'], 'zh-CN'],
    [['zh-Hant-CN'], 'en'],
    [['zh-TW'], 'en'],
    [['zh-HK'], 'en'],
    [['zh-MO'], 'en'],
    [['zh-Hant', 'zh-Hans'], 'zh-CN'],
    [['not_a_locale', 'ZH-cn'], 'zh-CN'],
    [['de'], 'en'],
  ] as const)('negotiates %j as %s', (languages, expected) => {
    expect(negotiateLocale(languages)).toBe(expected);
  });

  it('supports manual override and returning to the latest automatic locale', () => {
    const i18n = createViewerI18n('auto', ['zh-CN']);
    const listener = vi.fn();
    const unsubscribe = i18n.subscribe(listener);
    expect(i18n.getLocale()).toBe('zh-CN');
    i18n.setPreference('en');
    expect(i18n.t('export')).toBe('Export');
    i18n.refreshBrowserLanguages(['zh-SG']);
    expect(i18n.getLocale()).toBe('en');
    expect(listener).toHaveBeenCalledTimes(1);
    i18n.setPreference('auto');
    expect(i18n.t('export')).toBe('导出');
    i18n.refreshBrowserLanguages(['en-US']);
    expect(i18n.t('export')).toBe('Export');
    i18n.setPreference('auto');
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    i18n.setPreference('zh-CN');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('never requires browser storage for an embedded Viewer', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const access = vi.fn(() => {
      throw new Error('Storage access denied');
    });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: access });
    try {
      const i18n = createViewerI18n('auto', ['en']);
      i18n.setPreference('zh-CN');
      expect(i18n.getLocale()).toBe('zh-CN');
      expect(access).not.toHaveBeenCalled();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'sessionStorage', original);
      } else {
        Reflect.deleteProperty(globalThis, 'sessionStorage');
      }
    }
  });

  it('formats typed complete sentences and display numbers without altering diagnostics', () => {
    const i18n = createViewerI18n('en');
    expect(i18n.t('shortcutLabel', 'Orbit', 'V')).toBe('Orbit (V)');
    expect(i18n.number(1234567.8, { minimumFractionDigits: 2 })).toBe('1,234,567.80');
    expect(i18n.number(Infinity)).toBe('-');
    i18n.setPreference('zh-CN');
    expect(i18n.t('shortcutLabel', '旋转视图', 'V')).toBe('旋转视图（V）');
    expect(i18n.t('stlExportFailed', 'EIO: /用户/model.stl')).toBe('STL 导出失败：EIO: /用户/model.stl');
    expect(i18n.number(12345)).toBe(new Intl.NumberFormat('zh-CN').format(12345));
  });

  it('formats complete count phrases with English plurals and Chinese classifiers', () => {
    const i18n = createViewerI18n('en');
    expect(i18n.t('actionNotes', 1)).toBe('1 note');
    expect(i18n.t('actionNotes', 2)).toBe('2 notes');
    expect(i18n.t('actionAnnotations', 1)).toBe('1 annotation');
    expect(i18n.t('actionAnnotations', 0)).toBe('0 annotations');
    i18n.setPreference('zh-CN');
    expect(i18n.t('actionNotes', 1)).toBe('1 条批注');
    expect(i18n.t('actionNotes', 2000)).toBe('2,000 条批注');
  });

  it('isolates locale subscriptions and preserves canonical state and unsaved notes', () => {
    const first = createViewerStore();
    const second = createViewerStore();
    second.i18n.setPreference('en');
    const annotations = new AnnotationStore();
    const draft = annotations.addComment({
      kind: 'point',
      anchorWorld: [0, 0, 0],
      worldCoord: [0, 0, 0],
      triIds: [],
      note: 'Unsent 26mm 草稿',
    });
    const runtime = { store: annotations, commitOpenDraft: vi.fn(), flushAnnotations: () => true };
    first.setMarksRuntime(runtime);
    first.setModelVersion('unchanged-version');
    first.setMarkMode('annotate');
    first.setViewerError({ key: 'annotationSyncFailed', detail: 'raw diagnostic' });
    const before = first.getState();
    const stateListener = vi.fn();
    const otherLocaleListener = vi.fn();
    first.subscribe(stateListener);
    second.i18n.subscribe(otherLocaleListener);
    first.i18n.setPreference('zh-CN');
    expect(first.getState()).toBe(before);
    expect(first.getState().marksRuntime).toBe(runtime);
    expect(annotations.get(draft.id)).toBe(draft);
    expect(draft.note).toBe('Unsent 26mm 草稿');
    expect(first.getState().viewerError).toEqual({ key: 'annotationSyncFailed', detail: 'raw diagnostic' });
    expect(second.i18n.getLocale()).toBe('en');
    expect(stateListener).not.toHaveBeenCalled();
    expect(otherLocaleListener).not.toHaveBeenCalled();
  });
});

// These calls are checked by the existing test typecheck, never executed.
function translationTypeContract() {
  const i18n = createViewerI18n('en');
  // @ts-expect-error unknown catalog key
  i18n.t('missingMessage');
  // @ts-expect-error static messages take no interpolation arguments
  i18n.t('export', 1);
  // @ts-expect-error the complete sentence requires a string diagnostic
  i18n.t('stlExportFailed', 7);
  // @ts-expect-error missing interpolation argument
  i18n.t('stlExportFailed');
}
void translationTypeContract;
