import { useSyncExternalStore } from 'react';

export type UntracedPick = { slideId: string; tagName: string };

let current: UntracedPick | null = null;
const listeners = new Set<() => void>();

export function setUntracedPick(next: UntracedPick | null) {
  if (current?.slideId === next?.slideId && current?.tagName === next?.tagName) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return current;
}

export function useUntracedPick(slideId: string): string | null {
  const pick = useSyncExternalStore(subscribe, snapshot, snapshot);
  return pick?.slideId === slideId ? pick.tagName : null;
}
