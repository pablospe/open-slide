import { describe, expect, it } from 'vitest';
import { parseSource } from './babel-walk.ts';
import { applyEditBatch } from './batch-edit.ts';
import { applyEdit, type EditOp, findJsxByStart } from './edit-ops.ts';
import type { InsertSnippetOp } from './insert-ops.ts';
import { renderSnippetTsx, SNIPPETS } from './snippets.ts';

const lines = (...rows: string[]) => rows.join('\n');

function locate(source: string, needle: string) {
  const offset = source.indexOf(needle);
  if (offset === -1) throw new Error(`missing ${needle}`);
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') - 1 };
}

function insertAfter(source: string, needle: string, op: Partial<InsertSnippetOp>) {
  const { line, column } = locate(source, needle);
  return applyEdit(source, line, column, [
    { kind: 'insert-snippet', snippetId: 'heading', position: 'after-selection', ...op } as EditOp,
  ]);
}

function insertAtEnd(source: string, op: Partial<InsertSnippetOp>) {
  return applyEdit(source, 1, 0, [
    { kind: 'insert-snippet', snippetId: 'heading', position: 'end-of-page', ...op } as EditOp,
  ]);
}

function ok(result: ReturnType<typeof applyEdit>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result;
}

function refused(result: ReturnType<typeof applyEdit>) {
  if (result.ok) throw new Error('expected a refusal');
  return result;
}

function tagAt(source: string, location: { line: number; column: number } | undefined) {
  if (!location) throw new Error('missing location');
  const ast = parseSource(source);
  if (!ast) throw new Error('unparsable');
  const node = findJsxByStart(ast, location.line, location.column);
  const name = node?.openingElement.name;
  return name && 'name' in name ? name.name : null;
}

const heading = (indent: string) =>
  lines(
    `${indent}<h2`,
    `${indent}  style={{`,
    `${indent}    margin: 0,`,
    `${indent}    fontFamily: 'var(--osd-font-display)',`,
    `${indent}    fontSize: 96,`,
    `${indent}    fontWeight: 700,`,
    `${indent}    lineHeight: 1.1,`,
    `${indent}    color: 'var(--osd-text)',`,
    `${indent}  }}`,
    `${indent}>`,
    `${indent}  Heading`,
    `${indent}</h2>`,
  );

const deck = lines(
  "import type { Page } from '@open-slide/core';",
  '',
  'const Cover: Page = () => (',
  '  <div style={{ padding: 40 }}>',
  '    <h1>Title</h1>',
  '    <p>Body</p>',
  '  </div>',
  ');',
  '',
  'export default [Cover];',
  '',
);

describe('insert-snippet after the selection', () => {
  it('inserts a heading as the next sibling at the same indentation', () => {
    const r = ok(insertAfter(deck, '<h1>', {}));
    expect(r.source).toBe(
      lines(
        "import type { Page } from '@open-slide/core';",
        '',
        'const Cover: Page = () => (',
        '  <div style={{ padding: 40 }}>',
        '    <h1>Title</h1>',
        heading('    '),
        '    <p>Body</p>',
        '  </div>',
        ');',
        '',
        'export default [Cover];',
        '',
      ),
    );
    expect(r.location).toEqual({ line: 6, column: 4 });
    expect(tagAt(r.source, r.location)).toBe('h2');
  });

  it.each(SNIPPETS.filter((s) => !s.needsAsset).map((s) => [s.id, s] as const))(
    '%s lands after the element and leaves every other byte untouched',
    (id, snippet) => {
      const r = ok(insertAfter(deck, '<p>', { snippetId: id }));
      const at = deck.indexOf('<p>Body</p>') + '<p>Body</p>'.length;
      const inserted = `\n    ${renderSnippetTsx(snippet, { indent: '    ' })}`;
      expect(r.source).toBe(deck.slice(0, at) + inserted + deck.slice(at));
      expect(tagAt(r.source, r.location)).toBe(snippet.root.tag);
    },
  );

  it('keeps an inline sibling on the same line', () => {
    const source = lines(
      'const A = () => (',
      '  <div>',
      '    <b>x</b> <i>y</i>',
      '  </div>',
      ');',
      'export default [A];',
      '',
    );
    const r = ok(insertAfter(source, '<b>', { snippetId: 'two-column' }));
    expect(r.source.split('\n')[2]).toBe(
      "    <b>x</b> <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64 }}>",
    );
    expect(parseSource(r.source)).not.toBeNull();
  });

  it('uses tabs in a tab-indented file', () => {
    const source = lines(
      'const A = () => (',
      '\t<div>',
      '\t\t<p>Body</p>',
      '\t</div>',
      ');',
      'export default [A];',
      '',
    );
    const r = ok(insertAfter(source, '<p>', { snippetId: 'bullet-list' }));
    expect(r.source).toContain('\t\t<ul\n\t\t\tstyle={{\n\t\t\t\tmargin: 0,');
    expect(r.source).toContain('\t\t\t<li>First point</li>\n');
    expect(r.source).not.toMatch(/^ +</m);
  });
});

