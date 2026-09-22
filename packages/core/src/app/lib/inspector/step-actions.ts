import type { Locale } from '../../../locale/types';
import type { EditOp } from './use-editor';

export type StepActionId = 'wrap' | 'unwrap' | 'earlier' | 'later' | 'duration';

export type StepInfo = {
  inStep: boolean;
  index: number | null;
  count: number | null;
  duration: number | null;
  actions: Record<StepActionId, string | null>;
};

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

export function isWrapShortcut(event: ShortcutEvent): boolean {
  return (
    event.key.toLowerCase() === 's' &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey
  );
}

export function stepOp(id: StepActionId, instanceCount: number, duration?: number | null): EditOp {
  switch (id) {
    case 'wrap':
      return { kind: 'wrap-in-step', instanceCount };
    case 'unwrap':
      return { kind: 'unwrap-step', instanceCount };
    case 'earlier':
    case 'later':
      return { kind: 'move-step', direction: id, instanceCount };
    case 'duration':
      return { kind: 'set-step-duration', value: duration ?? null, instanceCount };
  }
}

// `null` clears the attribute so the step falls back to the default fade.
export function parseDurationInput(raw: string): number | null | 'invalid' {
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 60000) return 'invalid';
  return Math.round(value);
}

const REFUSAL_LABELS: Record<string, keyof Locale['inspector']['stepRefusals']> = {
  root: 'root',
  'already-step': 'alreadyStep',
  'parent-not-host': 'parentNotHost',
  'mixed-children': 'mixedChildren',
  'name-conflict': 'nameConflict',
  'nested-steps': 'nestedSteps',
  'not-step': 'notStep',
  'step-has-siblings': 'stepHasSiblings',
  'no-step-sibling': 'noStepSibling',
  'invalid-duration': 'invalidDuration',
};

export function stepRefusalMessage(
  locale: Locale['inspector'],
  code: string | null | undefined,
): string | null {
  const key = code ? REFUSAL_LABELS[code] : undefined;
  return key ? locale.stepRefusals[key] : null;
}
