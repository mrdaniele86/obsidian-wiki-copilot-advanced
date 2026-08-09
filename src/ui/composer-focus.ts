export interface ComposerFocusTarget {
  focus(): void;
  blur(): void;
}

export interface MobileViewportGeometry {
  layoutHeight: number;
  viewportHeight: number;
  offsetTop: number;
}

export interface VerticalBounds {
  top: number;
  bottom: number;
}

interface ClosestTarget {
  closest(selector: string): unknown;
}

const INTERACTIVE_CHAT_TARGET =
  "a, button, input, textarea, select, summary, [role='button'], [contenteditable='true']";

const KEYBOARD_OPEN_OCCLUSION = 120;
const KEYBOARD_CLOSED_OCCLUSION = 32;

export function mobileKeyboardOcclusion(geometry: MobileViewportGeometry): number {
  return Math.max(
    0,
    geometry.layoutHeight - geometry.viewportHeight - geometry.offsetTop
  );
}

/**
 * Uses separate open/close thresholds so the composer does not follow every
 * intermediate VisualViewport frame while the iOS keyboard is animating.
 */
export function nextMobileKeyboardVisible(
  currentlyVisible: boolean,
  geometry: MobileViewportGeometry
): boolean {
  const occlusion = mobileKeyboardOcclusion(geometry);
  return currentlyVisible
    ? occlusion > KEYBOARD_CLOSED_OCCLUSION
    : occlusion >= KEYBOARD_OPEN_OCCLUSION;
}

/** Returns the real overlap with Obsidian's floating navbar, plus a small gap. */
export function mobileNavigationClearance(
  view: VerticalBounds,
  navbar: VerticalBounds | null,
  visible = true,
  gap = 8
): number {
  if (!navbar || !visible || navbar.bottom <= view.top || navbar.top >= view.bottom) {
    return 0;
  }
  return Math.max(0, Math.ceil(view.bottom - navbar.top + gap));
}

/** Tapping answer text dismisses the keyboard without stealing taps from controls. */
export function shouldDismissMobileKeyboardFromChat(target: EventTarget | null): boolean {
  const candidate = target as Partial<ClosestTarget> | null;
  if (!candidate || typeof candidate.closest !== "function") {
    return true;
  }
  return candidate.closest(INTERACTIVE_CHAT_TARGET) === null;
}

/**
 * Desktop keeps its keyboard-first workflow. Mobile only dismisses the
 * software keyboard when work starts and never reopens it implicitly.
 */
export function syncComposerFocus(
  target: ComposerFocusTarget,
  busy: boolean,
  isMobile: boolean
): void {
  if (isMobile) {
    if (busy) {
      target.blur();
    }
    return;
  }
  if (!busy) {
    target.focus();
  }
}
