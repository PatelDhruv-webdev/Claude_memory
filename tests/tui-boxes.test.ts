import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  visibleLen,
  padEnd,
  truncate,
  boxTop,
  boxDivider,
  boxRow,
  boxBottom,
} from "../src/tui/boxes.js";

describe("stripAnsi", () => {
  it("removes ANSI escape codes", () => {
    expect(stripAnsi("\x1b[32mhello\x1b[0m")).toBe("hello");
  });

  it("leaves plain strings unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("handles multiple codes", () => {
    expect(stripAnsi("\x1b[1m\x1b[36mfoo\x1b[0m bar")).toBe("foo bar");
  });
});

describe("visibleLen", () => {
  it("counts visible characters, ignoring ANSI", () => {
    expect(visibleLen("\x1b[32mhello\x1b[0m")).toBe(5);
  });

  it("counts plain string length", () => {
    expect(visibleLen("abc")).toBe(3);
  });
});

describe("padEnd", () => {
  it("pads a short string to target width", () => {
    const r = padEnd("hi", 6);
    expect(visibleLen(r)).toBe(6);
    expect(r).toBe("hi    ");
  });

  it("leaves a string that is exactly the target width unchanged", () => {
    expect(padEnd("abc", 3)).toBe("abc");
  });

  it("does not truncate strings longer than target width", () => {
    const r = padEnd("toolong", 4);
    expect(r).toBe("toolong");
  });

  it("accounts for invisible ANSI codes in length calculation", () => {
    const colored = "\x1b[32mhi\x1b[0m"; // visible length = 2
    const r = padEnd(colored, 6);
    expect(visibleLen(r)).toBe(6);
  });
});

describe("truncate", () => {
  it("does not modify strings within width", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and adds ellipsis when too long", () => {
    const r = truncate("hello world", 8);
    expect(r).toBe("hello w…");
    expect(r.length).toBe(8);
  });

  it("handles exact width boundary", () => {
    const r = truncate("abcde", 5);
    expect(r).toBe("abcde");
  });
});

describe("boxTop / boxBottom", () => {
  it("produces a line of the correct visible width", () => {
    const line = boxTop({ width: 40 });
    expect(visibleLen(line)).toBe(40);
  });

  it("includes title text", () => {
    const line = boxTop({ width: 40, title: "dashboard" });
    expect(stripAnsi(line)).toContain("dashboard");
  });

  it("boxBottom is the correct width", () => {
    const line = boxBottom(40);
    expect(visibleLen(line)).toBe(40);
  });

  it("boxBottom includes footer text", () => {
    const line = boxBottom(40, "q quit");
    expect(stripAnsi(line)).toContain("q quit");
  });
});

describe("boxDivider", () => {
  it("produces the correct visible width", () => {
    const line = boxDivider(50);
    expect(visibleLen(line)).toBe(50);
  });

  it("includes title text when provided", () => {
    const line = boxDivider(50, "Session");
    expect(stripAnsi(line)).toContain("Session");
  });
});

describe("boxRow", () => {
  it("produces the correct visible width", () => {
    const line = boxRow("hello world", 40);
    expect(visibleLen(line)).toBe(40);
  });

  it("pads short content to fill the box width", () => {
    const line = boxRow("hi", 30);
    expect(visibleLen(line)).toBe(30);
  });

  it("truncates content that is too long", () => {
    const content = "x".repeat(100);
    const line = boxRow(content, 30);
    expect(visibleLen(line)).toBe(30);
  });

  it("starts and ends with box border characters", () => {
    const line = boxRow("text", 20);
    expect(stripAnsi(line)[0]).toBe("║");
    expect(stripAnsi(line).at(-1)).toBe("║");
  });
});
