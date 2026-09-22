import { describe, expect, it } from 'vitest';
import { parseSource } from './babel-walk.ts';
import { applyEditBatch } from './batch-edit.ts';
import { applyEdit, type EditOp } from './edit-ops.ts';

const lines = (...rows: string[]) => rows.join('\n');

function locate(source: string, needle: string, from = 0) {
  const offset = source.indexOf(needle, from);
  if (offset === -1) throw new Error(`missing ${needle}`);
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') - 1 };
}

function run(source: string, needle: string, op: EditOp) {
  const { line, column } = locate(source, needle);
  return applyEdit(source, line, column, [op]);
}

function ok(result: ReturnType<typeof applyEdit>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result;
}

function refused(result: ReturnType<typeof applyEdit>) {
  if (result.ok) throw new Error('expected a refusal');
  return result;
}

const deck = lines(
  'const Cover = () => (',
  '  <div style={{ padding: 40 }}>',
  '    <h1>Title</h1>',
  '    {/* keep */}',
  '    <p style={{ fontSize: 24 }}>',
  '      Body',
  '    </p>',
  '    <footer>End</footer>',
  '  </div>',
  ');',
  '',
  'export default [Cover];',
  '',
);

describe('remove-element', () => {
  it('removes a middle child with its line and nothing else', () => {
    const r = ok(run(deck, '<p style', { kind: 'remove-element' }));
    expect(r.source).toBe(
      lines(
        'const Cover = () => (',
        '  <div style={{ padding: 40 }}>',
        '    <h1>Title</h1>',
        '    {/* keep */}',
        '    <footer>End</footer>',
        '  </div>',
        ');',
        '',
        'export default [Cover];',
        '',
      ),
    );
  });

  it('removes the first and the last child without leaving a blank line', () => {
    const first = ok(run(deck, '<h1>', { kind: 'remove-element' }));
    expect(first.source).toBe(deck.replace('    <h1>Title</h1>\n', ''));
    const last = ok(run(deck, '<footer>', { kind: 'remove-element' }));
    expect(last.source).toBe(deck.replace('    <footer>End</footer>\n', ''));
  });

  it('removes an inline element and one of its surrounding spaces', () => {
    const src = lines(
      'export default [() => (',
      '  <p>Hello <b>bold</b> world <i>x</i></p>',
      ')];',
      '',
    );
    expect(ok(run(src, '<b>', { kind: 'remove-element' })).source).toBe(
      src.replace('<b>bold</b> ', ''),
    );
    expect(ok(run(src, '<i>', { kind: 'remove-element' })).source).toBe(
      src.replace('<i>x</i>', ''),
    );
  });

  it('keeps tabs and CRLF-free formatting outside the removed line untouched', () => {
    const src = lines(
      'export default [() => (',
      '\t<div>',
      '\t\t<span a="1"   b="2" />',
      '\t\t<em>x</em>',
      '\t</div>',
      ')];',
    );
    expect(ok(run(src, '<em>', { kind: 'remove-element' })).source).toBe(
      src.replace('\t\t<em>x</em>\n', ''),
    );
  });
});

describe('duplicate-element', () => {
  it('inserts a verbatim copy after a multi-line element and returns its location', () => {
    const r = ok(run(deck, '<p style', { kind: 'duplicate-element' }));
    const copy = '    <p style={{ fontSize: 24 }}>\n      Body\n    </p>';
    expect(r.source).toBe(deck.replace(copy, `${copy}\n${copy}`));
    const second = r.source.indexOf('<p style', r.source.indexOf('<p style') + 1);
    expect(r.location).toEqual(locate(r.source, '<p style', second));
    expect(r.location).toEqual({ line: 8, column: 4 });
  });

  it('copies an inline element with the space that precedes it', () => {
    const src = lines('export default [() => (', '  <p>a <b>b</b></p>', ')];');
    const r = ok(run(src, '<b>', { kind: 'duplicate-element' }));
    expect(r.source).toBe(src.replace('<b>b</b>', '<b>b</b> <b>b</b>'));
    expect(r.location).toEqual({ line: 2, column: 16 });
  });

  it("strips every id and the copied element's own key", () => {
    const src = lines(
      'export default [() => (',
      '  <div>',
      '    <section id="intro" key="k" className="x">',
      '      <h2 id={"t"}>T</h2>',
      '    </section>',
      '  </div>',
      ')];',
    );
    const r = ok(run(src, '<section', { kind: 'duplicate-element' }));
    const original =
      '    <section id="intro" key="k" className="x">\n      <h2 id={"t"}>T</h2>\n    </section>';
    const copy = '    <section className="x">\n      <h2>T</h2>\n    </section>';
    expect(r.source).toBe(src.replace(original, `${original}\n${copy}`));
  });
});

