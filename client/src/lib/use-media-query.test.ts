import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, render } from "@testing-library/react";
import React from "react";
import { useMediaQuery } from "./use-media-query";

function stubMatchMedia(initialMatches: boolean) {
  let changeListener: ((event: MediaQueryListEvent) => void) | null = null;
  const mql = {
    matches: initialMatches,
    media: "",
    onchange: null,
    addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === "change") changeListener = listener;
    }),
    removeEventListener: vi.fn((event: string) => {
      if (event === "change") changeListener = null;
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  };
  const matchMedia = vi.fn(() => mql);
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    matchMedia,
    mql,
    fireChange(matches: boolean) {
      mql.matches = matches;
      changeListener?.({ matches } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("adopts matches: true from matchMedia after mount", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(true);
  });

  it("adopts matches: false from matchMedia after mount", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);
  });

  it("updates when the media query list fires a change event", () => {
    const { fireChange } = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);

    act(() => {
      fireChange(true);
    });
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const { mql } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("tolerates a missing window.matchMedia and keeps the SSR default", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);
  });

  it("returns false on the very first render, before the effect has a chance to subscribe (AC-26)", () => {
    // By the time renderHook()/render() returns, RTL has already flushed the
    // effect inside `act`, so `result.current` reflects the POST-effect
    // value even for a synchronous stub — it cannot tell the initial state
    // apart from an effect that happens to compute the same value. Stubbing
    // matchMedia to the OPPOSITE of the default and recording what the
    // component saw on its first render (before commit runs any effect)
    // isolates the pre-subscription value on its own, regardless of what the
    // effect goes on to do with it.
    stubMatchMedia(true);
    const seenOnFirstRender: boolean[] = [];
    function Probe() {
      const isNarrow = useMediaQuery("(max-width: 1023px)");
      if (seenOnFirstRender.length === 0) seenOnFirstRender.push(isNarrow);
      return null;
    }
    render(React.createElement(Probe));
    expect(seenOnFirstRender[0]).toBe(false);
  });
});
