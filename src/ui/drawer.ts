const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface Drawer {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

/**
 * A modal side panel: the page behind goes inert while it is open, Esc and the
 * backdrop close it, and focus returns to the button that opened it.
 */
export function createDrawer(panel: HTMLElement, backdrop: HTMLElement, opener: HTMLElement, page: HTMLElement): Drawer {
  let open = false;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  function openDrawer() {
    if (open) return;
    open = true;
    panel.hidden = false;
    backdrop.hidden = false;
    page.inert = true;
    opener.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
    // Next frame so the slide-in transition runs from the hidden position
    requestAnimationFrame(() => {
      if (!open) return; // closed again before the frame (e.g. Play pressed at once)
      panel.classList.add('is-open');
      backdrop.classList.add('is-open');
    });
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    panel.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    panel.hidden = true;
    backdrop.hidden = true;
    page.inert = false;
    opener.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    opener.focus();
  }

  backdrop.addEventListener('click', close);
  return { open: openDrawer, close, isOpen: () => open };
}
