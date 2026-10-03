import { describe, expect, it } from "vitest";
import { SessionWebSearchConsent } from "../../src/web-search/session-consent";

describe("SessionWebSearchConsent", () => {
  it("remembers consent only for one provider/model pair", () => {
    const consent = new SessionWebSearchConsent();

    consent.remember("gemini", "gemini-2.5-flash");

    expect(consent.has("gemini", "gemini-2.5-flash")).toBe(true);
    expect(consent.has("gemini", "gemini-2.5-pro")).toBe(false);
    expect(consent.has("other-provider", "gemini-2.5-flash")).toBe(false);
  });

  it("clears every remembered provider/model pair", () => {
    const consent = new SessionWebSearchConsent();
    consent.remember("gemini", "gemini-2.5-flash");
    consent.remember("gemini", "gemini-2.5-pro");

    consent.clear();

    expect(consent.has("gemini", "gemini-2.5-flash")).toBe(false);
    expect(consent.has("gemini", "gemini-2.5-pro")).toBe(false);
  });

  it("does not reuse question-only consent to send recent chat context", () => {
    const consent = new SessionWebSearchConsent();

    consent.remember("gemini", "gemini-2.5-flash", false);

    expect(consent.has("gemini", "gemini-2.5-flash", false)).toBe(true);
    expect(consent.has("gemini", "gemini-2.5-flash", true)).toBe(false);
  });
});
