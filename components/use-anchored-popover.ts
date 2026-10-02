"use client";

import { useLayoutEffect, type RefObject } from "react";

export function useAnchoredPopover(open: boolean, trigger: RefObject<HTMLButtonElement | null>, menu: RefObject<HTMLDivElement | null>, input: RefObject<HTMLInputElement | null>) {
  useLayoutEffect(() => {
    const button = trigger.current, popover = menu.current;
    if (!open || !button || !popover) return;
    // The top layer keeps pickers outside the scrolling dialog's clipping area.
    const position = () => {
      const box = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0;
      const bottom = top + (viewport?.height || window.innerHeight);
      const width = Math.min(280, window.innerWidth - 24);
      const below = bottom - box.bottom - 12;
      const above = box.top - top - 12;
      const upward = below < 220 && above > below;
      const height = Math.min(330, Math.max(80, upward ? above : below));
      Object.assign(popover.style, {
        width: `${width}px`, maxHeight: `${height}px`,
        left: `${Math.max(12, Math.min(box.left, window.innerWidth - width - 12))}px`,
        top: upward ? "auto" : `${box.bottom + 5}px`,
        bottom: upward ? `${window.innerHeight - box.top + 5}px` : "auto",
      });
    };
    position();
    popover.showPopover();
    input.current?.focus({ preventScroll: true });
    const onScroll = (event: Event) => { if (!popover.contains(event.target as Node)) position(); };
    window.addEventListener("resize", position);
    document.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      if (popover.matches(":popover-open")) popover.hidePopover();
    };
  }, [open, trigger, menu, input]);
}
