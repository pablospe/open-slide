import { describe, expect, it } from 'vitest';
import { applyEdit } from '../../../editing/edit-ops.ts';
import {
  clearLayoutOps,
  GESTURE_STYLE_KEYS,
  LAYER_INSET_KEYS,
  SIZE_CONSTRAINT_STYLES,
} from './visual-dom.ts';

const cleared = (inline: Record<string, string>, scope: 'transform' | 'all') =>
  clearLayoutOps(inline, scope).flatMap((op) =>
    op.kind === 'set-style' ? [[op.key, op.value] as const] : [],
  );

describe('GESTURE_STYLE_KEYS', () => {
  it('lists every key the visual editor writes, once', () => {
    expect(new Set(GESTURE_STYLE_KEYS).size).toBe(GESTURE_STYLE_KEYS.length);
    expect(GESTURE_STYLE_KEYS).toEqual(
      expect.arrayContaining([
        'translate',
        'rotate',
        'width',
        'height',
        ...Object.keys(SIZE_CONSTRAINT_STYLES),
        'position',
        ...LAYER_INSET_KEYS,
        'zIndex',
      ]),
    );
  });
});

describe('clearLayoutOps', () => {
  const dragged = {
    translate: '40px 12px',
    rotate: '15deg',
    width: '320px',
    height: '180px',
    minWidth: '0px',
    maxWidth: 'none',
    flexShrink: '0',
    flexBasis: 'auto',
    position: 'relative',
    top: 'auto',
    left: 'auto',
    zIndex: '2',
    color: 'red',
  };

  it('clears only translate and rotate by default', () => {
    expect(cleared(dragged, 'transform')).toEqual([
      ['translate', null],
      ['rotate', null],
    ]);
  });

  it('clears the full gesture key set and leaves unrelated keys alone', () => {
    const keys = cleared(dragged, 'all').map(([key]) => key);
    expect(keys).toEqual([
      'translate',
      'rotate',
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'flexShrink',
      'flexBasis',
      'position',
      'top',
      'left',
      'zIndex',
    ]);
    expect(keys).not.toContain('color');
    expect(clearLayoutOps(dragged, 'all').every((op) => 'value' in op && op.value === null)).toBe(
      true,
    );
  });

  it('keeps fixed-value keys the author set to something else', () => {
    expect(
      cleared(
        { position: 'absolute', top: '120px', maxWidth: '600px', flexGrow: '1', minHeight: '0px' },
        'all',
      ),
    ).toEqual([['minHeight', null]]);
  });

  it('returns nothing when no gesture key is present', () => {
    expect(clearLayoutOps({ color: 'red', translate: '', rotate: '  ' }, 'transform')).toEqual([]);
    expect(clearLayoutOps({}, 'all')).toEqual([]);
  });
});

describe('clearLayoutOps applied to source', () => {
  const src = [
    'export default [() => (',
    "<div className=\"card\" style={{ color: 'red', translate: '40px 12px', rotate: '15deg', width: '320px', zIndex: '2' }} data-x=\"1\">",
    '  <p>Keep me</p>',
    '</div>',
    ')];',
    '',
  ].join('\n');
  const inline = { translate: '40px 12px', rotate: '15deg', width: '320px', zIndex: '2' };

  it('removes translate and rotate and leaves the other lines byte-identical', () => {
    const r = applyEdit(src, 2, 0, clearLayoutOps(inline, 'transform'));
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    const lines = src.split('\n');
    lines[1] = `<div className="card" data-x="1" style={{ color: 'red', width: '320px', zIndex: '2' }}>`;
    expect(r.source).toBe(lines.join('\n'));
  });

  it('drops the style attribute once every key is a gesture key', () => {
    const only = src.replace("color: 'red', ", '');
    const r = applyEdit(only, 2, 0, clearLayoutOps(inline, 'all'));
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<div className="card" data-x="1">');
    expect(r.source).toContain('  <p>Keep me</p>');
  });

  it('shadows gesture keys that come from a spread instead of guessing at the spread', () => {
    const spread = src.replace("color: 'red', ", '...base, ');
    const r = applyEdit(spread, 2, 0, clearLayoutOps({ translate: '40px 12px' }, 'transform'));
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('...base');
    expect(r.source).toContain('translate: undefined');
  });
});
