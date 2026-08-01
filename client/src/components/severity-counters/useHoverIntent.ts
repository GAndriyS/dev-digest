/* Hover intent for the findings popover.

   Two delays, for two different problems. The OPEN delay stops a popover from
   flashing on every row the cursor crosses on its way somewhere else. The CLOSE
   delay leaves a grace period so the cursor can travel the gap between the
   trigger and the panel below it without the panel vanishing mid-journey —
   the panel's own mouseenter cancels the pending close.

   `onHoverStart` fires on the FIRST mouseenter, not when the popover opens, so
   a caller that has to fetch can use the open delay as head start. */
"use client";

import React from "react";

const OPEN_DELAY_MS = 180;
const CLOSE_DELAY_MS = 160;

export interface HoverIntent {
  open: boolean;
  close: () => void;
  triggerProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  popoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
}

export function useHoverIntent(opts: {
  /** Fired on the first mouseenter, before the open delay elapses. */
  onHoverStart?: () => void;
  openDelay?: number;
  closeDelay?: number;
} = {}): HoverIntent {
  const { onHoverStart, openDelay = OPEN_DELAY_MS, closeDelay = CLOSE_DELAY_MS } = opts;
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = React.useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A pending timer must not fire into an unmounted component.
  React.useEffect(() => clear, [clear]);

  const scheduleOpen = React.useCallback(() => {
    clear();
    onHoverStart?.();
    timer.current = setTimeout(() => setOpen(true), openDelay);
  }, [clear, onHoverStart, openDelay]);

  const scheduleClose = React.useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(false), closeDelay);
  }, [clear, closeDelay]);

  const close = React.useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  // Escape closes, matching every other dismissible surface in the app.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return {
    open,
    close,
    triggerProps: {
      onMouseEnter: scheduleOpen,
      onMouseLeave: scheduleClose,
      // Keyboard users get the same affordance; focus opens immediately since
      // tabbing to a control is already a deliberate act.
      onFocus: () => {
        clear();
        onHoverStart?.();
        setOpen(true);
      },
      onBlur: scheduleClose,
    },
    popoverProps: {
      onMouseEnter: clear,
      onMouseLeave: scheduleClose,
    },
  };
}
