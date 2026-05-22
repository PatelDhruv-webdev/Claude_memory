import { describe, it, expect } from "vitest";
import { decide, initialState, type TriggerConfig } from "../src/daemon/triggers.js";

const cfg = (overrides: Partial<TriggerConfig> = {}): TriggerConfig => ({
  idleMs: 5_000,
  debounceMs: 1_000,
  enableIdle: true,
  enableError: true,
  enableExit: true,
  ...overrides,
});

describe("trigger decision engine", () => {
  it("change event records time, does not fire", () => {
    let s = initialState();
    const d = decide(s, { kind: "change", at: 100 }, cfg());
    expect(d.fire).toBe(false);
    expect(d.nextState.lastChangeAt).toBe(100);
  });

  it("change resets the idle-fired-for-cycle flag", () => {
    const s = { lastChangeAt: 100, lastFiredAt: 200, idleFiredForCycle: true };
    const d = decide(s, { kind: "change", at: 300 }, cfg());
    expect(d.nextState.idleFiredForCycle).toBe(false);
  });

  it("error fires immediately when enabled", () => {
    const s = { lastChangeAt: 50, lastFiredAt: null, idleFiredForCycle: false };
    const d = decide(s, { kind: "error", at: 100 }, cfg());
    expect(d.fire).toBe(true);
    expect(d.reason).toBe("error");
  });

  it("error does NOT fire when disabled", () => {
    const s = initialState();
    const d = decide(s, { kind: "error", at: 100 }, cfg({ enableError: false }));
    expect(d.fire).toBe(false);
  });

  it("error respects debounce window", () => {
    const s = { lastChangeAt: 0, lastFiredAt: 500, idleFiredForCycle: false };
    const d = decide(s, { kind: "error", at: 1000 }, cfg({ debounceMs: 1000 }));
    expect(d.fire).toBe(false);
  });

  it("tick before idleMs does not fire", () => {
    const s = { lastChangeAt: 0, lastFiredAt: null, idleFiredForCycle: false };
    const d = decide(s, { kind: "tick", at: 4_999 }, cfg({ idleMs: 5_000 }));
    expect(d.fire).toBe(false);
  });

  it("tick after idleMs fires idle exactly once per cycle", () => {
    let s = decide(initialState(), { kind: "change", at: 0 }, cfg()).nextState;
    const d1 = decide(s, { kind: "tick", at: 5_001 }, cfg({ idleMs: 5_000 }));
    expect(d1.fire).toBe(true);
    expect(d1.reason).toBe("idle");
    s = d1.nextState;
    const d2 = decide(s, { kind: "tick", at: 6_000 }, cfg({ idleMs: 5_000 }));
    expect(d2.fire).toBe(false); // already fired this cycle
  });

  it("a new change after idle-fired allows the next idle to fire", () => {
    let s = decide(initialState(), { kind: "change", at: 0 }, cfg()).nextState;
    s = decide(s, { kind: "tick", at: 5_001 }, cfg({ idleMs: 5_000 })).nextState;
    s = decide(s, { kind: "change", at: 10_000 }, cfg()).nextState;
    const d = decide(s, { kind: "tick", at: 16_000 }, cfg({ idleMs: 5_000 }));
    expect(d.fire).toBe(true);
    expect(d.reason).toBe("idle");
  });

  it("stop fires exit when enabled", () => {
    const s = initialState();
    const d = decide(s, { kind: "stop", at: 100 }, cfg());
    expect(d.fire).toBe(true);
    expect(d.reason).toBe("exit");
  });

  it("stop does not fire when exit trigger disabled", () => {
    const s = initialState();
    const d = decide(s, { kind: "stop", at: 100 }, cfg({ enableExit: false }));
    expect(d.fire).toBe(false);
  });

  it("idle does not fire when no change has been observed", () => {
    const s = initialState();
    const d = decide(s, { kind: "tick", at: 10_000 }, cfg({ idleMs: 1_000 }));
    expect(d.fire).toBe(false);
  });
});
