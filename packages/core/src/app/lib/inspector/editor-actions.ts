import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BringToFront,
  Copy,
  CornerLeftUp,
  FileCode2,
  type LucideIcon,
  MoveDown,
  MoveUp,
  PencilLine,
  RectangleHorizontal,
  RotateCcw,
  SendToBack,
  SquareDashedMousePointer,
  Trash2,
} from 'lucide-react';
import type { SelectedTarget } from '@/components/inspector/inspector-provider';
import type { Locale } from '../../../locale/types';
import type { Alignment } from './geometry';
import type { StructureActionId } from './structure-actions';
import type { ArrangeDirection } from './use-visual-editor';
import type { ResetGestureScope } from './visual-dom';

type StringKeys<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T];
export type InspectorText = StringKeys<Locale['inspector']>;

export type EditorActionId =
  | 'editText'
  | 'duplicate'
  | 'delete'
  | 'moveEarlier'
  | 'moveLater'
  | 'bringToFront'
  | 'bringForward'
  | 'sendBackward'
  | 'sendToBack'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignTop'
  | 'alignMiddle'
  | 'alignBottom'
  | 'distributeHorizontal'
  | 'distributeVertical'
  | 'resetPosition'
  | 'resetAll'
  | 'selectParent'
  | 'selectAll'
  | 'copySourceLocation'
  | 'addPage'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'nudgeUp'
  | 'nudgeDown';

export type EditorActionGroup =
  | 'edit'
  | 'structure'
  | 'layer'
  | 'align'
  | 'layout'
  | 'selection'
  | 'page'
  | 'nudge';

export type EditorActionState = {
  selectionCount: number;
  inlineEditing: boolean;
  committing: boolean;
  pendingCount: number;
  structureBusy: boolean;
  transformable: boolean;
  shared: boolean;
  external: boolean;
  text: boolean;
  resettable: Record<ResetGestureScope, boolean>;
  canAddPage: boolean;
};

export type EditorActionStatus = { enabled: true } | { enabled: false; reason: InspectorText };

export type EditorActionContext = {
  selection: SelectedTarget[];
  alignToSlide: boolean;
  visual: {
    align: (alignment: Alignment, toSlide: boolean) => void;
    distribute: (axis: 'x' | 'y') => void;
    arrange: (direction: ArrangeDirection) => void;
    resetGesture: (scope: ResetGestureScope) => void;
    nudge: (vector: { x: number; y: number }, step: number) => void;
    selectParent: () => void;
    selectAll: () => void;
  };
  runStructure: (id: StructureActionId) => void;
  editText: (target: SelectedTarget) => void;
  copySourceLocation: (target: SelectedTarget) => void;
  addPage?: () => void;
};

export type ActionTrigger = { shiftKey: boolean };

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

// `mod` is ⌘ or Ctrl. `'any'` accepts the modifier either way; otherwise it must match exactly.
export type Shortcut = {
  keys: readonly string[];
  mod?: boolean | 'any';
  alt?: boolean | 'any';
  shift?: boolean | 'any';
};

export type EditorAction = {
  id: EditorActionId;
  group: EditorActionGroup;
  label: InspectorText;
  icon: LucideIcon;
  shortcut?: Shortcut;
  // Keyboard handling when the action is disabled (a missing selection always lets the key through):
  // 'block' swallows the key, 'toast' swallows it and shows the reason, 'pass' leaves it to the page.
  whenDisabled?: 'block' | 'toast' | 'pass';
  // Nudges and select-all keep firing while the key auto-repeats.
  repeat?: boolean;
  // Key events whose target matches this selector are left alone.
  ignoreTargets?: string;
  menu?: boolean;
  destructive?: boolean;
  enabled: (state: EditorActionState) => EditorActionStatus;
  run: (ctx: EditorActionContext, trigger?: ActionTrigger) => void;
};

const ok: EditorActionStatus = { enabled: true };
const no = (reason: InspectorText): EditorActionStatus => ({ enabled: false, reason });

function editable(state: EditorActionState): EditorActionStatus {
  if (state.selectionCount === 0) return no('actionNeedsSelection');
  if (state.inlineEditing) return no('actionTextEditing');
  if (state.committing) return no('actionCommitting');
  return ok;
}

function transformable(state: EditorActionState): EditorActionStatus {
  const base = editable(state);
  if (!base.enabled) return base;
  if (!state.transformable) return no(state.shared ? 'sharedLayoutHint' : 'inlineLayoutHint');
  return ok;
}

