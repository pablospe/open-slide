import { describe, expect, it, vi } from 'vitest';
import { en } from '../../../locale/en';
import {
  actionForKey,
  EDITOR_ACTIONS,
  type EditorActionContext,
  type EditorActionId,
  type EditorActionState,
  editorAction,
  formatShortcut,
} from './editor-actions';

const state = (overrides: Partial<EditorActionState> = {}): EditorActionState => ({
  selectionCount: 1,
  inlineEditing: false,
  committing: false,
  pendingCount: 0,
  structureBusy: false,
  transformable: true,
  shared: false,
  external: false,
  text: true,
  clearable: { transform: true, all: true },
  canAddPage: true,
  ...overrides,
});

const reason = (id: EditorActionId, s: EditorActionState) => {
  const status = editorAction(id).enabled(s);
  return status.enabled ? null : status.reason;
};

const reasons = (s: EditorActionState) =>
  Object.fromEntries(EDITOR_ACTIONS.map((action) => [action.id, reason(action.id, s)]));

const key = (
  key: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('EDITOR_ACTIONS', () => {
  it('has unique ids and a label in the locale for every action and reason', () => {
    const ids = EDITOR_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of EDITOR_ACTIONS) expect(en.inspector[action.label]).toBeTruthy();
    const states = [
      state({ selectionCount: 0 }),
      state({ selectionCount: 2 }),
      state({ inlineEditing: true }),
      state({ committing: true }),
      state({ transformable: false, shared: true }),
      state({ transformable: false }),
      state({ pendingCount: 1 }),
      state({ external: true }),
      state({ structureBusy: true }),
      state({ text: false, clearable: { transform: false, all: false }, canAddPage: false }),
    ];
    for (const s of states)
      for (const value of Object.values(reasons(s)))
        if (value) expect(en.inspector[value], value).toBeTruthy();
  });
});

describe('enabled()', () => {
  it('with nothing selected, only page and select-all actions are available', () => {
    const r = reasons(state({ selectionCount: 0, transformable: false, text: false }));
    expect(Object.entries(r).filter(([, value]) => value === null)).toEqual([
      ['selectAll', null],
      ['addPage', null],
    ]);
    expect(r.delete).toBe('actionNeedsSelection');
    expect(r.alignLeft).toBe('actionNeedsSelection');
    expect(r.editText).toBe('actionNeedsSelection');
    expect(r.copySourceLocation).toBe('actionNeedsSelection');
    expect(r.nudgeLeft).toBe('actionNeedsSelection');
  });

  it('with one element selected, everything but distribute is available', () => {
    const r = reasons(state());
    expect(Object.entries(r).filter(([, value]) => value !== null)).toEqual([
      ['distributeHorizontal', 'actionNeedsThree'],
      ['distributeVertical', 'actionNeedsThree'],
    ]);
  });

  it('with several elements selected, refuses structure, text and parent actions', () => {
    const two = reasons(state({ selectionCount: 2 }));
    expect(two.delete).toBe('structureSingleOnly');
    expect(two.duplicate).toBe('structureSingleOnly');
    expect(two.moveEarlier).toBe('structureSingleOnly');
    expect(two.editText).toBe('actionSingleOnly');
    expect(two.selectParent).toBe('actionSingleOnly');
    expect(two.alignLeft).toBeNull();
    expect(two.bringToFront).toBeNull();
    expect(two.distributeHorizontal).toBe('actionNeedsThree');
    expect(two.copySourceLocation).toBeNull();
    const three = reasons(state({ selectionCount: 3 }));
    expect(three.distributeHorizontal).toBeNull();
    expect(three.distributeVertical).toBeNull();
  });

  it('with a shared definition, refuses transforms and structure with the shared reason', () => {
    const r = reasons(state({ shared: true, transformable: false }));
    expect(r.alignLeft).toBe('sharedLayoutHint');
    expect(r.bringForward).toBe('sharedLayoutHint');
    expect(r.clearLayout).toBe('sharedLayoutHint');
    expect(r.nudgeUp).toBe('sharedLayoutHint');
    expect(r.delete).toBe('structureShared');
    expect(r.duplicate).toBe('structureShared');
    expect(r.editText).toBeNull();
    expect(r.copySourceLocation).toBeNull();
  });

  it('explains inline content that cannot be transformed', () => {
    expect(reason('alignLeft', state({ transformable: false }))).toBe('inlineLayoutHint');
  });

  it('while editing text, refuses everything except copying the location and adding a page', () => {
    const r = reasons(state({ inlineEditing: true }));
    expect(Object.entries(r).filter(([, value]) => value !== 'actionTextEditing')).toEqual([
      ['copySourceLocation', null],
      ['addPage', null],
    ]);
  });

  it('while saving, refuses edits', () => {
    const r = reasons(state({ committing: true }));
    expect(r.delete).toBe('actionCommitting');
    expect(r.alignLeft).toBe('actionCommitting');
    expect(r.selectAll).toBe('actionCommitting');
    expect(r.addPage).toBeNull();
  });

  it('orders structure refusals: pending edits, external definition, then busy', () => {
    expect(reason('delete', state({ pendingCount: 2, external: true }))).toBe(
      'structurePendingEdits',
    );
    expect(reason('delete', state({ external: true, structureBusy: true }))).toBe(
      'structureExternal',
    );
    expect(reason('moveLater', state({ structureBusy: true }))).toBe('actionBusy');
  });

  it('gates edit text, clear layout and add page on their own facts', () => {
    expect(reason('editText', state({ text: false }))).toBe('actionNotText');
    expect(reason('clearLayout', state({ clearable: { transform: false, all: true } }))).toBe(
      'clearLayoutNothing',
    );
    expect(reason('clearLayoutAll', state({ clearable: { transform: false, all: true } }))).toBe(
      null,
    );
    expect(reason('clearLayoutAll', state({ clearable: { transform: false, all: false } }))).toBe(
      'clearLayoutNothing',
    );
    expect(reason('addPage', state({ canAddPage: false }))).toBe('actionAddPageUnavailable');
  });
});

