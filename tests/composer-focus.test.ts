import { describe, expect, it, vi } from "vitest";
import {
  mobileKeyboardOcclusion,
  mobileNavigationClearance,
  nextMobileKeyboardVisible,
  shouldDismissMobileKeyboardFromChat,
  syncComposerFocus
} from "../src/ui/composer-focus";

function focusTarget() {
  return {
    focus: vi.fn(),
    blur: vi.fn()
  };
}

describe("composer focus lifecycle", () => {
  it("reserves the actual floating navbar overlap instead of assuming a CSS variable", () => {
    expect(mobileNavigationClearance(
      { top: 100, bottom: 844 },
      { top: 756, bottom: 820 }
    )).toBe(96);
    expect(mobileNavigationClearance(
      { top: 100, bottom: 700 },
      { top: 756, bottom: 820 }
    )).toBe(0);
    expect(mobileNavigationClearance(
      { top: 100, bottom: 844 },
      { top: 756, bottom: 820 },
      false
    )).toBe(0);
  });

  it("keeps keyboard layout active until the visual viewport is almost restored", () => {
    expect(mobileKeyboardOcclusion({
      layoutHeight: 844,
      viewportHeight: 500,
      offsetTop: 0
    })).toBe(344);
    expect(nextMobileKeyboardVisible(false, {
      layoutHeight: 844,
      viewportHeight: 700,
      offsetTop: 0
    })).toBe(true);
    expect(nextMobileKeyboardVisible(true, {
      layoutHeight: 844,
      viewportHeight: 800,
      offsetTop: 0
    })).toBe(true);
    expect(nextMobileKeyboardVisible(true, {
      layoutHeight: 844,
      viewportHeight: 814,
      offsetTop: 0
    })).toBe(false);
  });

  it("includes a shifted visual viewport when measuring keyboard occlusion", () => {
    expect(mobileKeyboardOcclusion({
      layoutHeight: 844,
      viewportHeight: 500,
      offsetTop: 44
    })).toBe(300);
    expect(nextMobileKeyboardVisible(false, {
      layoutHeight: 844,
      viewportHeight: 800,
      offsetTop: 20
    })).toBe(false);
  });

  it("dismisses the keyboard for answer text but preserves interactive taps", () => {
    const answerText = { closest: vi.fn(() => null) } as unknown as EventTarget;
    const sourceButton = { closest: vi.fn(() => ({})) } as unknown as EventTarget;

    expect(shouldDismissMobileKeyboardFromChat(answerText)).toBe(true);
    expect(shouldDismissMobileKeyboardFromChat(sourceButton)).toBe(false);
  });

  it("dismisses the mobile keyboard when a question starts", () => {
    const target = focusTarget();

    syncComposerFocus(target, true, true);

    expect(target.blur).toHaveBeenCalledOnce();
    expect(target.focus).not.toHaveBeenCalled();
  });

  it("does not reopen the mobile keyboard after an answer finishes", () => {
    const target = focusTarget();

    syncComposerFocus(target, false, true);

    expect(target.blur).not.toHaveBeenCalled();
    expect(target.focus).not.toHaveBeenCalled();
  });

  it("preserves desktop auto-focus after an answer finishes", () => {
    const target = focusTarget();

    syncComposerFocus(target, false, false);

    expect(target.focus).toHaveBeenCalledOnce();
    expect(target.blur).not.toHaveBeenCalled();
  });
});