describe('duplicate-element keys', () => {
  it('keeps keys of lists mapped inside the copy', () => {
    const src = lines(
      'export default [() => (',
      '  <div>',
      '    <ul>',
      '      {items.map((i) => <li key={i}>{i}</li>)}',
      '    </ul>',
      '  </div>',
      ')];',
    );
    const r = ok(run(src, '<ul>', { kind: 'duplicate-element' }));
    const list = '    <ul>\n      {items.map((i) => <li key={i}>{i}</li>)}\n    </ul>';
    expect(r.source).toBe(src.replace(list, `${list}\n${list}`));
  });
});

describe('move-element', () => {
  it('swaps with the next element, leaving the separator and comments in place', () => {
    const r = ok(run(deck, '<h1>', { kind: 'move-element', direction: 'later' }));
    expect(r.source).toBe(
      lines(
        'const Cover = () => (',
        '  <div style={{ padding: 40 }}>',
        '    <p style={{ fontSize: 24 }}>',
        '      Body',
        '    </p>',
        '    {/* keep */}',
        '    <h1>Title</h1>',
        '    <footer>End</footer>',
        '  </div>',
        ');',
        '',
        'export default [Cover];',
        '',
      ),
    );
    expect(r.location).toEqual({ line: 7, column: 4 });
  });

  it('swaps with the previous element and reports the new start', () => {
    const r = ok(run(deck, '<footer>', { kind: 'move-element', direction: 'earlier' }));
    expect(r.source).toBe(
      deck.replace(
        '    <p style={{ fontSize: 24 }}>\n      Body\n    </p>\n    <footer>End</footer>',
        '    <footer>End</footer>\n    <p style={{ fontSize: 24 }}>\n      Body\n    </p>',
      ),
    );
    expect(r.location).toEqual({ line: 5, column: 4 });
  });

  it('refuses at the edges and next to text or expressions', () => {
    expect(refused(run(deck, '<h1>', { kind: 'move-element', direction: 'earlier' })).code).toBe(
      'no-sibling',
    );
    expect(refused(run(deck, '<footer>', { kind: 'move-element', direction: 'later' })).code).toBe(
      'no-sibling',
    );
    const src = lines('export default [() => (', '  <p>a <b>b</b> {x}</p>', ')];');
    expect(refused(run(src, '<b>', { kind: 'move-element', direction: 'earlier' })).code).toBe(
      'sibling-not-element',
    );
    expect(refused(run(src, '<b>', { kind: 'move-element', direction: 'later' })).code).toBe(
      'sibling-not-element',
    );
  });
});

