import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlyoutView, type FlyoutViewModel } from '../../packages/viewer/src/marks/flyout/flyout-view.js';
import { createViewerI18n } from '../../packages/viewer/src/i18n/index.js';

class Element {
  innerHTML = '';
  value = '';
  hidden = false;
  readOnly = false;
  textContent = '';
  title = '';
  placeholder = '';
  maxLength = 0;
  scrollHeight = 24;
  offsetWidth = 300;
  offsetHeight = 48;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, value: boolean) => (value ? this.classes.add(name) : this.classes.delete(name)),
  };
  readonly children = new Map<string, Element>();
  readonly events = new Map<string, (event: Record<string, unknown>) => void>();
  readonly remove = vi.fn();
  readonly setSelectionRange = vi.fn();
  querySelector(selector: string): Element {
    let child = this.children.get(selector);
    if (!child) {
      child = new Element();
      this.children.set(selector, child);
    }
    return child;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(name: string, callback: (event: Record<string, unknown>) => void): void {
    this.events.set(name, callback);
  }
  focus(): void {
    Object.assign(document, { activeElement: this });
  }
}

const draft: FlyoutViewModel = {
  partLabel: 'front face',
  note: '',
  kind: 'point',
  expanded: true,
  readOnly: false,
  number: 1,
  intent: 'comment',
  state: 'draft',
};

