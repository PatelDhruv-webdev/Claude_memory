/**
 * Trigger decision engine. Pure logic — no I/O, no timers — so it's fully
 * unit-testable. The daemon wires it up to a clock and a snapshot function.
 *
 * Rules (from spec section 5 / your edge-case list):
 *  - "change" event resets the idle timer
 *  - if no change for `idleMs`, fire one snapshot (idle trigger)
 *  - after firing, don't fire again until a new change resets the cycle
 *  - error events fire a snapshot immediately (still debounced — at most
 *    one snapshot per `debounceMs` window)
 *  - session-rotated events do NOT fire a snapshot on their own; the new
 *    file's first change will
 */
export type TriggerInput =
  | { kind: "change"; at: number }
  | { kind: "error"; at: number }
  | { kind: "tick"; at: number }
  | { kind: "stop"; at: number };

export interface TriggerConfig {
  idleMs: number;
  debounceMs: number;
  enableIdle: boolean;
  enableError: boolean;
  enableExit: boolean;
}

export interface TriggerState {
  lastChangeAt: number | null;
  lastFiredAt: number | null;
  idleFiredForCycle: boolean;
}

export function initialState(): TriggerState {
  return { lastChangeAt: null, lastFiredAt: null, idleFiredForCycle: false };
}

export interface Decision {
  fire: boolean;
  reason?: "error" | "idle" | "exit";
  nextState: TriggerState;
}

export function decide(
  state: TriggerState,
  input: TriggerInput,
  cfg: TriggerConfig,
): Decision {
  switch (input.kind) {
    case "change": {
      return {
        fire: false,
        nextState: {
          lastChangeAt: input.at,
          lastFiredAt: state.lastFiredAt,
          idleFiredForCycle: false,
        },
      };
    }
    case "error": {
      if (!cfg.enableError) return { fire: false, nextState: state };
      if (
        state.lastFiredAt !== null &&
        input.at - state.lastFiredAt < cfg.debounceMs
      ) {
        return { fire: false, nextState: state };
      }
      return {
        fire: true,
        reason: "error",
        nextState: { ...state, lastFiredAt: input.at },
      };
    }
    case "tick": {
      if (!cfg.enableIdle) return { fire: false, nextState: state };
      if (state.lastChangeAt === null) return { fire: false, nextState: state };
      if (state.idleFiredForCycle) return { fire: false, nextState: state };
      if (input.at - state.lastChangeAt < cfg.idleMs) {
        return { fire: false, nextState: state };
      }
      return {
        fire: true,
        reason: "idle",
        nextState: { ...state, lastFiredAt: input.at, idleFiredForCycle: true },
      };
    }
    case "stop": {
      if (!cfg.enableExit) return { fire: false, nextState: state };
      return {
        fire: true,
        reason: "exit",
        nextState: { ...state, lastFiredAt: input.at },
      };
    }
  }
}
