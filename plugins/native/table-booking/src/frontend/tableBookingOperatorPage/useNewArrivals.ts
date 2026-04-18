import { useCallback, useEffect, useRef, useState } from "react";

interface ArrivalLike {
  id: string;
  sourceChannel: string;
  createdAt: string;
  status: string;
}

export interface NewArrivalsResult {
  newCount: number;
  newIds: Set<string>;
  acknowledge: () => void;
}

export function useNewArrivals(arrivals: ArrivalLike[]): NewArrivalsResult {
  const seenRef = useRef<Set<string>>(new Set());
  const initialisedRef = useRef(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onlineConfirmed = arrivals
      .filter(
        (row) =>
          row.sourceChannel === "online" && row.status === "confirmed",
      )
      .map((row) => row.id);

    if (!initialisedRef.current) {
      initialisedRef.current = true;
      seenRef.current = new Set(onlineConfirmed);
      return;
    }

    const fresh = onlineConfirmed.filter((id) => !seenRef.current.has(id));
    if (fresh.length === 0) return;

    setNewIds((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next;
    });
  }, [arrivals]);

  const acknowledge = useCallback(() => {
    setNewIds((prev) => {
      if (prev.size === 0) return prev;
      for (const id of prev) seenRef.current.add(id);
      return new Set();
    });
  }, []);

  return {
    newCount: newIds.size,
    newIds,
    acknowledge,
  };
}