describe('Compact annotation editor', () => {
  const disconnect = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('document', { activeElement: null, createElement: () => new Element() });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(model = draft, i18n = createViewerI18n('en')) {
    const callbacks = {
      onPillClick: vi.fn(),
      onInput: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
      onLayout: vi.fn(),
    };
    const view = new FlyoutView('id-1', model, callbacks, i18n);
    const root = view.element as unknown as Element;
    return {
      view,
      root,
      callbacks,
      textarea: root.querySelector('textarea'),
      body: root.querySelector('.marks-flyout-body'),
    };
  }

  it('starts with one line and accessible icon controls, with no permanent keyboard prose', () => {
    const { view, root, textarea } = setup();
    expect(root.innerHTML).toContain('rows="1"');
    expect(root.querySelector('.marks-flyout-save').attributes.get('aria-label')).toBe('Save note');
    expect(root.querySelector('.marks-flyout-cancel').attributes.get('aria-label')).toBe('Cancel edit');
    expect(root.innerHTML).not.toContain('Enter to save');
    expect(root.innerHTML).not.toContain('Shift+Enter');
    expect(root.innerHTML).not.toContain('microphone');
    expect(textarea.maxLength).toBeGreaterThan(0);
    view.focusTextarea();
    expect(textarea.style.height).toBe('24px');
    expect(document.activeElement).toBe(textarea);
    view.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('grows for long notes but bounds height, and updates the same draft', () => {
    const { view, textarea, callbacks } = setup();
    textarea.value = '这里需要调整\n另一行说明';
    textarea.scrollHeight = 400;
    textarea.events.get('input')!({});
    expect(callbacks.onInput).toHaveBeenCalledWith(textarea.value);
    expect(textarea.style.height).toBe('120px');
    view.dispose();
  });

  it('saves on Enter, not Shift+Enter, IME confirmation, key-repeat or host chords', () => {
    const { view, body, textarea, callbacks } = setup();
    for (const extra of [
      { shiftKey: true },
      { isComposing: true },
      { repeat: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      body.events.get('keydown')!({ target: textarea, key: 'Enter', ...extra });
    }
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    const event = { target: textarea, key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    body.events.get('keydown')!(event);
    expect(callbacks.onCommit).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    view.dispose();
  });

  it('cancels the editor with Escape without propagating tool dismissal', () => {
    const { view, body, callbacks } = setup();
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    body.events.get('keydown')!(event);
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    view.dispose();
  });

  it('keeps committed content inspectable but never editable', () => {
    const { view, root, textarea } = setup();
    view.setView({ ...draft, state: 'committed', readOnly: true, note: 'Keep this opening' });
    expect(textarea.hidden).toBe(true);
    expect(root.querySelector('.marks-readonly-note').textContent).toBe('Keep this opening');
    expect(root.querySelector('.marks-flyout-save').hidden).toBe(true);
    expect(root.querySelector('.marks-flyout-cancel').attributes.get('aria-label')).toBe('Close note');
    view.focusTextarea();
    expect(document.activeElement).toBe(root.querySelector('.marks-flyout-cancel'));
    view.dispose();
  });

  it('updates live editor labels without replacing the textarea or changing unsaved edits and focus', () => {
    const i18n = createViewerI18n('en');
    const { view, root, textarea, body, callbacks } = setup(draft, i18n);
    view.focusTextarea();
    textarea.value = '未保存的更改 🌏';
    textarea.setSelectionRange(2, 4);
    const selectionCalls = textarea.setSelectionRange.mock.calls.length;
    i18n.setPreference('zh-CN');
    expect(root.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('未保存的更改 🌏');
    expect(document.activeElement).toBe(textarea);
    expect(textarea.setSelectionRange).toHaveBeenCalledTimes(selectionCalls);
    expect(textarea.placeholder).toBe('添加批注…');
    expect(textarea.attributes.get('aria-label')).toBe('批注内容');
    expect(body.attributes.get('aria-label')).toBe('位置说明');
    expect(root.querySelector('.marks-flyout-save').attributes.get('aria-label')).toBe('保存批注');
    expect(root.querySelector('.marks-flyout-save').title).toBe('保存 (Enter)');
    expect(root.querySelector('.marks-flyout-cancel').title).toBe('取消 (Esc)');
    expect(root.querySelector('.marks-flyout-pill').attributes.get('aria-label')).toBe('批注 1：front face');
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(callbacks.onInput).not.toHaveBeenCalled();
    expect(callbacks.onLayout).toHaveBeenCalledOnce();
    // A language selection normally moves focus out of the editor first.
    Object.assign(document, { activeElement: null });
    i18n.setPreference('en');
    expect(textarea.value).toBe('未保存的更改 🌏');
    expect(textarea.placeholder).toBe('Add a note...');
    view.dispose();
  });

  it('localizes pending and committed note controls without translating content or canonical labels', () => {
    const i18n = createViewerI18n('zh-CN');
    const { view, root, textarea } = setup(
      { ...draft, readOnly: true, state: 'pending', note: 'Keep 中文 <b>raw</b>', partLabel: 'point#12' },
      i18n,
    );
    expect(textarea.hidden).toBe(true);
    expect(root.querySelector('.marks-readonly-note').textContent).toBe('Keep 中文 <b>raw</b>');
    expect(root.querySelector('.marks-flyout-preview').textContent).toBe('Keep 中文 <b>raw</b>');
    expect(root.querySelector('.marks-flyout-pill').attributes.get('aria-label')).toBe('批注 1：point#12');
    expect(root.querySelector('.marks-flyout-cancel').attributes.get('aria-label')).toBe('关闭批注');
    expect(root.querySelector('.marks-flyout-cancel').title).toBe('关闭 (Esc)');
    view.setView({ ...draft, readOnly: true, state: 'committed', intent: 'selection', partLabel: 'Front plate' });
    expect(root.querySelector('.marks-flyout-pill').attributes.get('aria-label')).toBe('位置 1：Front plate');
    expect(root.querySelector('.marks-readonly-note').textContent).toBe('Front plate');
    i18n.setPreference('en');
    expect(root.querySelector('.marks-flyout-cancel').attributes.get('aria-label')).toBe('Close note');
    expect(root.querySelector('.marks-flyout-pill').attributes.get('aria-label')).toBe('Location 1: Front plate');
    view.dispose();
  });

  it('isolates viewers and unsubscribes the disposed view', () => {
    const firstLocale = createViewerI18n('en');
    const secondLocale = createViewerI18n('en');
    const first = setup(draft, firstLocale);
    const second = setup(draft, secondLocale);
    firstLocale.setPreference('zh-CN');
    expect(first.textarea.placeholder).toBe('添加批注…');
    expect(second.textarea.placeholder).toBe('Add a note...');
    first.view.dispose();
    first.callbacks.onLayout.mockClear();
    firstLocale.setPreference('en');
    expect(first.textarea.placeholder).toBe('添加批注…');
    expect(first.callbacks.onLayout).not.toHaveBeenCalled();
    second.view.dispose();
  });
});