function structural(state: EditorActionState): EditorActionStatus {
  const base = editable(state);
  if (!base.enabled) return base;
  if (state.selectionCount !== 1) return no('structureSingleOnly');
  if (state.pendingCount > 0) return no('structurePendingEdits');
  if (state.external) return no('structureExternal');
  if (state.shared) return no('structureShared');
  if (state.structureBusy) return no('actionBusy');
  return ok;
}

function single(state: EditorActionState): EditorActionStatus {
  const base = editable(state);
  if (!base.enabled) return base;
  if (state.selectionCount !== 1) return no('actionSingleOnly');
  return ok;
}

const structureAction = (
  id: StructureActionId,
  label: InspectorText,
  icon: LucideIcon,
  shortcut: Shortcut,
  destructive = false,
): EditorAction => ({
  id,
  group: 'structure',
  label,
  icon,
  shortcut,
  whenDisabled: 'toast',
  destructive,
  enabled: structural,
  run: (ctx) => ctx.runStructure(id),
});

const alignAction = (
  id: EditorActionId,
  label: InspectorText,
  icon: LucideIcon,
  alignment: Alignment,
): EditorAction => ({
  id,
  group: 'align',
  label,
  icon,
  enabled: transformable,
  run: (ctx) => ctx.visual.align(alignment, ctx.alignToSlide),
});

const layerAction = (
  id: EditorActionId,
  label: InspectorText,
  icon: LucideIcon,
  direction: ArrangeDirection,
): EditorAction => ({
  id,
  group: 'layer',
  label,
  icon,
  enabled: transformable,
  run: (ctx) => ctx.visual.arrange(direction),
});

const distributeAction = (
  id: EditorActionId,
  label: InspectorText,
  icon: LucideIcon,
  axis: 'x' | 'y',
): EditorAction => ({
  id,
  group: 'align',
  label,
  icon,
  enabled: (state) => {
    const base = transformable(state);
    if (!base.enabled) return base;
    return state.selectionCount < 3 ? no('actionNeedsThree') : ok;
  },
  run: (ctx) => ctx.visual.distribute(axis),
});

const nudgeAction = (
  id: EditorActionId,
  label: InspectorText,
  icon: LucideIcon,
  key: string,
  vector: { x: number; y: number },
): EditorAction => ({
  id,
  group: 'nudge',
  label,
  icon,
  shortcut: { keys: [key], shift: 'any' },
  repeat: true,
  menu: false,
  enabled: transformable,
  run: (ctx, trigger) => ctx.visual.nudge(vector, trigger?.shiftKey ? 10 : 1),
});