describe('insert-snippet at the end of the page', () => {
  it('puts the block inside a selected page root', () => {
    const r = ok(insertAfter(deck, '<div style', { pageIndex: 0 }));
    expect(r.source).toBe(ok(insertAtEnd(deck, { pageIndex: 0 })).source);
    expect(r.location).toEqual({ line: 7, column: 4 });
  });

  it('measures indentation from JSX, not comments or strings', () => {
    const source = lines(
      '/**',
      ' * A doc comment.',
      ' */',
      'const code = `',
      '\tindented sample',
      '`;',
      'const A = () => (',
      '    <div>',
      '        <p>Body</p>',
      '    </div>',
      ');',
      'export default [A];',
      '',
    );
    const r = ok(insertAfter(source, '<p>', { snippetId: 'bullet-list' }));
    expect(r.source).toContain('        <ul\n            style={{\n                margin: 0,');
    expect(r.source).toContain('            <li>First point</li>\n');
  });

  it('appends after the last child of a parenthesised root', () => {
    const r = ok(insertAtEnd(deck, { pageIndex: 0 }));
    expect(r.source).toBe(
      lines(
        "import type { Page } from '@open-slide/core';",
        '',
        'const Cover: Page = () => (',
        '  <div style={{ padding: 40 }}>',
        '    <h1>Title</h1>',
        '    <p>Body</p>',
        heading('    '),
        '  </div>',
        ');',
        '',
        'export default [Cover];',
        '',
      ),
    );
    expect(r.location).toEqual({ line: 7, column: 4 });
  });

  it('opens a self-closing blank page root', () => {
    const source = lines(
      "import type { Page } from '@open-slide/core';",
      '',
      "const Page2: Page = () => <div style={{ width: '100%', height: '100%' }} />;",
      '',
      'export default [Page2];',
      '',
    );
    const r = ok(insertAtEnd(source, { pageIndex: 0 }));
    expect(r.source).toBe(
      lines(
        "import type { Page } from '@open-slide/core';",
        '',
        "const Page2: Page = () => <div style={{ width: '100%', height: '100%' }}>",
        heading('  '),
        '</div>;',
        '',
        'export default [Page2];',
        '',
      ),
    );
    expect(r.location).toEqual({ line: 4, column: 2 });
  });

  it('keeps a multi-line self-closing opening readable', () => {
    const source = lines(
      'const A = () => (',
      '  <div',
      '    style={{ width: 1 }}',
      '  />',
      ');',
      'export default [A];',
      '',
    );
    const r = ok(insertAtEnd(source, { pageIndex: 0, snippetId: 'paragraph' }));
    expect(r.source.split('\n').slice(1, 5)).toEqual([
      '  <div',
      '    style={{ width: 1 }}',
      '  >',
      '    <p',
    ]);
    expect(r.source).toContain('    </p>\n  </div>\n);');
  });

  it('fills an empty root', () => {
    const source = lines(
      'const A = () => (',
      '  <section></section>',
      ');',
      'export default [A];',
      '',
    );
    const r = ok(insertAtEnd(source, { pageIndex: 0, snippetId: 'two-column' }));
    expect(r.source.split('\n').slice(0, 3)).toEqual([
      'const A = () => (',
      '  <section>',
      "    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64 }}>",
    ]);
    expect(r.source).toContain('    </div>\n  </section>\n);');
  });

  it('moves the closing tag off a text line', () => {
    const source = lines('const A = () => <div>Hello</div>;', 'export default [A];', '');
    const r = ok(insertAtEnd(source, { pageIndex: 0, snippetId: 'paragraph' }));
    expect(r.source.startsWith('const A = () => <div>Hello\n  <p\n')).toBe(true);
    expect(r.source).toContain('  </p>\n</div>;');
  });

  it('resolves function pages, block bodies, fragments and inline pages by index', () => {
    const source = lines(
      'function One() {',
      '  const x = 1;',
      '  return (',
      '    <>',
      '      <p>{x}</p>',
      '    </>',
      '  );',
      '}',
      '',
      'export default [One, () => <main>',
      '  <p>Two</p>',
      '</main>];',
      '',
    );
    const first = ok(insertAtEnd(source, { pageIndex: 0, snippetId: 'box' }));
    expect(first.source).toContain('      <p>{x}</p>\n      <div\n');
    expect(tagAt(first.source, first.location)).toBe('div');
    const second = ok(insertAtEnd(source, { pageIndex: 1, snippetId: 'box' }));
    expect(second.source).toContain('  <p>Two</p>\n  <div\n');
    expect(tagAt(second.source, second.location)).toBe('div');
  });

  it('ignores nested returns inside callbacks', () => {
    const source = lines(
      'const A = () => {',
      '  const f = () => {',
      '    return 1;',
      '  };',
      '  return <div>{f()}</div>;',
      '};',
      'export default [A];',
      '',
    );
    expect(insertAtEnd(source, { pageIndex: 0 }).ok).toBe(true);
  });
});

