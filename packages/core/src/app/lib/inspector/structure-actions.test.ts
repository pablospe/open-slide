import { describe, expect, it } from 'vitest';
import { en } from '../../../locale/en';
import { refusalMessage, STRUCTURE_ACTIONS, structureActionForEvent } from './structure-actions';

const key = (
  key: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('structureActionForEvent', () => {
  it('maps the documented shortcuts', () => {
    expect(structureActionForEvent(key('Delete'))?.id).toBe('delete');
    expect(structureActionForEvent(key('Backspace'))?.id).toBe('delete');
    expect(structureActionForEvent(key('d', { metaKey: true }))?.id).toBe('duplicate');
    expect(structureActionForEvent(key('D', { ctrlKey: true }))?.id).toBe('duplicate');
    expect(structureActionForEvent(key('ArrowUp', { altKey: true }))?.id).toBe('moveEarlier');
    expect(structureActionForEvent(key('ArrowDown', { altKey: true }))?.id).toBe('moveLater');
  });

  it('leaves nudges, plain letters and other combos alone', () => {
    expect(structureActionForEvent(key('ArrowUp'))).toBeNull();
    expect(structureActionForEvent(key('ArrowDown', { shiftKey: true }))).toBeNull();
    expect(structureActionForEvent(key('d'))).toBeNull();
    expect(structureActionForEvent(key('d', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(structureActionForEvent(key('Backspace', { metaKey: true }))).toBeNull();
    expect(structureActionForEvent(key('ArrowUp', { altKey: true, metaKey: true }))).toBeNull();
  });
});

describe('STRUCTURE_ACTIONS', () => {
  it('builds the server op with the rendered instance count', () => {
    const ops = Object.fromEntries(STRUCTURE_ACTIONS.map((action) => [action.id, action.op(3)]));
    expect(ops).toEqual({
      delete: { kind: 'remove-element', instanceCount: 3 },
      duplicate: { kind: 'duplicate-element', instanceCount: 3 },
      moveEarlier: { kind: 'move-element', direction: 'earlier', instanceCount: 3 },
      moveLater: { kind: 'move-element', direction: 'later', instanceCount: 3 },
    });
  });

  it('has a label for every action', () => {
    for (const action of STRUCTURE_ACTIONS) expect(en.inspector[action.label]).toBeTruthy();
  });
});

describe('refusalMessage', () => {
  it('localises server refusal codes and ignores unknown ones', () => {
    expect(refusalMessage(en.inspector, 'no-sibling')).toBe(
      en.inspector.structureRefusals.noSibling,
    );
    expect(refusalMessage(en.inspector, 'map')).toBe(en.inspector.structureRefusals.map);
    expect(refusalMessage(en.inspector, 'nope')).toBeNull();
    expect(refusalMessage(en.inspector, undefined)).toBeNull();
  });
});
