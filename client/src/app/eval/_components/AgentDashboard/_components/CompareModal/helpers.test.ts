import { describe, it, expect } from "vitest";
import { deltaBadge } from "./helpers";

/**
 * The compare dialog's one genuinely tricky rule, pinned without rendering
 * anything: a delta's tone says whether the metric IMPROVED, which is not the
 * same as whether it went up.
 */
describe("deltaBadge", () => {
  it("reads a rise as good where higher is better, and a fall as bad", () => {
    expect(deltaBadge(0.78, 0.83, true, "pt")).toEqual({ tone: "good", arrow: "▲", text: "5.0" });
    expect(deltaBadge(0.93, 0.91, true, "pt")).toEqual({ tone: "bad", arrow: "▼", text: "2.0" });
  });

  it("INVERTS cost: spending more is a regression, spending less is an improvement", () => {
    // The arrow still points the way the number moved — it is the TONE that
    // flips. Colouring by sign here would paint the worst outcome green.
    expect(deltaBadge(0.21, 0.23, false, "usd")).toEqual({
      tone: "bad",
      arrow: "▲",
      text: "$0.0200",
    });
    expect(deltaBadge(0.23, 0.21, false, "usd")).toEqual({
      tone: "good",
      arrow: "▼",
      text: "$0.0200",
    });
  });

  it("renders an unmoved metric as neutral, with no arrow — never as a direction", () => {
    expect(deltaBadge(0.8, 0.8, true, "pt")).toEqual({ tone: "neutral", arrow: null, text: "0.0" });
  });

  it("treats float noise as unmoved, because the printed number says 0.0", () => {
    // 0.9 - 0.8 === 0.09999999999999998 in IEEE 754. Deciding tone from the
    // raw float while printing the rounded one makes the arrow and the number
    // beside it disagree; rounding first is what keeps them honest.
    const noise = deltaBadge(0.30000000000000004, 0.3, true, "pt");
    expect(noise).toEqual({ tone: "neutral", arrow: null, text: "0.0" });

    // And a delta that survives rounding is still a real direction.
    expect(deltaBadge(0.8, 0.9, true, "pt")).toEqual({ tone: "good", arrow: "▲", text: "10.0" });
  });

  it("returns null when either side is missing, so the caller omits the badge", () => {
    // A null citation_accuracy or cost_usd is "not measured", not "unchanged" —
    // inventing a 0.0 here would read as a real, flat result.
    expect(deltaBadge(null, 0.9, true, "pt")).toBeNull();
    expect(deltaBadge(0.9, null, true, "pt")).toBeNull();
    expect(deltaBadge(null, null, false, "usd")).toBeNull();
    expect(deltaBadge(undefined, 0.9, true, "pt")).toBeNull();
  });
});
