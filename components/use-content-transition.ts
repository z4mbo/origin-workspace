"use client";

import { useEffect, useState } from "react";

export function useContentTransition(contentKey: string) {
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  useEffect(() => {
    // Keep the placeholder stable for a short transition, including cached views.
    const timer = window.setTimeout(() => setVisibleKey(contentKey), 180);
    return () => window.clearTimeout(timer);
  }, [contentKey]);
  return visibleKey !== contentKey;
}
