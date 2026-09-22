import { describe, expect, it } from 'vitest';
import { parseSource } from './babel-walk.ts';
import { findSnippet, renderSnippetTsx, SNIPPETS } from './snippets.ts';

const lines = (...rows: string[]) => rows.join('\n');

describe('snippet catalogue', () => {
  it('has unique ids and resolves only known ones', () => {
    const ids = SNIPPETS.map((snippet) => snippet.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['heading', 'paragraph', 'bullet-list', 'box', 'image', 'two-column']);
    expect(findSnippet('heading')?.id).toBe('heading');
    expect(findSnippet('<script>')).toBeNull();
    expect(findSnippet(undefined)).toBeNull();
  });

  it.each(SNIPPETS.map((snippet) => [snippet.id, snippet] as const))(
    '%s renders TSX that parses inside a page',
    (_id, snippet) => {
      const tsx = renderSnippetTsx(snippet, { indent: '    ', assetIdentifier: 'photo' });
      const source = lines(
        "import photo from './assets/photo.png';",
        'const Page = () => (',
        '  <div>',
        `    ${tsx}`,
        '  </div>',
        ');',
        '',
      );
      expect(parseSource(source)).not.toBeNull();
      for (const row of source.split('\n')) expect(row.length).toBeLessThanOrEqual(100);
    },
  );

  it('breaks long style objects the way biome prints them', () => {
    const heading = findSnippet('heading');
    if (!heading) throw new Error('missing heading');
    expect(renderSnippetTsx(heading, { indent: '  ' })).toBe(
      lines(
        '<h2',
        '    style={{',
        '      margin: 0,',
        "      fontFamily: 'var(--osd-font-display)',",
        '      fontSize: 96,',
        '      fontWeight: 700,',
        '      lineHeight: 1.1,',
        "      color: 'var(--osd-text)',",
        '    }}',
        '  >',
        '    Heading',
        '  </h2>',
      ),
    );
  });

  it('keeps short openings on one line and nests children', () => {
    const twoColumn = findSnippet('two-column');
    if (!twoColumn) throw new Error('missing two-column');
    const tsx = renderSnippetTsx(twoColumn, { unit: '\t' });
    expect(tsx.split('\n')[0]).toBe(
      "<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64 }}>",
    );
    expect(tsx.split('\n')[1]).toBe('\t<div');
    expect(tsx.split('\n').at(-1)).toBe('</div>');
  });

  it('references the asset identifier in the image src', () => {
    const image = findSnippet('image');
    if (!image) throw new Error('missing image');
    expect(image.needsAsset).toBe(true);
    const tsx = renderSnippetTsx(image, { assetIdentifier: 'heroShot' });
    expect(tsx).toContain('src={heroShot}');
    expect(tsx).toContain('alt=""');
    expect(tsx.endsWith('/>')).toBe(true);
  });
});
