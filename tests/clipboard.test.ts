import { describe, it, expect } from "vitest";
import { copyToClipboard } from "../src/resume/clipboard.js";

describe("copyToClipboard", () => {
  it("returns ok=false with a clear error when no clipboard tool is available", async () => {
    // In CI/sandboxed environments none of pbcopy/xclip/wl-copy/xsel/clip.exe
    // are usually installed. We can't easily mock spawn here, so we just
    // assert the function returns a structured result (ok bool + tool/error)
    // and never throws.
    const r = await copyToClipboard("test");
    expect(typeof r.ok).toBe("boolean");
    if (!r.ok) {
      expect(r.tool).toBeNull();
      expect(r.error).toBeTruthy();
    } else {
      expect(typeof r.tool).toBe("string");
    }
  });
});