describe('insert-snippet image', () => {
  const source = lines(
    "import type { Page } from '@open-slide/core';",
    "import logo from './assets/logo.svg';",
    '',
    'const A: Page = () => (',
    '  <div>',
    '    <img src={logo} alt="" />',
    '  </div>',
    ');',
    'export default [A];',
    '',
  );

  it('adds one import after the existing imports', () => {
    const r = ok(
      insertAtEnd(source, {
        pageIndex: 0,
        snippetId: 'image',
        assetPath: './assets/hero shot.png',
      }),
    );
    expect(r.source.split('\n').slice(0, 4)).toEqual([
      "import type { Page } from '@open-slide/core';",
      "import logo from './assets/logo.svg';",
      "import heroShot from './assets/hero shot.png';",
      '',
    ]);
    expect(r.source).toContain('      src={heroShot}\n');
    expect(tagAt(r.source, r.location)).toBe('img');
    expect(r.location?.line).toBe(8);
  });

  it('reuses an existing import of the same asset', () => {
    const r = ok(
      insertAtEnd(source, { pageIndex: 0, snippetId: 'image', assetPath: './assets/logo.svg' }),
    );
    expect(r.source.match(/import logo/g)).toHaveLength(1);
    expect(r.source).toContain('      src={logo}\n');
    const again = ok(
      insertAtEnd(r.source, { pageIndex: 0, snippetId: 'image', assetPath: './assets/logo.svg' }),
    );
    expect(again.source.match(/^import /gm)).toHaveLength(2);
  });

  it('imports at the top of a file without imports', () => {
    const bare = lines('const A = () => <div />;', 'export default [A];', '');
    const r = ok(
      insertAtEnd(bare, { pageIndex: 0, snippetId: 'image', assetPath: '@assets/bg.png' }),
    );
    expect(r.source.startsWith("import bg from '@assets/bg.png';\nconst A = () => <div>\n")).toBe(
      true,
    );
    expect(tagAt(r.source, r.location)).toBe('img');
  });

  it('escapes quotes in the asset import', () => {
    const r = ok(
      insertAtEnd(source, {
        pageIndex: 0,
        snippetId: 'image',
        assetPath: "./assets/Pablo's photo.png",
      }),
    );
    expect(r.source).toContain("import pabloSPhoto from './assets/Pablo\\'s photo.png';");
  });

  it.each([undefined, '', '/etc/passwd', './assets/../index.tsx', './assets/a\\b.png'])(
    'refuses asset path %s',
    (assetPath) => {
      const r = refused(insertAtEnd(source, { pageIndex: 0, snippetId: 'image', assetPath }));
      expect(r.code).toBe('asset-required');
    },
  );
});

