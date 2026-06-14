/**
 * Hysteresis — PHASE 3. Resists the ~20s coder↔thinker reload.
 *
 * Asymmetric on purpose:
 *  - ESCALATE coder→thinker IMMEDIATELY: a hard task served by the coder is a
 *    *wrong answer* (bat-and-ball → 10p), so don't delay it.
 *  - DE-ESCALATE thinker→coder only after N consecutive coder-signals: staying
 *    on the thinker for a message or two is merely *slow*, not wrong, and avoids
 *    thrash if the very next message is hard again.
 *  - OVERRIDE (/think,/code) always switches now and resets the counter.
 *
 * Pure and synchronous so it's deterministically testable (test-hysteresis.ts).
 */
import type { Route } from "./decide.ts";

export const DESCALATE_VOTES = 2; // consecutive coder-signals needed to leave the thinker

export interface SwitchResult {
  model: Route; // the model to actually use for this request
  switched: boolean; // did the loaded model change (i.e. a reload happened)?
  note: string;
}

export class Hysteresis {
  private current: Route;
  private coderVotes = 0;

  constructor(start: Route = "coder") {
    this.current = start;
  }

  get loaded(): Route {
    return this.current;
  }

  /** Reconcile state with reality — e.g. after a leash fallback actually ran the coder. */
  setLoaded(route: Route): void {
    this.current = route;
    this.coderVotes = 0;
  }

  /** Decide which model to run, applying hysteresis. `want` is the decider's pick. */
  next(want: Route, isOverride: boolean): SwitchResult {
    if (isOverride) {
      const switched = want !== this.current;
      this.current = want;
      this.coderVotes = 0;
      return { model: want, switched, note: "override" };
    }

    if (want === this.current) {
      this.coderVotes = 0;
      return { model: this.current, switched: false, note: "stay (matches loaded)" };
    }

    // want differs from what's loaded
    if (want === "thinker") {
      this.current = "thinker";
      this.coderVotes = 0;
      return { model: "thinker", switched: true, note: "escalate (immediate)" };
    }

    // want === "coder" while thinker is loaded → hysteresis
    this.coderVotes++;
    if (this.coderVotes >= DESCALATE_VOTES) {
      this.current = "coder";
      this.coderVotes = 0;
      return { model: "coder", switched: true, note: `de-escalate (${DESCALATE_VOTES} votes)` };
    }
    return {
      model: "thinker",
      switched: false,
      note: `hold thinker (coder vote ${this.coderVotes}/${DESCALATE_VOTES})`,
    };
  }
}