describe('structural refusals', () => {
  const all: EditOp[] = [
    { kind: 'remove-element' },
    { kind: 'duplicate-element' },
    { kind: 'move-element', direction: 'later' },
  ];

  function expectRefused(src: string, needle: string, code: string) {
    for (const op of all) {
      const r = refused(run(src, needle, op));
      expect(r.code).toBe(code);
    }
  }

  it('refuses the page root', () => {
    expectRefused(deck, '<div style', 'root');
  });

  it('refuses a conditional element', () => {
    const src = lines(
      'export default [() => (',
      '  <div>',
      '    {show && <b>x</b>}',
      '    {show ? <i>y</i> : null}',
      '  </div>',
      ')];',
    );
    expectRefused(src, '<b>', 'conditional');
    expectRefused(src, '<i>', 'conditional');
  });

  it('refuses the sole child of an expression container', () => {
    const src = lines('export default [() => (', '  <div icon={<b>x</b>}>', '  </div>', ')];');
    expectRefused(src, '<b>', 'expression');
  });

  it('refuses elements inside a .map() callback, even nested in JSX', () => {
    const src = lines(
      'export default [() => (',
      '  <ul>',
      '    {items.map((item) => (',
      '      <li key={item}>',
      '        <span>{item}</span>',
      '      </li>',
      '    ))}',
      '  </ul>',
      ')];',
    );
    expectRefused(src, '<li', 'map');
    expectRefused(src, '<span>', 'map');
  });

  it('refuses an element that contains an inspector comment', () => {
    const src = lines(
      'export default [() => (',
      '  <div>',
      '    <p>',
      '      {/* @slide-comment id="c-1234abcd" ts="2026-01-01T00:00:00.000Z" text="eyJ9" */}',
      '      Hi',
      '    </p>',
      '    <span />',
      '  </div>',
      ')];',
    );
    expectRefused(src, '<p>', 'comment');
  });

  it('refuses when the client reports several rendered instances', () => {
    for (const op of all) {
      const r = refused(run(deck, '<h1>', { ...op, instanceCount: 2 } as EditOp));
      expect(r.code).toBe('shared');
    }
  });

  it('refuses inside a component rendered at more than one call site', () => {
    const src = lines(
      'const Card = () => (',
      '  <div>',
      '    <b>x</b>',
      '    <i>y</i>',
      '  </div>',
      ');',
      'export default [() => (',
      '  <div>',
      '    <Card />',
      '    <Card />',
      '  </div>',
      ')];',
    );
    expectRefused(src, '<b>', 'shared');
  });

  it('never falls back to an enclosing element', () => {
    const { line } = locate(deck, '<h1>');
    const r = refused(applyEdit(deck, line, 8, [{ kind: 'remove-element' }]));
    expect(r.code).toBe('not-found');
  });

  it('rejects a structural op mixed with other ops', () => {
    const { line, column } = locate(deck, '<h1>');
    const r = refused(
      applyEdit(deck, line, column, [
        { kind: 'remove-element' },
        { kind: 'set-style', key: 'color', value: 'red' },
      ]),
    );
    expect(r.status).toBe(400);
  });

  it('keeps every result parseable', () => {
    for (const needle of ['<h1>', '<p style', '<footer>']) {
      for (const op of all) {
        const r = run(deck, needle, op);
        if (r.ok) expect(parseSource(r.source)).not.toBeNull();
      }
    }
  });
});

describe('applyEditBatch with structural ops', () => {
  it('applies a lone structural edit and returns the copy location', () => {
    const { line, column } = locate(deck, '<h1>');
    const { source, results } = applyEditBatch(deck, [
      { line, column, ops: [{ kind: 'duplicate-element' }] },
    ]);
    expect(source).toBe(deck.replace('<h1>Title</h1>', '<h1>Title</h1>\n    <h1>Title</h1>'));
    expect(results).toEqual([{ ok: true, location: { line: 4, column: 4 } }]);
  });

  it('refuses a structural edit batched with anything else, leaving the source untouched', () => {
    const h1 = locate(deck, '<h1>');
    const footer = locate(deck, '<footer>');
    const { source, results } = applyEditBatch(deck, [
      { ...h1, ops: [{ kind: 'set-style', key: 'color', value: 'red' }] },
      { ...footer, ops: [{ kind: 'remove-element' }] },
    ]);
    expect(source).toBe(deck);
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('reports malformed ops per edit instead of throwing', () => {
    const h1 = locate(deck, '<h1>');
    const { results } = applyEditBatch(deck, [
      { ...h1, ops: 'nope' as unknown as EditOp[] },
      { ...h1, ops: [null as unknown as EditOp] },
    ]);
    expect(results).toEqual([
      { ok: false, error: 'invalid edit' },
      { ok: false, error: 'invalid edit' },
    ]);
  });

  it('reports the refusal code', () => {
    const root = locate(deck, '<div style');
    const { results } = applyEditBatch(deck, [{ ...root, ops: [{ kind: 'remove-element' }] }]);
    expect(results[0]).toMatchObject({ ok: false, code: 'root' });
  });
});
