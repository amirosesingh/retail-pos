import { describe, expect, it } from "vitest";
import { defaultSettings } from "../pos-seed";
import { settingsDraftPatch } from "../settings-draft";
import { mergePatch } from "../settings-sections";

describe("explicit settings drafts", () => {
  it("keeps live preview edits local and returns only the changed receipt field on save", () => {
    const base = structuredClone(defaultSettings);
    const draft = mergePatch(base, { receipt: { footerText: "Local preview only" } });
    expect(base.receipt.footerText).not.toBe("Local preview only");
    expect(settingsDraftPatch(base, draft)).toEqual({ receipt: { footerText: "Local preview only" } });
  });
  it("does not copy stale unedited fields over a newer remote refresh", () => {
    const base = structuredClone(defaultSettings);
    const draft = mergePatch(base, { receipt: { css: ".total { font-weight: bold; }" } });
    const latest = mergePatch(base, { receipt: { footerText: "New remote footer" } });
    const saved = mergePatch(latest, settingsDraftPatch(base, draft));
    expect(saved.receipt.footerText).toBe("New remote footer");
    expect(saved.receipt.css).toBe(draft.receipt.css);
  });
  it("produces no writes when a draft is discarded or unchanged", () => {
    expect(settingsDraftPatch(defaultSettings, structuredClone(defaultSettings))).toEqual({});
  });
});
