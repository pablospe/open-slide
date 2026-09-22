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
  | 'sibling-not-element'
  | 'unknown-snippet'
  | 'asset-required'
  | 'page-not-found'
  | 'page-root';

export const STRUCTURE_OPS: Record<StructureActionId, (instanceCount: number) => EditOp> = {
  moveEarlier: (instanceCount) => ({ kind: 'move-element', direction: 'earlier', instanceCount }),
  moveLater: (instanceCount) => ({ kind: 'move-element', direction: 'later', instanceCount }),
  duplicate: (instanceCount) => ({ kind: 'duplicate-element', instanceCount }),
  delete: (instanceCount) => ({ kind: 'remove-element', instanceCount }),
};

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
  'unknown-snippet': 'unknownSnippet',
  'asset-required': 'assetRequired',
  'page-not-found': 'pageNotFound',
  'page-root': 'pageRoot',
};

export function refusalMessage(
  locale: Locale['inspector'],
  code: string | undefined,
): string | null {
  const key = REFUSAL_LABELS[code as StructureRefusal];
  return key ? locale.structureRefusals[key] : null;
}
