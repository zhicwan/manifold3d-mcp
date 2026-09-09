import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlyoutView, type FlyoutViewModel } from '../../packages/viewer/src/marks/flyout/flyout-view.js';

class Element {
  innerHTML = '';
  value = '';
  hidden = false;
  readOnly = false;
  textContent = '';
  title = '';
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

  function setup(model = draft) {
    const callbacks = {
      onPillClick: vi.fn(),
      onInput: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
      onLayout: vi.fn(),
    };
    const view = new FlyoutView('id-1', model, callbacks);
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
    expect(root.innerHTML).toContain('aria-label="Save note"');
    expect(root.innerHTML).toContain('aria-label="Cancel edit"');
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
});