describe('insert-snippet refusals', () => {
  it.each([
    [
      'map',
      lines(
        'const A = () => (',
        '  <ul>',
        '    {items.map((item) => (',
        '      <li key={item}>{item}</li>',
        '    ))}',
        '  </ul>',
        ');',
        'export default [A];',
      ),
      '<li',
    ],
    [
      'conditional',
      lines(
        'const A = () => (',
        '  <div>',
        '    {on && <p>x</p>}',
        '  </div>',
        ');',
        'export default [A];',
      ),
      '<p>',
    ],
    [
      'expression',
      lines(
        'const A = () => (',
        '  <div>',
        '    <Card icon={<b>x</b>} />',
        '  </div>',
        ');',
        'export default [A];',
      ),
      '<b>',
    ],
    [
      'shared',
      lines(
        'const Card = () => (',
        '  <div>',
        '    <p>x</p>',
        '  </div>',
        ');',
        'const A = () => (',
        '  <main>',
        '    <Card />',
        '    <Card />',
        '  </main>',
        ');',
        'export default [A];',
      ),
      '<p>',
    ],
    [
      'root',
      lines(
        'const Card = () => (',
        '  <div>',
        '    <p>x</p>',
        '  </div>',
        ');',
        'const A = () => <Card />;',
        'export default [A];',
      ),
      '<div>',
    ],
  ])('refuses %s after-selection inserts and leaves the file alone', (code, source, needle) => {
    const r = refused(insertAfter(source, needle, {}));
    expect(r.code).toBe(code);
  });

  it('refuses when the client reports several rendered instances', () => {
    expect(refused(insertAfter(deck, '<h1>', { instanceCount: 2 })).code).toBe('shared');
  });

  it('refuses an unknown snippet', () => {
    expect(refused(insertAfter(deck, '<h1>', { snippetId: 'script' })).code).toBe(
      'unknown-snippet',
    );
  });

  it('refuses a missing selection', () => {
    expect(
      refused(
        applyEdit(deck, 99, 0, [
          { kind: 'insert-snippet', snippetId: 'heading', position: 'after-selection' },
        ]),
      ).code,
    ).toBe('not-found');
  });

  it.each([
    ['page-not-found', deck, 3],
    ['page-not-found', deck, -1],
    ['page-not-found', lines("import A from './a';", 'export default [A];'), 0],
    ['page-not-found', lines('const pages = [];', 'export default pages;'), 0],
    ['shared', lines('const A = () => <div />;', 'export default [A, A];'), 0],
    ['page-root', lines('const A = () => <Cover />;', 'export default [A];'), 0],
    ['page-root', lines('const A = () => null;', 'export default [A];'), 0],
    [
      'conditional',
      lines(
        'const A = ({ on }) => {',
        '  if (on) return <p />;',
        '  return <div />;',
        '};',
        'export default [A];',
      ),
      0,
    ],
    [
      'conditional',
      lines('const A = ({ on }) => (on ? <p /> : <div />);', 'export default [A];'),
      0,
    ],
  ])('refuses %s for end-of-page inserts', (code, source, pageIndex) => {
    expect(refused(insertAtEnd(source, { pageIndex })).code).toBe(code);
  });

  it('refuses an unknown position', () => {
    const r = refused(insertAfter(deck, '<h1>', { position: 'before' as never }));
    expect(r.status).toBe(400);
  });

  it('must be the only op and the only edit in a batch', () => {
    const { line, column } = locate(deck, '<h1>');
    const insert: EditOp = {
      kind: 'insert-snippet',
      snippetId: 'heading',
      position: 'after-selection',
    };
    const mixed = applyEdit(deck, line, column, [
      insert,
      { kind: 'set-style', key: 'color', value: 'red' },
    ]);
    expect(refused(mixed).status).toBe(400);
    const batch = applyEditBatch(deck, [
      { line, column, ops: [insert] },
      { line, column, ops: [{ kind: 'set-style', key: 'color', value: 'red' }] },
    ]);
    expect(batch.source).toBe(deck);
    expect(batch.results.every((result) => !result.ok)).toBe(true);
    const alone = applyEditBatch(deck, [{ line, column, ops: [insert] }]);
    expect(alone.results[0]).toMatchObject({ ok: true, location: { line: 6, column: 4 } });
    expect(alone.source).toContain(heading('    '));
  });
});
