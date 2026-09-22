import type { Locale } from '../../../locale/types';
import type { EditOp } from './use-editor';

export type StructureActionId = 'delete' | 'duplicate' | 'moveEarlier' | 'moveLater';

export type StructureRefusal =
  | 'not-found'
  | 'root'
  | 'expression'
  | 'conditional'
  | 'map'
  | 'shared'
  | 'comment'
  | 'no-sibling'
  | 'sibling-not-element';

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

export type StructureAction = {
  id: StructureActionId;
  label: keyof Locale['inspector'] &
    ('deleteElement' | 'duplicateElement' | 'moveElementEarlier' | 'moveElementLater');
  op: (instanceCount: number) => EditOp;
  matches: (event: ShortcutEvent) => boolean;
};

const plain = (event: ShortcutEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

export const STRUCTURE_ACTIONS: readonly StructureAction[] = [
  {
    id: 'moveEarlier',
    label: 'moveElementEarlier',
    op: (instanceCount) => ({ kind: 'move-element', direction: 'earlier', instanceCount }),
    matches: (e) => e.key === 'ArrowUp' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey,
  },
  {
    id: 'moveLater',
    label: 'moveElementLater',
    op: (instanceCount) => ({ kind: 'move-element', direction: 'later', instanceCount }),
    matches: (e) => e.key === 'ArrowDown' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey,
  },
  {
    id: 'duplicate',
    label: 'duplicateElement',
    op: (instanceCount) => ({ kind: 'duplicate-element', instanceCount }),
    matches: (e) =>
      e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey,
  },
  {
    id: 'delete',
    label: 'deleteElement',
    op: (instanceCount) => ({ kind: 'remove-element', instanceCount }),
    matches: (e) => (e.key === 'Delete' || e.key === 'Backspace') && plain(e),
  },
];

export function structureActionForEvent(event: ShortcutEvent): StructureAction | null {
  return STRUCTURE_ACTIONS.find((action) => action.matches(event)) ?? null;
}

const REFUSAL_LABELS: Record<StructureRefusal, keyof Locale['inspector']['structureRefusals']> = {
  'not-found': 'notFound',
  root: 'root',
  expression: 'expression',
  conditional: 'conditional',
  map: 'map',
  shared: 'shared',
  comment: 'comment',
  'no-sibling': 'noSibling',
  'sibling-not-element': 'siblingNotElement',
};

export function refusalMessage(
  locale: Locale['inspector'],
  code: string | undefined,
): string | null {
  const key = REFUSAL_LABELS[code as StructureRefusal];
  return key ? locale.structureRefusals[key] : null;
}