describe('run()', () => {
  const context = (): EditorActionContext => ({
    selection: [{ line: 3, column: 4, anchor: {} as HTMLElement }],
    alignToSlide: true,
    visual: {
      align: vi.fn(),
      distribute: vi.fn(),
      arrange: vi.fn(),
      clearLayout: vi.fn(),
      nudge: vi.fn(),
      selectParent: vi.fn(),
      selectAll: vi.fn(),
    },
    runStructure: vi.fn(),
    editText: vi.fn(),
    copySourceLocation: vi.fn(),
    addPage: vi.fn(),
  });

  it('routes each action to the matching editor call', () => {
    const ctx = context();
    editorAction('duplicate').run(ctx);
    editorAction('alignRight').run(ctx);
    editorAction('sendToBack').run(ctx);
    editorAction('distributeVertical').run(ctx);
    editorAction('clearLayoutAll').run(ctx);
    editorAction('nudgeLeft').run(ctx, { shiftKey: true });
    editorAction('nudgeDown').run(ctx, { shiftKey: false });
    editorAction('editText').run(ctx);
    editorAction('copySourceLocation').run(ctx);
    editorAction('addPage').run(ctx);
    expect(ctx.runStructure).toHaveBeenCalledWith('duplicate');
    expect(ctx.visual.align).toHaveBeenCalledWith('right', true);
    expect(ctx.visual.arrange).toHaveBeenCalledWith('back');
    expect(ctx.visual.distribute).toHaveBeenCalledWith('y');
    expect(ctx.visual.clearLayout).toHaveBeenCalledWith('all');
    expect(ctx.visual.nudge).toHaveBeenNthCalledWith(1, { x: -1, y: 0 }, 10);
    expect(ctx.visual.nudge).toHaveBeenNthCalledWith(2, { x: 0, y: 1 }, 1);
    expect(ctx.editText).toHaveBeenCalledWith(ctx.selection[0]);
    expect(ctx.copySourceLocation).toHaveBeenCalledWith(ctx.selection[0]);
    expect(ctx.addPage).toHaveBeenCalled();
  });
});

describe('actionForKey', () => {
  it('maps the documented shortcuts', () => {
    expect(actionForKey(key('Delete'))?.id).toBe('delete');
    expect(actionForKey(key('Backspace'))?.id).toBe('delete');
    expect(actionForKey(key('d', { metaKey: true }))?.id).toBe('duplicate');
    expect(actionForKey(key('D', { ctrlKey: true }))?.id).toBe('duplicate');
    expect(actionForKey(key('ArrowUp', { altKey: true }))?.id).toBe('moveEarlier');
    expect(actionForKey(key('ArrowDown', { altKey: true }))?.id).toBe('moveLater');
    expect(actionForKey(key('ArrowUp'))?.id).toBe('nudgeUp');
    expect(actionForKey(key('ArrowLeft', { shiftKey: true }))?.id).toBe('nudgeLeft');
    expect(actionForKey(key('a', { metaKey: true }))?.id).toBe('selectAll');
    expect(actionForKey(key('A', { ctrlKey: true, shiftKey: true }))?.id).toBe('selectAll');
    expect(actionForKey(key('Enter'))?.id).toBe('editText');
  });

  it('leaves other combos alone', () => {
    expect(actionForKey(key('d'))).toBeNull();
    expect(actionForKey(key('a'))).toBeNull();
    expect(actionForKey(key('d', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(actionForKey(key('Backspace', { metaKey: true }))).toBeNull();
    expect(actionForKey(key('Delete', { shiftKey: true }))).toBeNull();
    expect(actionForKey(key('ArrowUp', { altKey: true, metaKey: true }))).toBeNull();
    expect(actionForKey(key('ArrowDown', { altKey: true, shiftKey: true }))).toBeNull();
    expect(actionForKey(key('ArrowLeft', { ctrlKey: true }))).toBeNull();
    expect(actionForKey(key('Enter', { shiftKey: true }))).toBeNull();
  });
});

describe('formatShortcut', () => {
  it('uses platform glyphs', () => {
    const shortcut = (id: EditorActionId) => editorAction(id).shortcut ?? { keys: [] };
    expect(formatShortcut(shortcut('duplicate'), true)).toBe('⌘D');
    expect(formatShortcut(shortcut('duplicate'), false)).toBe('Ctrl+D');
    expect(formatShortcut(shortcut('moveEarlier'), true)).toBe('⌥↑');
    expect(formatShortcut(shortcut('moveLater'), false)).toBe('Alt+↓');
    expect(formatShortcut(shortcut('delete'), true)).toBe('⌫');
    expect(formatShortcut(shortcut('editText'), true)).toBe('↵');
    expect(formatShortcut(shortcut('selectAll'), true)).toBe('⌘A');
  });
});