export const EDITOR_ACTIONS: readonly EditorAction[] = [
  {
    id: 'editText',
    group: 'edit',
    label: 'editText',
    icon: PencilLine,
    shortcut: { keys: ['Enter'] },
    whenDisabled: 'pass',
    ignoreTargets: 'button, a',
    enabled: (state) => {
      const base = single(state);
      if (!base.enabled) return base;
      return state.text ? ok : no('actionNotText');
    },
    run: (ctx) => {
      const target = ctx.selection.at(-1);
      if (target) ctx.editText(target);
    },
  },
  structureAction('duplicate', 'duplicateElement', Copy, { keys: ['d'], mod: true }),
  structureAction('delete', 'deleteElement', Trash2, { keys: ['Delete', 'Backspace'] }, true),
  structureAction('moveEarlier', 'moveElementEarlier', MoveUp, { keys: ['ArrowUp'], alt: true }),
  structureAction('moveLater', 'moveElementLater', MoveDown, { keys: ['ArrowDown'], alt: true }),
  layerAction('bringToFront', 'bringToFront', BringToFront, 'front'),
  layerAction('bringForward', 'bringForward', ArrowUp, 'forward'),
  layerAction('sendBackward', 'sendBackward', ArrowDown, 'backward'),
  layerAction('sendToBack', 'sendToBack', SendToBack, 'back'),
  alignAction('alignLeft', 'alignLeft', AlignHorizontalJustifyStart, 'left'),
  alignAction('alignCenter', 'alignCenter', AlignHorizontalJustifyCenter, 'center'),
  alignAction('alignRight', 'alignRight', AlignHorizontalJustifyEnd, 'right'),
  alignAction('alignTop', 'alignTop', AlignVerticalJustifyStart, 'top'),
  alignAction('alignMiddle', 'alignMiddle', AlignVerticalJustifyCenter, 'middle'),
  alignAction('alignBottom', 'alignBottom', AlignVerticalJustifyEnd, 'bottom'),
  distributeAction(
    'distributeHorizontal',
    'distributeHorizontal',
    AlignHorizontalDistributeCenter,
    'x',
  ),
  distributeAction('distributeVertical', 'distributeVertical', AlignVerticalDistributeCenter, 'y'),
  {
    id: 'resetPosition',
    group: 'layout',
    label: 'resetPositionOnly',
    icon: RotateCcw,
    enabled: (state) => {
      const base = transformable(state);
      if (!base.enabled) return base;
      return state.resettable.transform ? ok : no('resetNothing');
    },
    run: (ctx) => ctx.visual.resetGesture('transform'),
  },
  {
    id: 'resetAll',
    group: 'layout',
    label: 'resetAll',
    icon: RotateCcw,
    enabled: (state) => {
      const base = transformable(state);
      if (!base.enabled) return base;
      return state.resettable.all ? ok : no('resetNothing');
    },
    run: (ctx) => ctx.visual.resetGesture('all'),
  },
  {
    id: 'selectParent',
    group: 'selection',
    label: 'selectParent',
    icon: CornerLeftUp,
    enabled: single,
    run: (ctx) => ctx.visual.selectParent(),
  },
  {
    id: 'selectAll',
    group: 'selection',
    label: 'selectAll',
    icon: SquareDashedMousePointer,
    shortcut: { keys: ['a'], mod: true, alt: 'any', shift: 'any' },
    repeat: true,
    enabled: (state) => {
      if (state.inlineEditing) return no('actionTextEditing');
      if (state.committing) return no('actionCommitting');
      return ok;
    },
    run: (ctx) => ctx.visual.selectAll(),
  },
  {
    id: 'copySourceLocation',
    group: 'selection',
    label: 'copySourceLocation',
    icon: FileCode2,
    enabled: (state) => (state.selectionCount === 0 ? no('actionNeedsSelection') : ok),
    run: (ctx) => {
      const target = ctx.selection.at(-1);
      if (target) ctx.copySourceLocation(target);
    },
  },
  {
    id: 'addPage',
    group: 'page',
    label: 'actionAddPage',
    icon: RectangleHorizontal,
    enabled: (state) => (state.canAddPage ? ok : no('actionAddPageUnavailable')),
    run: (ctx) => ctx.addPage?.(),
  },
  nudgeAction('nudgeLeft', 'actionNudgeLeft', ArrowLeft, 'ArrowLeft', { x: -1, y: 0 }),
  nudgeAction('nudgeRight', 'actionNudgeRight', ArrowRight, 'ArrowRight', { x: 1, y: 0 }),
  nudgeAction('nudgeUp', 'actionNudgeUp', ArrowUp, 'ArrowUp', { x: 0, y: -1 }),
  nudgeAction('nudgeDown', 'actionNudgeDown', ArrowDown, 'ArrowDown', { x: 0, y: 1 }),
];

const BY_ID = new Map(EDITOR_ACTIONS.map((action) => [action.id, action]));

export function editorAction(id: EditorActionId): EditorAction {
  return BY_ID.get(id) as EditorAction;
}

export function actionStatus(id: EditorActionId, state: EditorActionState): EditorActionStatus {
  return editorAction(id).enabled(state);
}

function modifierMatches(expected: boolean | 'any' | undefined, pressed: boolean): boolean {
  return expected === 'any' || pressed === Boolean(expected);
}

export function matchesShortcut(shortcut: Shortcut, event: ShortcutEvent): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return (
    shortcut.keys.includes(key) &&
    modifierMatches(shortcut.mod, event.metaKey || event.ctrlKey) &&
    modifierMatches(shortcut.alt, event.altKey) &&
    modifierMatches(shortcut.shift, event.shiftKey)
  );
}

export function actionForKey(event: ShortcutEvent): EditorAction | null {
  return (
    EDITOR_ACTIONS.find((action) => action.shortcut && matchesShortcut(action.shortcut, event)) ??
    null
  );
}

const KEY_GLYPHS: Record<string, string> = {
  Enter: '↵',
  Delete: '⌦',
  Backspace: '⌫',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

export function formatShortcut(shortcut: Shortcut, apple: boolean): string {
  const key = shortcut.keys.includes('Backspace')
    ? KEY_GLYPHS.Backspace
    : (KEY_GLYPHS[shortcut.keys[0]] ?? shortcut.keys[0].toUpperCase());
  const parts: string[] = [];
  if (shortcut.mod === true) parts.push(apple ? '⌘' : 'Ctrl+');
  if (shortcut.alt === true) parts.push(apple ? '⌥' : 'Alt+');
  if (shortcut.shift === true) parts.push(apple ? '⇧' : 'Shift+');
  return `${parts.join('')}${key}`;
}
