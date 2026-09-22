import { describe, expect, it } from 'vitest';
import { parseSource } from './babel-walk.ts';
import { applyEditBatch } from './batch-edit.ts';
import { applyEdit, type EditOp } from './edit-ops.ts';
import { stepInfo } from './steps-ops.ts';

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
  expect(parseSource(result.source)).not.toBeNull();
  return result;
}

function refusal(result: ReturnType<typeof applyEdit>) {
  if (result.ok) throw new Error('expected a refusal');
  return result.code;
}

function info(source: string, needle: string, instanceCount = 1) {
  const ast = parseSource(source);
  if (!ast) throw new Error('parse');
  const { line, column } = locate(source, needle);
  return stepInfo(ast, source, line, column, instanceCount);
}

const plain = lines(
  "import type { Page } from '@open-slide/core';",
  '',
  'const Cover: Page = () => (',
  '  <div style={{ padding: 40 }}>',
  '    <h1>Title</h1>',
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

const stepped = lines(
  "import { Step, Steps } from '@open-slide/core';",
  '',
  'const Cover = () => (',
  '  <div>',
  '    <Steps>',
  '      <h1>Title</h1>',
  '      <Step>',
  '        <p>One</p>',
  '      </Step>',
  '      <Step duration={400}>',
  '        <p>Two</p>',
  '      </Step>',
  '      <p>Three</p>',
  '    </Steps>',
  '  </div>',
  ');',
  '',
  'export default [Cover];',
  '',
);

describe('wrap-in-step', () => {
  it('turns a plain host parent into <Steps> and wraps the element in <Step>', () => {
    const r = ok(run(plain, '<p style', { kind: 'wrap-in-step' }));
    expect(r.source).toBe(
      lines(
        "import type { Page } from '@open-slide/core';",
        "import { Step, Steps } from '@open-slide/core';",
        '',
        'const Cover: Page = () => (',
        '  <div style={{ padding: 40 }}>',
        '    <Steps>',
        '      <h1>Title</h1>',
        '      <Step>',
        '        <p style={{ fontSize: 24 }}>',
        '          Body',
        '        </p>',
        '      </Step>',
        '      <footer>End</footer>',
        '    </Steps>',
        '  </div>',
        ');',
        '',
        'export default [Cover];',
        '',
      ),
    );
    expect(r.location).toEqual(locate(r.source, '<p style'));
  });

  it('wraps the first child of the run', () => {
    const r = ok(run(plain, '<h1>', { kind: 'wrap-in-step' }));
    expect(r.source).toContain(
      lines(
        '  <div style={{ padding: 40 }}>',
        '    <Steps>',
        '      <Step>',
        '        <h1>Title</h1>',
        '      </Step>',
        '      <p style={{ fontSize: 24 }}>',
        '        Body',
        '      </p>',
        '      <footer>End</footer>',
        '    </Steps>',
        '  </div>',
      ),
    );
    expect(r.location).toEqual(locate(r.source, '<h1>'));
  });

  it('only wraps in <Step> when the parent already is <Steps>', () => {
    const r = ok(run(stepped, '<p>Three', { kind: 'wrap-in-step' }));
    expect(r.source).toBe(
      stepped.replace(
        '      <p>Three</p>',
        lines('      <Step>', '        <p>Three</p>', '      </Step>'),
      ),
    );
    expect(r.location).toEqual(locate(r.source, '<p>Three'));
  });

  it('merges into an existing named import instead of adding a line', () => {
    const source = plain.replace(
      "import type { Page } from '@open-slide/core';",
      "import { Notes } from '@open-slide/core';",
    );
    const r = ok(run(source, '<footer>', { kind: 'wrap-in-step' }));
    expect(r.source.startsWith("import { Notes, Step, Steps } from '@open-slide/core';\n\n")).toBe(
      true,
    );
  });

  it('adds only the missing name to a multi-line import', () => {
    const source = lines(
      'import {',
      '  Notes,',
      '  Steps,',
      "} from '@open-slide/core';",
      '',
      'export default [() => (',
      '  <Steps>',
      '    <p>a</p>',
      '  </Steps>',
      ')];',
      '',
    );
    const r = ok(run(source, '<p>', { kind: 'wrap-in-step' }));
    expect(r.source).toBe(
      lines(
        'import {',
        '  Notes,',
        '  Steps,',
        '  Step,',
        "} from '@open-slide/core';",
        '',
        'export default [() => (',
        '  <Steps>',
        '    <Step>',
        '      <p>a</p>',
        '    </Step>',
        '  </Steps>',
        ')];',
        '',
      ),
    );
  });

  it('adds an import at the top of a file without imports', () => {
    const source = lines(
      'export default [() => (',
      '  <div>',
      '    <p>a</p>',
      '  </div>',
      ')];',
      '',
    );
    const r = ok(run(source, '<p>', { kind: 'wrap-in-step' }));
    expect(r.source).toBe(
      lines(
        "import { Step, Steps } from '@open-slide/core';",
        'export default [() => (',
        '  <div>',
        '    <Steps>',
        '      <Step>',
        '        <p>a</p>',
        '      </Step>',
        '    </Steps>',
        '  </div>',
        ')];',
        '',
      ),
    );
  });

  it('uses aliased imports', () => {
    const source = lines(
      "import { Step as Reveal, Steps as Reveals } from '@open-slide/core';",
      'export default [() => (',
      '  <div>',
      '    <p>a</p>',
      '  </div>',
      ')];',
      '',
    );
    const r = ok(run(source, '<p>', { kind: 'wrap-in-step' }));
    expect(r.source).toContain(
      lines(
        '    <Reveals>',
        '      <Reveal>',
        '        <p>a</p>',
        '      </Reveal>',
        '    </Reveals>',
      ),
    );
    expect(r.source.split('\n')[0]).toBe(
      "import { Step as Reveal, Steps as Reveals } from '@open-slide/core';",
    );
  });

  it('wraps inline children without adding lines', () => {
    const source = lines(
      "import { Step, Steps } from '@open-slide/core';",
      'export default [() => <ul><li>a</li><li>b</li></ul>];',
      '',
    );
    const r = ok(run(source, '<li>b', { kind: 'wrap-in-step' }));
    expect(r.source).toBe(
      lines(
        "import { Step, Steps } from '@open-slide/core';",
        'export default [() => <ul><Steps><li>a</li><Step><li>b</li></Step></Steps></ul>];',
        '',
      ),
    );
    expect(r.location).toEqual(locate(r.source, '<li>b'));
  });

  it('keeps tab indentation', () => {
    const source = lines(
      "import { Step, Steps } from '@open-slide/core';",
      'export default [() => (',
      '\t<Steps>',
      '\t\t<p>',
      '\t\t\ta',
      '\t\t</p>',
      '\t</Steps>',
      ')];',
      '',
    );
    const r = ok(run(source, '<p>', { kind: 'wrap-in-step' }));
    expect(r.source).toContain(
      lines(
        '\t<Steps>',
        '\t\t<Step>',
        '\t\t\t<p>',
        '\t\t\t\ta',
        '\t\t\t</p>',
        '\t\t</Step>',
        '\t</Steps>',
      ),
    );
  });

  it('does not re-indent lines inside template literals or blank lines', () => {
    const source = lines(
      "import { Step, Steps } from '@open-slide/core';",
      'export default [() => (',
      '  <Steps>',
      '    <pre>',
      '      {`line one',
      'line two`}',
      '',
      '    </pre>',
      '  </Steps>',
      ')];',
      '',
    );
    const r = ok(run(source, '<pre>', { kind: 'wrap-in-step' }));
    expect(r.source).toContain(
      lines(
        '  <Steps>',
        '    <Step>',
        '      <pre>',
        '        {`line one',
        'line two`}',
        '',
        '      </pre>',
        '    </Step>',
        '  </Steps>',
      ),
    );
  });

  it.each([
    ['an element already inside a <Step>', stepped, '<p>One', 1, 'already-step'],
    [
      'a parent with text children',
      'export default [() => <div>\n  hi\n  <p>a</p>\n</div>];\n',
      '<p>',
      1,
      'mixed-children',
    ],
    [
      'a parent with expression children',
      'export default [() => <div>\n  {x}\n  <p>a</p>\n</div>];\n',
      '<p>',
      1,
      'mixed-children',
    ],
    [
      'a fragment parent',
      'export default [() => <>\n  <p>a</p>\n</>];\n',
      '<p>',
      1,
      'parent-not-host',
    ],
    [
      'a component parent',
      'export default [() => <Card>\n  <p>a</p>\n</Card>];\n',
      '<p>',
      1,
      'parent-not-host',
    ],
    [
      'a local Step binding',
      'const Step = () => null;\nexport default [() => <div>\n  <p>a</p>\n</div>];\n',
      '<p>',
      1,
      'name-conflict',
    ],
    [
      'a .map() template',
      'export default [() => <div>{xs.map((x) => <p key={x}>{x}</p>)}</div>];\n',
      '<p',
      1,
      'map',
    ],
    [
      'a conditional',
      'export default [() => <div>{c && <p>a</p>}</div>];\n',
      '<p>',
      1,
      'conditional',
    ],
    ['a shared element', plain, '<h1>', 2, 'shared'],
    ['the page root', plain, '<div', 1, 'root'],
    [
      'a sibling holding a comment marker',
      'export default [() => <div>\n  <p>a</p>\n  <p>{/* @slide-comment x */}b</p>\n</div>];\n',
      '<p>a',
      1,
      'comment',
    ],
  ])('refuses %s and leaves the file alone', (_label, source, needle, instanceCount, code) => {
    expect(refusal(run(source, needle, { kind: 'wrap-in-step', instanceCount }))).toBe(code);
  });
});

describe('unwrap-step', () => {
  it('is the byte-exact inverse of wrapping inside <Steps>', () => {
    const wrapped = ok(run(stepped, '<p>Three', { kind: 'wrap-in-step' }));
    const r = ok(run(wrapped.source, '<p>Three', { kind: 'unwrap-step' }));
    expect(r.source).toBe(stepped);
    expect(r.location).toEqual(locate(stepped, '<p>Three'));
  });

  it('drops the step and its duration, dedenting only the element', () => {
    const r = ok(run(stepped, '<p>Two', { kind: 'unwrap-step' }));
    expect(r.source).toBe(
      stepped.replace(
        lines('      <Step duration={400}>', '        <p>Two</p>', '      </Step>'),
        '      <p>Two</p>',
      ),
    );
  });

  it('unwraps inline steps', () => {
    const source = lines(
      "import { Step, Steps } from '@open-slide/core';",
      'export default [() => <ul><Steps><Step><li>a</li></Step></Steps></ul>];',
      '',
    );
    const r = ok(run(source, '<li>', { kind: 'unwrap-step' }));
    expect(r.source).toContain('<ul><Steps><li>a</li></Steps></ul>');
  });

  it('refuses a step with several children', () => {
    const source = stepped.replace('        <p>One</p>', '        <p>One</p>\n        <p>Uno</p>');
    expect(refusal(run(source, '<p>One', { kind: 'unwrap-step' }))).toBe('step-has-siblings');
  });

  it('refuses an element that is not a step', () => {
    expect(refusal(run(stepped, '<p>Three', { kind: 'unwrap-step' }))).toBe('not-step');
  });
});

describe('move-step', () => {
  it('swaps a step with the previous step, skipping non-step children', () => {
    const r = ok(run(stepped, '<p>Two', { kind: 'move-step', direction: 'earlier' }));
    expect(r.source).toBe(
      stepped
        .replace('<Step>\n        <p>One</p>', '<Step duration={400}>\n        <p>TMP</p>')
        .replace('<Step duration={400}>\n        <p>Two</p>', '<Step>\n        <p>One</p>')
        .replace('<p>TMP</p>', '<p>Two</p>'),
    );
    expect(r.location).toEqual(locate(r.source, '<p>Two'));
  });

  it('moves later and reports the new location', () => {
    const r = ok(run(stepped, '<p>One', { kind: 'move-step', direction: 'later' }));
    expect(r.source.indexOf('<p>Two')).toBeLessThan(r.source.indexOf('<p>One'));
    expect(r.source.indexOf('<p>One')).toBeLessThan(r.source.indexOf('<p>Three'));
    expect(r.location).toEqual(locate(r.source, '<p>One'));
  });

  it('keeps the location right when both steps have identical source', () => {
    const source = stepped.replace('<Step duration={400}>', '<Step>').replace('<p>Two', '<p>One');
    const second = source.indexOf('<p>One', source.indexOf('<p>One') + 1);
    const at = locate(source, '<p>One', second);
    const r = ok(
      applyEdit(source, at.line, at.column, [{ kind: 'move-step', direction: 'earlier' }]),
    );
    expect(r.location).toEqual(locate(r.source, '<p>One'));
  });

  it('refuses when there is no step in that direction', () => {
    expect(refusal(run(stepped, '<p>One', { kind: 'move-step', direction: 'earlier' }))).toBe(
      'no-step-sibling',
    );
    expect(refusal(run(stepped, '<p>Two', { kind: 'move-step', direction: 'later' }))).toBe(
      'no-step-sibling',
    );
  });

  it('refuses a non-step element', () => {
    expect(refusal(run(stepped, '<p>Three', { kind: 'move-step', direction: 'earlier' }))).toBe(
      'not-step',
    );
  });
});

describe('set-step-duration', () => {
  it('adds a duration attribute', () => {
    const r = ok(run(stepped, '<p>One', { kind: 'set-step-duration', value: 250 }));
    expect(r.source).toBe(
      stepped.replace('<Step>\n        <p>One', '<Step duration={250}>\n        <p>One'),
    );
    expect(r.location).toEqual(locate(r.source, '<p>One'));
  });

  it('replaces an existing duration and rounds it', () => {
    const r = ok(run(stepped, '<p>Two', { kind: 'set-step-duration', value: 99.6 }));
    expect(r.source).toBe(stepped.replace('duration={400}', 'duration={100}'));
  });

  it('removes the attribute on null', () => {
    const r = ok(run(stepped, '<p>Two', { kind: 'set-step-duration', value: null }));
    expect(r.source).toBe(stepped.replace('<Step duration={400}>', '<Step>'));
  });

  it('reports the shifted location of an inline element', () => {
    const source = lines(
      "import { Step, Steps } from '@open-slide/core';",
      'export default [() => <ul><Steps><Step><li>a</li></Step></Steps></ul>];',
      '',
    );
    const r = ok(run(source, '<li>', { kind: 'set-step-duration', value: 50 }));
    expect(r.source).toContain('<Step duration={50}><li>a</li></Step>');
    expect(r.location).toEqual(locate(r.source, '<li>'));
  });

  it.each([-1, Number.NaN, 60001, '300'])('refuses %s', (value) => {
    expect(
      refusal(run(stepped, '<p>One', { kind: 'set-step-duration', value: value as number })),
    ).toBe('invalid-duration');
  });

  it('refuses a non-step element', () => {
    expect(refusal(run(stepped, '<p>Three', { kind: 'set-step-duration', value: 1 }))).toBe(
      'not-step',
    );
  });
});

describe('stepInfo', () => {
  it('reports index, count, duration and available actions for a step', () => {
    expect(info(stepped, '<p>Two')).toEqual({
      inStep: true,
      index: 2,
      count: 2,
      duration: 400,
      actions: {
        wrap: 'already-step',
        unwrap: null,
        earlier: null,
        later: 'no-step-sibling',
        duration: null,
      },
    });
  });

  it('reports a plain element as wrappable', () => {
    expect(info(stepped, '<p>Three')).toEqual({
      inStep: false,
      index: null,
      count: null,
      duration: null,
      actions: {
        wrap: null,
        unwrap: 'not-step',
        earlier: 'not-step',
        later: 'not-step',
        duration: 'not-step',
      },
    });
  });

  it('passes the instance count to every action', () => {
    expect(Object.values(info(stepped, '<p>Two', 2).actions)).toEqual(Array(5).fill('shared'));
  });
});

describe('batch', () => {
  it('refuses a step op mixed with other edits', () => {
    const at = locate(stepped, '<p>Three');
    const { source, results } = applyEditBatch(stepped, [
      { ...at, ops: [{ kind: 'wrap-in-step' }] },
      { ...at, ops: [{ kind: 'set-style', key: 'color', value: 'red' }] },
    ]);
    expect(source).toBe(stepped);
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('returns the location and refusal code of a lone step edit', () => {
    const at = locate(stepped, '<p>Three');
    const wrapped = applyEditBatch(stepped, [{ ...at, ops: [{ kind: 'wrap-in-step' }] }]);
    expect(wrapped.results[0]).toEqual({ ok: true, location: locate(wrapped.source, '<p>Three') });
    const again = applyEditBatch(stepped, [{ ...at, ops: [{ kind: 'unwrap-step' }] }]);
    expect(again.results[0]).toMatchObject({ ok: false, code: 'not-step' });
  });
});
