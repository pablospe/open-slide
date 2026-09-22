import { describe, expect, it } from 'vitest';
import { en } from '../../../locale/en';
import { refusalMessage, STRUCTURE_OPS } from './structure-actions';

describe('STRUCTURE_OPS', () => {
  it('builds the server op with the rendered instance count', () => {
    const ops = Object.fromEntries(Object.entries(STRUCTURE_OPS).map(([id, op]) => [id, op(3)]));
    expect(ops).toEqual({
      delete: { kind: 'remove-element', instanceCount: 3 },
      duplicate: { kind: 'duplicate-element', instanceCount: 3 },
      moveEarlier: { kind: 'move-element', direction: 'earlier', instanceCount: 3 },
      moveLater: { kind: 'move-element', direction: 'later', instanceCount: 3 },
    });
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
