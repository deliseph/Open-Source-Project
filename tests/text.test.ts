import { describe, expect, it } from "vitest";

import { decodeText, repairDeep, repairMojibake } from "../src/core/text.js";

describe("repairMojibake", () => {
  it("restores emoji mangled by Instagram's exporter", () => {
    // "😀" is F0 9F 98 80 in UTF-8; Instagram writes each byte as a character.
    expect(repairMojibake("ð")).toBe("😀");
  });

  it("restores accented Latin text", () => {
    expect(repairMojibake("cafÃ©")).toBe("café");
    expect(repairMojibake("naÃ¯ve")).toBe("naïve");
  });

  it("restores non-Latin scripts", () => {
    expect(repairMojibake("ãã")).toBe("こん");
    expect(repairMojibake("ÙØ±Ø­Ø¨Ø§")).toBe(
      "مرحبا",
    );
  });

  it("leaves plain ASCII untouched", () => {
    expect(repairMojibake("just a normal caption")).toBe("just a normal caption");
    expect(repairMojibake("")).toBe("");
  });

  it("leaves correctly decoded text untouched", () => {
    // Already-valid emoji and CJK must survive a second pass unchanged,
    // which is what makes the repair safe to run over any export.
    expect(repairMojibake("café 😀")).toBe("café 😀");
    expect(repairMojibake("こんにちは")).toBe("こんにちは");
  });

  it("is idempotent", () => {
    const once = repairMojibake("cafÃ© ð");
    expect(repairMojibake(once)).toBe(once);
    expect(once).toBe("café 😀");
  });

  it("keeps genuine Latin-1 text that is not mojibake", () => {
    // "Ã" alone is not a valid UTF-8 lead byte sequence, so reinterpreting
    // would corrupt it. The original must win.
    expect(repairMojibake("Ã")).toBe("Ã");
    expect(repairMojibake("50° today")).toBe("50° today");
  });
});

describe("repairDeep", () => {
  it("walks nested structures including object keys", () => {
    const input = {
      "cafÃ©": [{ text: "ð", n: 42, ok: true }],
      nothing: null,
    };
    expect(repairDeep(input)).toEqual({
      café: [{ text: "😀", n: 42, ok: true }],
      nothing: null,
    });
  });
});

describe("decodeText", () => {
  it("strips a UTF-8 byte order mark", () => {
    expect(decodeText(Buffer.from("﻿{}", "utf8"))).toBe("{}");
  });

  it("passes through text with no BOM", () => {
    expect(decodeText(Buffer.from("hello", "utf8"))).toBe("hello");
  });
});
