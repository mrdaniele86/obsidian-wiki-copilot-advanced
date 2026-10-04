# Mobile Composer and Web Action Visibility Design

## Goal

Remove the unavailable Web action from the chat composer and remove the unwanted mobile gap between the composer and the on-screen keyboard or mobile navigation chrome.

## Scope

- The Web action is available only when `webSearch.mode === "dedicated-gemini"`.
- When unavailable, it is not visible, focusable, or included in the composer button layout on desktop or mobile.
- A settings refresh updates the label, accessibility text, and availability of the existing control.
- A busy request still disables a visible Web action, but does not make an unavailable action reappear.
- On phones, the floating-navbar clearance moves from external composer margin to internal bottom padding. This retains navbar and safe-area protection without a blank strip outside the composer.

## Non-goals

- Do not alter normal Send behavior, Vault retrieval, Web consent, Web search execution, provider selection, or the compact `search + Web` presentation when the feature is enabled.
- Do not remove viewport/navbar measurement or add a keyboard transform, viewport lift, or new navigation-bar animation workaround.

## Design

Keep the Web button in the view's DOM lifecycle, but centralize its UI state in one helper. The helper calculates availability from the saved web-search mode, sets the native `hidden` property, and applies `disabled` only when the action is available and the view is busy. `hidden` prevents layout allocation and keyboard focus without changing the enabled visual styling.

The current phone composer applies a measured floating-navbar clearance as `margin-bottom`, which creates the visible external gap. Retain that measured value, but include it in `padding-bottom` alongside the existing 8px and safe-area values. The composer background therefore continues through the clearance while its controls remain safely above the navbar. When the keyboard is visible, existing viewport logic supplies zero navbar clearance.

## Acceptance criteria

1. Disabled Web search: no visible Web button or empty button-column space on desktop or phone layouts.
2. Enabled Web search: the compact 72px search-icon + `Web` control remains, has the existing 44px mobile target, and is disabled only while busy.
3. Changing settings and refreshing the view applies the correct visibility, label, and aria label.
4. Phone CSS has no external composer bottom margin; its bottom padding combines safe area and measured navbar clearance.
5. Focused tests cover visibility state and stylesheet assertions, and the full quality suite remains green.
