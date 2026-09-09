import type { Annotation, AnnotationKind } from '../types.js';
import { MAX_ANNOTATION_NOTE_LENGTH } from '@manifold3d/protocol/wire/annotations.js';

export interface FlyoutViewModel {
  partLabel: string;
  note: string;
  kind: AnnotationKind;
  expanded: boolean;
  readOnly: boolean;
  number: number;
  intent: Annotation['intent'];
  state: Annotation['state'];
}

export interface FlyoutViewCallbacks {
  onPillClick(): void;
  onInput(value: string): void;
  onCommit(): void;
  onCancel(): void;
  onLayout(): void;
}

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';

/** DOM presentation only; drafts and transaction ownership stay in the controller. */
export class FlyoutView {
  readonly element: HTMLDivElement;
  readonly editorSize = { width: 300, height: 48 };
  private readonly textarea: HTMLTextAreaElement;
  private readonly pill: HTMLButtonElement;
  private readonly previewEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly readOnlyNote: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private readonly save: HTMLButtonElement;
  private readonly observer: ResizeObserver;
  private vm: FlyoutViewModel;

  constructor(
    annId: string,
    vm: FlyoutViewModel,
    private readonly callbacks: FlyoutViewCallbacks,
  ) {
    this.vm = vm;
    const wrap = document.createElement('div');
    wrap.className = 'marks-flyout';
    wrap.dataset.annId = annId;
    wrap.innerHTML = `
      <svg class="marks-leader" aria-hidden="true"><path/></svg>
      <button class="marks-flyout-pill" type="button">
        <span class="marks-flyout-number"></span>
      </button>
      <span class="marks-flyout-preview" role="tooltip"></span>
      <div class="marks-flyout-body" data-viewer-popup role="group" aria-label="Location note">
        <textarea class="marks-flyout-textarea" rows="1" placeholder="Add a note..." aria-label="Annotation note"></textarea>
        <p class="marks-readonly-note"></p>
        <div class="marks-flyout-actions">
          <button class="marks-flyout-cancel marks-flyout-btn" type="button" aria-label="Cancel edit" title="Cancel (Esc)">${CLOSE_ICON}</button>
          <button class="marks-flyout-save marks-flyout-btn" type="button" aria-label="Save note" title="Save (Enter)">${CHECK_ICON}</button>
        </div>
      </div>`;
    this.element = wrap;
    this.textarea = wrap.querySelector('textarea')!;
    this.pill = wrap.querySelector<HTMLButtonElement>('.marks-flyout-pill')!;
    this.previewEl = wrap.querySelector<HTMLElement>('.marks-flyout-preview')!;
    this.body = wrap.querySelector<HTMLElement>('.marks-flyout-body')!;
    this.readOnlyNote = wrap.querySelector<HTMLElement>('.marks-readonly-note')!;
    this.cancel = wrap.querySelector<HTMLButtonElement>('.marks-flyout-cancel')!;
    this.save = wrap.querySelector<HTMLButtonElement>('.marks-flyout-save')!;
    this.textarea.maxLength = MAX_ANNOTATION_NOTE_LENGTH;
    this.textarea.addEventListener('input', () => {
      callbacks.onInput(this.textarea.value);
      this.resizeTextarea();
    });
    this.body.addEventListener('keydown', event => {
      if (event.isComposing) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        callbacks.onCancel();
      } else if (
        event.target === this.textarea &&
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat
      ) {
        event.preventDefault();
        event.stopPropagation();
        callbacks.onCommit();
      }
    });
    this.pill.addEventListener('click', event => {
      event.stopPropagation();
      callbacks.onPillClick();
    });
    this.cancel.addEventListener('click', () => callbacks.onCancel());
    this.save.addEventListener('click', () => callbacks.onCommit());
    this.observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        const widthChanged = this.editorSize.width !== this.body.offsetWidth;
        this.editorSize.width = this.body.offsetWidth;
        this.editorSize.height = this.body.offsetHeight;
        if (widthChanged) {
          this.resizeTextarea();
        }
        callbacks.onLayout();
      }
    });
    this.observer.observe(this.body);
    this.applyVm();
  }

  setView(vm: FlyoutViewModel): void {
    const layoutChanged =
      this.vm.expanded !== vm.expanded || this.vm.note !== vm.note || this.vm.readOnly !== vm.readOnly;
    this.vm = vm;
    this.applyVm();
    if (layoutChanged) {
      this.resizeTextarea();
      this.callbacks.onLayout();
    }
  }

  focusTextarea(): void {
    if (this.vm.readOnly) {
      this.cancel.focus({ preventScroll: true });
    } else {
      this.resizeTextarea();
      this.textarea.focus({ preventScroll: true });
      this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
    }
  }

  textareaHasFocus(): boolean {
    return document.activeElement === this.textarea;
  }

  setTextareaValue(value: string): void {
    this.textarea.value = value;
    this.resizeTextarea();
  }

  dispose(): void {
    this.observer.disconnect();
    this.element.remove();
  }

  private resizeTextarea(): void {
    if (!this.vm.expanded || this.vm.readOnly) {
      return;
    }
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${Math.min(120, Math.max(24, this.textarea.scrollHeight))}px`;
  }

  private applyVm(): void {
    const vm = this.vm;
    this.element.classList.toggle('expanded', vm.expanded);
    this.element.dataset.state = vm.state;
    this.element.dataset.intent = vm.intent;
    this.element.dataset.kind = vm.kind;
    this.pill.querySelector('.marks-flyout-number')!.textContent = String(vm.number);
    this.pill.setAttribute(
      'aria-label',
      `${vm.intent === 'selection' ? 'Location' : 'Note'} ${vm.number}: ${vm.partLabel}`,
    );
    this.pill.setAttribute('aria-expanded', String(vm.expanded));
    this.previewEl.textContent = vm.note.trim() || vm.partLabel;
    this.textarea.readOnly = vm.readOnly;
    this.textarea.hidden = vm.readOnly;
    this.readOnlyNote.hidden = !vm.readOnly;
    this.readOnlyNote.textContent = vm.note || vm.partLabel;
    this.save.hidden = vm.readOnly;
    this.cancel.setAttribute('aria-label', vm.readOnly ? 'Close note' : 'Cancel edit');
    this.cancel.title = vm.readOnly ? 'Close (Esc)' : 'Cancel (Esc)';
    if (!this.textareaHasFocus() && this.textarea.value !== vm.note) {
      this.textarea.value = vm.note;
    }
  }
}
