import { useSyncExternalStore } from 'react';
import type { StepAggregate } from '../step-context';

export type StepPreviewState = {
  page: number | null;
  revealed: number | null;
  aggregate: StepAggregate;
};

let state: StepPreviewState = {
  page: null,
  revealed: null,
  aggregate: { revealed: 0, stepCount: 0 },
};
const listeners = new Set<() => void>();

function update(next: Partial<StepPreviewState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Editor-only: the Reveal panel drives how many steps of the current page the
// editor canvas shows. `null` means the normal editor view, every step shown.
export const stepPreview = {
  get: () => state,
  setRevealed(revealed: number | null) {
    if (revealed !== state.revealed) update({ revealed });
  },
  setPage(page: number) {
    if (page !== state.page) update({ page, revealed: null });
  },
  reportAggregate(aggregate: StepAggregate) {
    const prev = state.aggregate;
    if (prev.revealed !== aggregate.revealed || prev.stepCount !== aggregate.stepCount)
      update({ aggregate });
  },
};

export function useStepPreview(): StepPreviewState {
  return useSyncExternalStore(subscribe, stepPreview.get, stepPreview.get);
}
