export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null)
  );
}

export function isViewerShortcutEvent(event: KeyboardEvent, root: HTMLElement | null): boolean {
  if (
    !root ||
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isTextEntryTarget(event.target)
  ) {
    return false;
  }
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    root.contains(active) &&
    !isTextEntryTarget(active) &&
    active.closest('[role="menu"], [role="listbox"], [role="dialog"], [data-viewer-popup]') === null
  );
}
