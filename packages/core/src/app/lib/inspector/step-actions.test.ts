import { describe, expect, it } from 'vitest';
import { en } from '../../../locale/en';
import { isWrapShortcut, parseDurationInput, stepOp, stepRefusalMessage } from './step-actions';

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

describe('isWrapShortcut', () => {
  it('matches Cmd/Ctrl+Shift+S', () => {
    expect(isWrapShortcut(key('S', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(isWrapShortcut(key('s', { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it('leaves save and other combos alone', () => {
    expect(isWrapShortcut(key('s', { metaKey: true }))).toBe(false);
    expect(isWrapShortcut(key('s', { shiftKey: true }))).toBe(false);
    expect(isWrapShortcut(key('s', { metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });
});

describe('stepOp', () => {
  it('builds each op with the instance count', () => {
    expect(stepOp('wrap', 1)).toEqual({ kind: 'wrap-in-step', instanceCount: 1 });
    expect(stepOp('unwrap', 2)).toEqual({ kind: 'unwrap-step', instanceCount: 2 });
    expect(stepOp('earlier', 1)).toEqual({
      kind: 'move-step',
      direction: 'earlier',
      instanceCount: 1,
    });
    expect(stepOp('later', 1)).toEqual({ kind: 'move-step', direction: 'later', instanceCount: 1 });
    expect(stepOp('duration', 1, 300)).toEqual({
      kind: 'set-step-duration',
      value: 300,
      instanceCount: 1,
    });
    expect(stepOp('duration', 1, null)).toEqual({
      kind: 'set-step-duration',
      value: null,
      instanceCount: 1,
    });
  });
});

describe('parseDurationInput', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['250', 250],
    ['99.6', 100],
    ['0', 0],
    ['-1', 'invalid'],
    ['abc', 'invalid'],
    ['60001', 'invalid'],
  ])('%j → %j', (raw, expected) => {
    expect(parseDurationInput(raw)).toBe(expected);
  });
});

describe('stepRefusalMessage', () => {
  it('localises step refusals and ignores others', () => {
    expect(stepRefusalMessage(en.inspector, 'mixed-children')).toBe(
      en.inspector.stepRefusals.mixedChildren,
    );
    expect(stepRefusalMessage(en.inspector, 'root')).toBe(en.inspector.stepRefusals.root);
    expect(stepRefusalMessage(en.inspector, 'shared')).toBeNull();
    expect(stepRefusalMessage(en.inspector, null)).toBeNull();
  });
});
