import { describe, expect, it } from 'vitest';
import { applyEdit, safeAssetIdentifier } from './edit-ops.ts';

describe('applyEdit / set-style', () => {
  // Every JSX opening tag in these synthetic sources sits at column 0;
  // the line numbers below are that tag's line (1-indexed).
  it('inserts a new style attribute when none exists', () => {
    const src = ['export default [() => (', '<h1>Hello</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: '#ef4444' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toBe(
      ['export default [() => (', "<h1 style={{ color: '#ef4444' }}>Hello</h1>", ')];', ''].join(
        '\n',
      ),
    );
  });

  it('updates an existing style key in place', () => {
    const src = ['export default [() => (', "<h1 style={{ color: 'red' }}>Hi</h1>", ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: '#00ff00' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ color: '#00ff00' }}");
  });

  it('writes a design-token var() value verbatim', () => {
    const src = [
      'export default [() => (',
      "<h1 style={{ color: '#ff0000' }}>Hi</h1>",
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-style', key: 'color', value: 'var(--osd-accent)' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ color: 'var(--osd-accent)' }}");
    expect(r.source).not.toContain('#ff0000');
  });

  it('adds a new key alongside existing keys', () => {
    const src = ['export default [() => (', "<h1 style={{ color: 'red' }}>Hi</h1>", ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'fontSize', value: '24px' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ color: 'red', fontSize: '24px' }}");
  });

  it('falls back to prevText for text style edits with a stale source location', () => {
    const src = [
      'export default [() => (',
      '<div>',
      '  <h1>',
      '    Claude',
      '    <br />',
      "    <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      '  </h1>',
      '</div>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-style', key: 'fontSize', value: '24px', prevText: 'Claude\nCode.' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<h1 style={{ fontSize: '24px' }}>");
  });

  it('removes a key when value is null', () => {
    const src = [
      'export default [() => (',
      "<h1 style={{ color: 'red', fontSize: '24px' }}>Hi</h1>",
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'fontSize', value: null }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ color: 'red' }}");
    expect(r.source).not.toContain('fontSize');
  });

  it('removes the entire style attribute when the last property is cleared', () => {
    const src = ['export default [() => (', "<h1 style={{ color: 'red' }}>Hi</h1>", ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: null }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<h1>Hi</h1>');
    expect(r.source).not.toContain('style');
  });

  it('preserves variable-valued properties when editing other keys', () => {
    const src = [
      'export default [() => (',
      '<h1 style={{ fontSize: someVar, color: "red" }}>Hi</h1>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: 'blue' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ fontSize: someVar, color: 'blue' }}");
  });

  it('preserves dynamic style expressions when adding an override', () => {
    const src = ['export default [() => (', '<h1 style={someStyle}>Hi</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: 'red' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ ...(someStyle), color: 'red' }}");
  });

  it('adds style keys after spreads so they override spread values', () => {
    const src = ['export default [() => (', '<h1 style={{ ...base }}>Hi</h1>', ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: 'red' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ ...base, color: 'red' }}");
  });

  it('updates explicit style keys while preserving spreads', () => {
    const src = [
      'export default [() => (',
      "<h1 style={{ ...base, color: 'red' }}>Hi</h1>",
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: 'blue' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ ...base, color: 'blue' }}");
  });

  it('removes explicit style keys while still overriding spread values', () => {
    const src = [
      'export default [() => (',
      "<h1 style={{ ...base, color: 'red' }}>Hi</h1>",
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: null }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('style={{ ...base, color: undefined }}');
  });

  it('places new style attributes after prop spreads', () => {
    const src = ['export default [() => (', '<h1 {...props}>Hi</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: 'red' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<h1 {...props} style={{ color: 'red' }}>Hi</h1>");
  });

  it('moves existing style attributes after later prop spreads', () => {
    const src = [
      'export default [() => (',
      "<h1 style={{ fontSize: '24px' }} {...props}>Hi</h1>",
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'color', value: 'red' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<h1 {...props} style={{ fontSize: '24px', color: 'red' }}>Hi</h1>");
  });

  it('escapes special characters in style values', () => {
    const src = ['export default [() => (', '<h1>Hi</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-style', key: 'fontFamily', value: "Pacifico's" }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("fontFamily: 'Pacifico\\'s'");
  });
});

describe('applyEdit / set-text', () => {
  it('replaces a JSXText child', () => {
    const src = ['export default [() => (', '<h1>Hello</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Goodbye' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<h1>Goodbye</h1>');
  });

  it('replaces a string-literal expression child', () => {
    const src = ['export default [() => (', "<h1>{'Hello'}</h1>", ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Goodbye' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<h1>{'Goodbye'}</h1>");
  });

  it('emits an expression container when value contains JSX-unsafe chars', () => {
    const src = ['export default [() => (', '<h1>Hello</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: '1 < 2 > 0' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<h1>{'1 < 2 > 0'}</h1>");
  });

  it('preserves inserted line breaks as JSX breaks', () => {
    const src = ['export default [() => (', '<h1>Hello</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-text', value: 'Hello\nworld', prevText: 'Hello' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<h1>Hello<br />world</h1>');
  });

  it('descends through wrapper elements to find the text leaf', () => {
    const src = ['export default [() => (', '<div><span>Hello</span></div>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Goodbye' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<div><span>Goodbye</span></div>');
  });

  it('disambiguates between sibling text leaves via prevText', () => {
    const src = ['export default [() => (', '<h1>Hello <span>world</span></h1>', ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'planet', prevText: 'world' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<h1>Hello <span>planet</span></h1>');
  });

  it('falls back to prevText for multiline content edits with a stale source location', () => {
    const src = [
      'const fill = {',
      "  color: 'var(--osd-text)',",
      '};',
      'export default [() => (',
      '<section style={fill}>',
      '<p>Alpha<br />Beta</p>',
      '</section>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [
      { kind: 'set-text', value: 'Alpha\nBeta\nGamma', prevText: 'Alpha\nBeta' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<p>Alpha<br />Beta<br />Gamma</p>');
  });

  it('applies selected text style to an existing inline leaf', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      '  Not autocomplete.',
      '  <br />',
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const prevText = 'Not autocomplete.\nAn agent that does the work.';
    const start = prevText.indexOf('agent');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start,
        end: start + 'agent'.length,
        key: 'color',
        value: '#bb7025',
        prevText,
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<em style={{ color: '#bb7025' }}>agent</em>");
  });

  it('does not style sibling content when a selected leaf has mixed parent content', () => {
    const src = [
      'export default [() => (',
      '<h1><span>Hello <strong>world</strong></span></h1>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 'Hello'.length,
        key: 'color',
        value: '#bb7025',
        prevText: 'Hello world',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain(
      "<span><span style={{ color: '#bb7025' }}>Hello</span> <strong>world</strong></span>",
    );
    expect(r.source).not.toContain("<span style={{ color: '#bb7025' }}>Hello <strong>world");
  });

  it('applies selected text style across inline and plain text leaves', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      '  Not autocomplete.',
      '  <br />',
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const prevText = 'Not autocomplete.\nAn agent that does the work.';
    const start = prevText.indexOf('agent');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start,
        end: start + 'agent that'.length,
        key: 'color',
        value: '#bb7025',
        prevText,
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<em style={{ color: '#bb7025' }}>agent</em>");
    expect(r.source).toContain("<span style={{ color: '#bb7025' }}>{' that'}</span> does");
  });

  it('applies selected text style inside folded JSX text', () => {
    const src = [
      'export default [() => (',
      '<p>',
      '  Claude Code reads your codebase, plans, edits files, runs commands, checks the result, and',
      '  iterates — keeping you in the loop on the decisions that matter.',
      '</p>',
      ')];',
      '',
    ].join('\n');
    const prevText =
      'Claude Code reads your codebase, plans, edits files, runs commands, checks the result, and iterates — keeping you in the loop on the decisions that matter.';
    const start = prevText.indexOf('iterates');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start,
        end: start + 'iterates'.length,
        key: 'fontWeight',
        value: '700',
        prevText,
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<span style={{ fontWeight: '700' }}>iterates</span>");
  });

  it('updates selected text style after a plain text leaf has been wrapped', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      '  Not autocomplete.',
      '  <br />',
      "  An <em style={{ color: '#bb7025' }}>agent</em><span style={{ color: '#bb7025' }}>{' that'}</span> does the work.",
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const prevText = 'Not autocomplete.\nAn agent that does the work.';
    const start = prevText.indexOf('agent');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start,
        end: start + 'agent that'.length,
        key: 'color',
        value: '#111111',
        prevText,
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<em style={{ color: '#111111' }}>agent</em>");
    expect(r.source).toContain("<span style={{ color: '#111111' }}>{' that'}</span> does");
  });

  it('removes selected text style from a fully selected inline leaf', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      "  <span style={{ fontWeight: '700' }}>agent</span> work.",
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 'agent'.length,
        key: 'fontWeight',
        value: null,
        prevText: 'agent work.',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<span>agent</span> work.');
  });

  it('resets selected text style inside an inherited bold range', () => {
    const src = [
      'export default [() => (',
      "<h2 style={{ fontWeight: '700' }}>An agent that works.</h2>",
      ')];',
      '',
    ].join('\n');
    const prevText = 'An agent that works.';
    const start = prevText.indexOf('agent');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start,
        end: start + 'agent'.length,
        key: 'fontWeight',
        value: null,
        prevText,
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<span style={{ fontWeight: '400' }}>agent</span>");
  });

  it('falls back to prevText when a stale source location no longer points at JSX', () => {
    const src = [
      'export default [() => (',
      '<h1>',
      "  <span style={{ fontStyle: 'italic' }}>Claude</span>",
      '  <br />',
      "  <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      '</h1>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 99, 0, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 'Claude'.length,
        key: 'fontSize',
        value: '180px',
        prevText: 'Claude\nCode.',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<span style={{ fontStyle: 'italic', fontSize: '180px' }}>");
  });

  it('falls back to prevText for direct JSX text with a stale source location', () => {
    const src = [
      'export default [() => (',
      '<h1>',
      '  Claude',
      '  <br />',
      "  <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      '</h1>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 99, 0, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 'Claude'.length,
        key: 'fontSize',
        value: '180px',
        prevText: 'Claude\nCode.',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<span style={{ fontSize: '180px' }}>Claude</span>");
  });

  it('falls back to prevText when a stale location points at an outer JSX element', () => {
    const src = [
      'export default [() => (',
      '<div>',
      '  <h1>',
      '    Claude',
      '    <br />',
      "    <em style={{ color: 'var(--osd-accent)' }}>Code.</em>",
      '  </h1>',
      '</div>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 'Claude'.length,
        key: 'fontSize',
        value: '180px',
        prevText: 'Claude\nCode.',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<span style={{ fontSize: '180px' }}>Claude</span>");
  });

  it('styles the whole element when selected map text is expression-backed', () => {
    const src = [
      'const items = [',
      "  { title: 'Read files' },",
      "  { title: 'Run tools' },",
      '];',
      'export default [() => (',
      '<div>',
      '  {items.map((item) => (',
      '    <div key={item.title}>',
      '      <div style={{ fontWeight: 400 }}>{item.title}</div>',
      '    </div>',
      '  ))}',
      '</div>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 9, 6, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 'Run tools'.length,
        key: 'fontSize',
        value: '79px',
        prevText: 'Run tools',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ fontWeight: 400, fontSize: '79px' }}");
  });

  it('falls back to element style for partial expression-backed map text', () => {
    const src = [
      'const steps = [',
      "  { label: 'Read' },",
      "  { label: 'Plan' },",
      '];',
      'export default [() => (',
      '<div>',
      '  {steps.map((step) => (',
      '    <div key={step.label} style={{ fontWeight: 400 }}>{step.label}</div>',
      '  ))}',
      '</div>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 8, 4, [
      {
        kind: 'set-text-range-style',
        start: 1,
        end: 3,
        key: 'fontSize',
        value: '81px',
        prevText: 'Plan',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("style={{ fontWeight: 400, fontSize: '81px' }}");
  });

  it('edits rich text content without flattening inline style', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      '  Not autocomplete.',
      '  <br />',
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text',
        value: 'Not autocomplete.\nAn agent that does the real work.',
        prevText: 'Not autocomplete.\nAn agent that does the work.',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<em style={{ color: 'var(--osd-accent)' }}>agent</em>");
    expect(r.source).toContain('that does the real work.');
    expect(r.source).toContain('<br />');
  });

  it('edits rich text line breaks as newlines', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      '  Not autocomplete.',
      '  <br />',
      "  An <em style={{ color: 'var(--osd-accent)' }}>agent</em> that does the work.",
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text',
        value: 'Not autocomplete. An agent that does the work.',
        prevText: 'Not autocomplete.\nAn agent that does the work.',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).not.toContain('<br />');
    expect(r.source).toContain("{' '}");
    expect(r.source).toContain("<em style={{ color: 'var(--osd-accent)' }}>agent</em>");
  });

  it('matches visible rich text when a string literal has whitespace before a line break', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      "  an <span>agent <span>harness</span></span> is{' '}",
      '  <span>',
      '    {\'"everything \'}<br />in an AI agent except the model itself."',
      '  </span>',
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const prevText = 'an agent harness is "everything\nin an AI agent except the model itself."';
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text',
        value: 'an agent harness is "everything\nin a coding agent except the model itself."',
        prevText,
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('in a coding agent except the model itself.');
    expect(r.source).toContain('<br />');
  });

  it('matches rich text content after line break positions changed in a pending edit', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      '  Permissions, t<br />hen hooks.',
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text',
        value: 'Permissions, t\nhen hooks!',
        prevText: 'Permissions, then hooks.',
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('hen hooks!');
    expect(r.source).toContain('<br />');
  });

  it('styles visible rich text when a string literal has whitespace before a line break', () => {
    const src = [
      'export default [() => (',
      '<h2>',
      "  an <span>agent <span>harness</span></span> is{' '}",
      '  <span>',
      '    {\'"everything \'}<br />in an AI agent except the model itself."',
      '  </span>',
      '</h2>',
      ')];',
      '',
    ].join('\n');
    const prevText = 'an agent harness is "everything\nin an AI agent except the model itself."';
    const start = prevText.indexOf('in an AI');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start,
        end: start + 'in an AI'.length,
        key: 'fontWeight',
        value: '700',
        prevText,
      },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<span style={{ fontWeight: '700' }}>in an AI</span>");
  });

  it('bails when prevText is missing for an ambiguous element', () => {
    const src = ['export default [() => (', '<h1>Hello <span>world</span></h1>', ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Goodbye' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/multiple text candidates/);
  });

  it('bails when prevText matches no candidate', () => {
    const src = ['export default [() => (', '<h1>Hello <span>world</span></h1>', ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-text', value: 'Goodbye', prevText: 'nothing-like-this' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/no text candidate matches/);
  });

  it('bails when prevText matches multiple identical candidates', () => {
    const src = ['export default [() => (', '<h1>X<span>X</span></h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Y', prevText: 'X' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/cannot disambiguate/);
  });

  it('edits the JSXText child of a component invocation', () => {
    const src = ['export default [() => (', '<Title>Hello</Title>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Goodbye' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<Title>Goodbye</Title>');
  });

  it('bails when element child is a dynamic expression', () => {
    const src = ['export default [() => (', '<h1>{name}</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Goodbye' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(422);
  });

  it('bails when a self-closing element has no editable text', () => {
    const src = ['export default [() => (', '<MyComp title="x" />', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value: 'Goodbye' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/no editable text/);
  });

  it('falls through to call sites when the element is a {children} slot', () => {
    // The host `<div>` at line 2 only renders `{children}`; the actual
    // text lives at the unique call site below.
    const src = [
      'const Eyebrow = ({ children }) => (',
      '  <div>{children}</div>',
      ');',
      'export default [() => (',
      '  <Eyebrow>Hello</Eyebrow>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Goodbye', prevText: 'Hello' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<Eyebrow>Goodbye</Eyebrow>');
    expect(r.source).toContain('<div>{children}</div>');
  });

  it('disambiguates between sibling call sites of a children-slot component', () => {
    const src = [
      'const Eyebrow = ({ children }) => (',
      '  <div>{children}</div>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Eyebrow>One</Eyebrow>',
      '    <Eyebrow>Two</Eyebrow>',
      '  </section>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Second', prevText: 'Two' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<Eyebrow>One</Eyebrow>');
    expect(r.source).toContain('<Eyebrow>Second</Eyebrow>');
  });

  it('bails on a children-slot element when prevText is missing and call sites differ', () => {
    const src = [
      'const Eyebrow = ({ children }) => (',
      '  <div>{children}</div>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Eyebrow>One</Eyebrow>',
      '    <Eyebrow>Two</Eyebrow>',
      '  </section>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'X' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/multiple text candidates/);
  });

  it('routes a prop pass-through edit to the matching call site', () => {
    // `<h2>{title}</h2>` has no editable text of its own — find the
    // `title="..."` literal at the (only) call site and rewrite it.
    const src = [
      'const Card = ({ title }: { title: string }) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <Card title="Hello" />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Goodbye', prevText: 'Hello' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<Card title="Goodbye" />');
    expect(r.source).toContain('<h2>{title}</h2>');
  });

  it('disambiguates among sibling call sites of a reused prop component', () => {
    const src = [
      'const Card = ({ title }: { title: string }) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Card title="First" />',
      '    <Card title="Second" />',
      '  </section>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Edited', prevText: 'Second' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<Card title="First" />');
    expect(r.source).toContain('<Card title="Edited" />');
  });

  it.each(['  Alpha   Beta  ', 'Alpha\tBeta'])(
    'matches collapsed whitespace in a reused prop: %j',
    (title) => {
      const src = [
        'const Card = ({ title }: { title: string }) => (',
        '  <h2>{title}</h2>',
        ');',
        'export default [() => (',
        '  <section>',
        `    <Card title={${JSON.stringify(title)}} />`,
        '    <Card title="Other" />',
        '  </section>',
        ')];',
      ].join('\n');
      const r = applyEdit(src, 2, 2, [
        { kind: 'set-text', value: 'Edited', prevText: 'Alpha Beta' },
      ]);
      if (!r.ok) throw new Error(r.error);
      expect(r.source).toContain('<Card title="Edited" />');
      expect(r.source).toContain('<Card title="Other" />');
      expect(r.source).toContain('<h2>{title}</h2>');
    },
  );

  const cards = (...titles: string[]) =>
    [
      'const Card = ({ title }: { title: string }) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <section>',
      ...titles.map((title) => `    <Card title={${JSON.stringify(title)}} />`),
      '  </section>',
      ')];',
    ].join('\n');
  // What `readEditableText` reports outside `white-space: pre*`.
  const rendered = (value: string) => value.replace(/[ \t\n\r\f]+/g, ' ');

  it.each(['  Alpha   Beta  ', 'Alpha\tBeta', 'Alpha\n    Beta'])(
    'matches collapsed whitespace in a reused prop: %j',
    (title) => {
      const r = applyEdit(cards(title, 'Other'), 2, 2, [
        { kind: 'set-text', value: 'Edited', prevText: rendered(title) },
      ]);
      if (!r.ok) throw new Error(r.error);
      expect(r.source).toContain('<Card title="Edited" />');
      expect(r.source).toContain('<Card title={"Other"} />');
      expect(r.source).toContain('<h2>{title}</h2>');
    },
  );

  it.each([' ', '　'])('keeps %j distinct from a plain space', (space) => {
    const src = cards('Alpha Beta', `Alpha${space}Beta`);
    const plain = applyEdit(src, 2, 2, [
      { kind: 'set-text', value: 'Plain', prevText: 'Alpha Beta' },
    ]);
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.source).toContain('<Card title="Plain" />');
    expect(plain.source).toContain(`<Card title={${JSON.stringify(`Alpha${space}Beta`)}} />`);

    const special = applyEdit(src, 2, 2, [
      { kind: 'set-text', value: 'Special', prevText: `Alpha${space}Beta` },
    ]);
    if (!special.ok) throw new Error(special.error);
    expect(special.source).toContain('<Card title={"Alpha Beta"} />');
    expect(special.source).toContain('<Card title="Special" />');
  });

  it.each([
    [' Alpha', '  Alpha'],
    ['Alpha ', 'Alpha  '],
  ])('refuses %j next to %j instead of guessing from a single edge space', (first, second) => {
    const r = applyEdit(cards(first, second), 2, 2, [
      { kind: 'set-text', value: 'Edited', prevText: rendered(second) },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatch(/cannot disambiguate/);
  });

  // Deliberate trade: the DOM collapses both literals to the same text, so
  // refusing is safer than guessing and silently rewriting the wrong call site.
  it('refuses reused props that only differ by collapsible whitespace', () => {
    const src = [
      'const Card = ({ title }: { title: string }) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <section><Card title="Alpha Beta" /><Card title="Alpha  Beta" /></section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Edited', prevText: 'Alpha Beta' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatch(/cannot disambiguate/);
  });

  it('prefers an exact match when prevText keeps preserved whitespace', () => {
    const src = [
      'const Block = ({ text }: { text: string }) => (',
      "  <pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>",
      ');',
      'export default [() => (',
      '  <section>',
      '    <Block text={"a\\nb"} />',
      '    <Block text="a b" />',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Edited', prevText: 'a\nb' }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<Block text="Edited" />');
    expect(r.source).toContain('<Block text="a b" />');
  });

  it('never falls back to collapsed matching for preserved whitespace', () => {
    const pre = (...texts: string[]) =>
      [
        'const Block = ({ text }: { text: string }) => (',
        "  <pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>",
        ');',
        'export default [() => (',
        '  <section>',
        ...texts.map((text) => `    <Block text={${JSON.stringify(text)}} />`),
        '  </section>',
        ')];',
      ].join('\n');
    const ambiguous = applyEdit(pre('a\nb', 'a\nb', 'a b'), 2, 2, [
      { kind: 'set-text', value: 'Edited', prevText: 'a\nb' },
    ]);
    expect(ambiguous.ok).toBe(false);
    if (ambiguous.ok) throw new Error('expected failure');
    expect(ambiguous.error).toMatch(/cannot disambiguate/);

    const missing = applyEdit(pre('a b', 'c'), 2, 2, [
      { kind: 'set-text', value: 'Edited', prevText: 'a  b' },
    ]);
    expect(missing.ok).toBe(false);
  });

  it('still falls back from a stale column that lands inside computed text', () => {
    const before = 'const W = ({ name }) => (<div><b>{name}</b> and <i>Static</i></div>);';
    const after = before.replace('<b>', "<b style={{ color: 'red' }}>");
    const src = [after, 'export default [() => <W name="Bob" />];'].join('\n');
    const r = applyEdit(src, 1, before.indexOf('<i>'), [
      { kind: 'set-text', value: 'Edited', prevText: 'Static' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<i>Edited</i>');
    expect(r.source).toContain('<W name="Bob" />');
  });

  it('keeps a NBSP before a line break when editing multi-line text', () => {
    const src = ['export default [() => (', '<p>one <br />two</p>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-text', value: 'one \ntwoX', prevText: 'one \ntwo' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<p>one <br />twoX</p>');
  });

  it('matches preserved edge spaces in single-line children', () => {
    const src = [
      'const Block = ({ children }: { children: string }) => (',
      "  <pre style={{ whiteSpace: 'pre-wrap' }}>{children}</pre>",
      ');',
      'export default [() => (',
      '  <section>',
      '    <Block>  Alpha</Block>',
      '    <Block>Beta</Block>',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Edited', prevText: '  Alpha' }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<Block>Edited</Block>');
    expect(r.source).toContain('<Block>Beta</Block>');
  });

  it('matches a tab kept verbatim in preserved single-line children', () => {
    const src = [
      'const Code = ({ children }: { children: string }) => (',
      '  <pre>{children}</pre>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Code>a\tb</Code>',
      '    <Code>c\td</Code>',
      '    <pre>{"a\\tb"}</pre>',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'a\tB', prevText: 'a\tb' }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<Code>a\tB</Code>');
    expect(r.source).toContain('<Code>c\td</Code>');
    expect(r.source).toContain('<pre>{"a\\tb"}</pre>');
  });

  it.each(['\u3000', '\u00a0'])(
    'trims %j at the edge of multi-line children like JSX does',
    (space) => {
      const titles = (...children: string[]) =>
        [
          'const Title = ({ children }: { children: string }) => (',
          '  <h1>{children}</h1>',
          ');',
          'export default [() => (',
          '  <section>',
          ...children.map((child) => `    <Title>${child}</Title>`),
          '  </section>',
          ')];',
        ].join('\n');
      const twins = applyEdit(titles(`\n      ${space}Same\n    `, 'Same'), 2, 2, [
        { kind: 'set-text', value: 'X', prevText: 'Same' },
      ]);
      expect(twins.ok).toBe(false);
      if (twins.ok) throw new Error('expected failure');
      expect(twins.error).toMatch(/cannot disambiguate/);

      const distinct = applyEdit(
        titles(`\n      ${space}日本語\n    `, `\n      ${space}英語\n    `),
        2,
        2,
        [{ kind: 'set-text', value: 'X', prevText: '英語' }],
      );
      if (!distinct.ok) throw new Error(distinct.error);
      expect(distinct.source).toContain('<Title>X</Title>');
      expect(distinct.source).toContain('日本語');
    },
  );

  it.each(['<T>Hello  world</T>', '<T>\n      Hello\n      world\n    </T>'])(
    'counts a rich children call site as a twin of %j',
    (plain) => {
      const src = [
        'function T({ children }: { children: string }) {',
        '  return <p>{children}</p>;',
        '}',
        'export default [() => (',
        '  <section>',
        '    <T>Hello <b>world</b></T>',
        `    ${plain}`,
        '  </section>',
        ')];',
      ].join('\n');
      const r = applyEdit(src, 2, 9, [
        { kind: 'set-text', value: 'Hello worldX', prevText: 'Hello world' },
      ]);
      if (r.ok) {
        expect(r.source).toContain('<T>Hello <b>worldX</b></T>');
        expect(r.source).toContain(plain);
      } else {
        expect(r.error).toMatch(/cannot disambiguate|no text candidate/);
      }
    },
  );

  it('still edits a lone rich children call site', () => {
    const src = [
      'function T({ children }: { children: string }) {',
      '  return <p>{children}</p>;',
      '}',
      'export default [() => (',
      '  <section>',
      '    <T>Hello <b>world</b></T>',
      '    <T>Other</T>',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 9, [
      { kind: 'set-text', value: 'Hello worldX', prevText: 'Hello world' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<T>Hello <b>worldX</b></T>');
    expect(r.source).toContain('<T>Other</T>');
  });

  it.each(['<T>{/* note */}Hello</T>', '<T><Icon />Hello</T>'])(
    'does not treat %j as its own twin',
    (site) => {
      const src = [
        'const Icon = () => <i />;',
        'function T({ children }: { children: string }) {',
        '  return <p>{children}</p>;',
        '}',
        'export default [() => (',
        '  <section>',
        `    ${site}`,
        '    <T>Bye</T>',
        '  </section>',
        ')];',
      ].join('\n');
      const r = applyEdit(src, 3, 9, [{ kind: 'set-text', value: 'HelloX', prevText: 'Hello' }]);
      if (!r.ok) throw new Error(r.error);
      expect(r.source).toContain('HelloX</T>');
      expect(r.source).toContain('<T>Bye</T>');
    },
  );

  it('trims multi-line children in a CRLF file without clipping the text', () => {
    const src = [
      'const Eyebrow = ({ children }: { children: string }) => (',
      '  <div>{children}</div>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Eyebrow>',
      '      (Two)',
      '    </Eyebrow>',
      '    <Eyebrow>',
      '      Two',
      '    </Eyebrow>',
      '  </section>',
      ')];',
    ].join('\r\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Second', prevText: 'Two' }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('(Two)');
    expect(r.source).toContain('<Eyebrow>Second</Eyebrow>');
  });

  it('drops a raw NBSP at an inner line edge like JSX does', () => {
    const src = [
      'function T({ children }: { children: string }) {',
      '  return <p>{children}</p>;',
      '}',
      'export default [() => (',
      '  <section>',
      '    <T>',
      '      Alpha\u00a0',
      '      Beta',
      '    </T>',
      '    <T>Alpha  Beta</T>',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 9, [{ kind: 'set-text', value: 'Edited', prevText: 'Alpha Beta' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatch(/cannot disambiguate/);
  });

  it('keeps an &nbsp; entity at the edge of multi-line children', () => {
    const src = [
      'const Wrap = ({ children }: { children: string }) => (',
      '  <h2>{children}</h2>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Wrap>',
      '      &nbsp;Alpha',
      '    </Wrap>',
      '    <Wrap>Alpha</Wrap>',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [
      { kind: 'set-text', value: 'Edited', prevText: '\u00a0Alpha' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<Wrap>Edited</Wrap>');
    expect(r.source).toContain('<Wrap>Alpha</Wrap>');
  });

  it('matches a children call site that starts with a NBSP', () => {
    const src = [
      'const Wrap = ({ children }: { children: string }) => (',
      '  <h2>{children}</h2>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Wrap> Alpha</Wrap>',
      '    <Wrap>Beta</Wrap>',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Edited', prevText: ' Alpha' }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<Wrap>Edited</Wrap>');
    expect(r.source).toContain('<Wrap>Beta</Wrap>');
  });

  it('refuses a range style on own text whose source has a whitespace run', () => {
    const src = ['export default [() => (', '<p>Hello  world and more</p>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 'Hello'.length,
        key: 'color',
        value: 'red',
        prevText: 'Hello world and more',
      },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatch(/no text candidate matches/);
  });

  it.each([
    ['<p>Hello  <b>world</b></p>', 'Hello world', '<p>Hello  <b>worldX</b></p>'],
    ['<p>\n  Hello   there <b>x</b>\n</p>', 'Hello there x', 'Hello   there <b>xX</b>'],
  ])('keeps the located element when its own text collapses to prevText: %j', (p, text, edited) => {
    const src = ['export default [() => (', '<div>', p, `<h2>${text}</h2>`, '</div>', ')];'].join(
      '\n',
    );
    const r = applyEdit(src, 3, 0, [{ kind: 'set-text', value: `${text}X`, prevText: text }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain(`<h2>${text}</h2>`);
    expect(r.source).toContain(edited);
  });

  it('edits across a collapsed whitespace run without moving text out of children', () => {
    const src = ['export default [() => (', '<p>Hello  <b>big</b> world</p>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-text', value: 'Hi big world', prevText: 'Hello big world' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<b>big</b> world</p>');
    expect(r.source).toContain('Hi');
    expect(r.source).not.toContain('Hello');
  });

  it.each([
    ['Hello world', "<p>{''}Hello\n    world</p>"],
    ['X Hello world', "<p>{'X '}Hello\n    world</p>"],
    [' Hello worldX', '<p>{" "}Hello worldX</p>'],
  ])('diffs own text split across literals: %j', (value, expected) => {
    const src = ['export default [() => (', '<p>{" "}Hello', '    world</p>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [{ kind: 'set-text', value, prevText: ' Hello world' }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain(expected);
  });

  it('prefers the reused prop over an unrelated element with the same text', () => {
    const src = [
      'const Card = ({ title }: { title: string }) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Card title="Alpha" />',
      '    <Card title="Beta" />',
      '    <p>Alpha</p>',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Edited', prevText: 'Alpha' }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('<Card title="Edited" />');
    expect(r.source).toContain('<p>Alpha</p>');
  });

  it('restyles the shared element for a range style on a whitespace-padded reused prop', () => {
    const src = [
      'const Card = ({ title }: { title: string }) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <section>',
      '    <Card title="  Alpha   Beta  " />',
      '    <Card title="Other" />',
      '  </section>',
      ')];',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [
      {
        kind: 'set-text-range-style',
        start: 1,
        end: 1 + 'Alpha Beta'.length,
        key: 'color',
        value: 'red',
        prevText: rendered('  Alpha   Beta  '),
      },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain("<h2 style={{ color: 'red' }}>{title}</h2>");
  });

  it('escapes a prop value that needs an expression container', () => {
    const src = [
      'const Card = ({ label }: { label: string }) => (',
      '  <h2>{label}</h2>',
      ');',
      'export default [() => (',
      '  <Card label="plain" />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [
      { kind: 'set-text', value: 'with "quotes"', prevText: 'plain' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain(`<Card label={'with "quotes"'} />`);
  });

  it('bails on a prop pass-through when the prop is not destructured', () => {
    const src = [
      'const Card = (props) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <Card title="Hello" />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'X', prevText: 'Hello' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('dynamic-text');
  });

  it('routes a `.map()` MemberExpression child to the matching array entry', () => {
    const src = [
      'const surfaces = [',
      "  { tag: 'CLI', label: 'Terminal' },",
      "  { tag: 'IDE', label: 'VS Code' },",
      '];',
      'export default [() => (',
      '  <>',
      '    {surfaces.map((s) => (',
      '      <div key={s.tag}>{s.label}</div>',
      '    ))}',
      '  </>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 8, 6, [{ kind: 'set-text', value: 'Shell', prevText: 'Terminal' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("label: 'Shell'");
    expect(r.source).toContain("label: 'VS Code'");
  });

  it('routes a `.map()` Identifier child (destructured) to the matching array entry', () => {
    const src = [
      'const items = [',
      "  { name: 'First' },",
      "  { name: 'Second' },",
      '];',
      'export default [() => (',
      '  <>',
      '    {items.map(({ name }) => (',
      '      <span key={name}>{name}</span>',
      '    ))}',
      '  </>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 8, 6, [{ kind: 'set-text', value: 'Edited', prevText: 'Second' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("name: 'First'");
    expect(r.source).toContain("name: 'Edited'");
  });

  it('handles an inline array literal in a `.map()` callee', () => {
    const src = [
      'export default [() => (',
      '  <>',
      "    {[{ word: 'a' }, { word: 'b' }].map((x) => (",
      '      <em key={x.word}>{x.word}</em>',
      '    ))}',
      '  </>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 4, 6, [{ kind: 'set-text', value: 'A!', prevText: 'a' }]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("word: 'A!'");
    expect(r.source).toContain("word: 'b'");
  });

  it('bails on a `.map()` child when the prop is not a literal', () => {
    const src = [
      'const greet = "hi";',
      'const items = [{ name: greet }];',
      'export default [() => (',
      '  <>',
      '    {items.map((x) => (',
      '      <span>{x.name}</span>',
      '    ))}',
      '  </>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 6, 6, [{ kind: 'set-text', value: 'X', prevText: 'hi' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('dynamic-text');
  });

  it('bails on a prop pass-through when the call site uses a non-literal value', () => {
    const src = [
      'const heading = "Hello";',
      'const Card = ({ title }: { title: string }) => (',
      '  <h2>{title}</h2>',
      ');',
      'export default [() => (',
      '  <Card title={heading} />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 2, [{ kind: 'set-text', value: 'X', prevText: 'Hello' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('dynamic-text');
  });
});

describe('applyEdit / mixed literal and expression text', () => {
  const footer = [
    'const master = { footerLabel: "FADE BASICS" };',
    'const Footer = ({ current, total }: { current: number; total: number }) => (',
    '  <footer>',
    '    <span>{master.footerLabel}</span>',
    '    <span>',
    "      {String(current).padStart(2, '0')} / {String(total).padStart(2, '0')}",
    '    </span>',
    '  </footer>',
    ');',
    'export default [',
    '  () => <Footer current={5} total={6} />,',
    '  () => <Footer current={6} total={6} />,',
    '];',
    '',
  ].join('\n');

  it('refuses the footer span whose only literal sits between two expressions', () => {
    const r = applyEdit(footer, 5, 4, [
      { kind: 'set-text', value: '05 of 06', prevText: '05 / 06' },
    ]);
    expect(r).toMatchObject({ ok: false, status: 422, code: 'dynamic-text', callSites: 2 });
    if (!r.ok) expect(r.error).toMatch(/rendered 2 times/);
  });

  it('refuses the whole footer, which renders an expression-only span next to it', () => {
    const r = applyEdit(footer, 3, 2, [
      { kind: 'set-text', value: 'FADE BASICS 05 / 06!', prevText: 'FADE BASICS05 / 06' },
    ]);
    expect(r).toMatchObject({ ok: false, code: 'dynamic-text' });
  });

  it('refuses a mixed element when prevText is missing', () => {
    const r = applyEdit(footer, 5, 4, [{ kind: 'set-text', value: 'x' }]);
    expect(r).toMatchObject({ ok: false, code: 'dynamic-text' });
  });

  it('refuses a range style on a mixed element', () => {
    const withoutPrev = applyEdit(footer, 5, 4, [
      { kind: 'set-text-range-style', start: 0, end: 2, key: 'fontWeight', value: '700' },
    ]);
    expect(withoutPrev).toMatchObject({ ok: false, code: 'dynamic-text' });
    const withPrev = applyEdit(footer, 5, 4, [
      {
        kind: 'set-text-range-style',
        start: 0,
        end: 2,
        key: 'fontWeight',
        value: '700',
        prevText: '05 / 06',
      },
    ]);
    expect(withPrev).toMatchObject({ ok: false, code: 'dynamic-text' });
  });

  it('counts renders through a layout component used on every page', () => {
    const src = [
      'const Footer = ({ n }: { n: number }) => <footer>Page {n}</footer>;',
      'const Master = ({ children }: { children: React.ReactNode }) => (',
      '  <main>',
      '    {children}',
      '    <Footer n={1} />',
      '  </main>',
      ');',
      'export default [',
      '  () => <Master>One</Master>,',
      '  () => <Master>Two</Master>,',
      '  () => <Master>Three</Master>,',
      '];',
      '',
    ].join('\n');
    const r = applyEdit(src, 1, 41, [{ kind: 'set-text', value: 'P 1', prevText: 'Page 1' }]);
    expect(r).toMatchObject({ ok: false, code: 'dynamic-text', callSites: 3 });
  });

  it('refuses a literal followed by one expression', () => {
    const src = ['export default [() => (', '  <p>Page {3 + 2}</p>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 2, [{ kind: 'set-text', value: 'Slide 5', prevText: 'Page 5' }]);
    expect(r).toMatchObject({ ok: false, code: 'dynamic-text', callSites: 1 });
  });

  it('refuses an element made only of expressions', () => {
    const src = [
      'const a = 1;',
      'const b = 2;',
      'export default [() => (',
      '  <p>',
      '    {a} {b}',
      '  </p>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 4, 2, [{ kind: 'set-text', value: '1 3', prevText: '1 2' }]);
    expect(r).toMatchObject({ ok: false, code: 'dynamic-text' });
  });

  it('refuses a literal next to an expression nested in a child element', () => {
    const src = [
      'const name = "Ada";',
      'export default [() => (',
      '  <p>',
      '    Hello <b>{name}</b>',
      '  </p>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 2, [
      { kind: 'set-text', value: 'Hello Ada!', prevText: 'Hello Ada' },
    ]);
    expect(r).toMatchObject({ ok: false, code: 'dynamic-text' });
  });

  it('edits only the literal when the expressions render nothing', () => {
    const src = [
      'const note = null;',
      'export default [() => (',
      '  <p>',
      '    {note}Hello world',
      '  </p>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 2, [
      { kind: 'set-text', value: 'Hello there', prevText: 'Hello world' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('{note}Hello there');
  });

  it('refuses a call site that mixes literal children with an expression', () => {
    const src = [
      'const n = 3;',
      'const Label = ({ children }: { children: React.ReactNode }) => <span>{children}</span>;',
      'export default [() => (',
      '  <Label>Page {n}</Label>',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 2, 63, [{ kind: 'set-text', value: 'Slide 3', prevText: 'Page 3' }]);
    expect(r).toMatchObject({ ok: false, code: 'dynamic-text' });
    expect(applyEdit(src, 2, 63, [{ kind: 'set-text', value: 'x' }])).toMatchObject({
      ok: false,
    });
  });

  it('still edits plain literal text', () => {
    const plain = ['export default [() => (', '  <p>text</p>', ')];', ''].join('\n');
    const r1 = applyEdit(plain, 2, 2, [{ kind: 'set-text', value: 'next', prevText: 'text' }]);
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.source).toContain('<p>next</p>');

    const literal = ['export default [() => (', "  <p>{'literal'}</p>", ')];', ''].join('\n');
    const r2 = applyEdit(literal, 2, 2, [
      { kind: 'set-text', value: 'changed', prevText: 'literal' },
    ]);
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.source).toContain("<p>{'changed'}</p>");
  });

  it('keeps literal expression and comment children editable', () => {
    const src = ['export default [() => (', "  <p>{/* note */}Hello{' '}world</p>", ')];', ''].join(
      '\n',
    );
    const r = applyEdit(src, 2, 2, [
      { kind: 'set-text', value: 'Hello there', prevText: 'Hello world' },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toContain('there');
    expect(r.source).toContain('{/* note */}');
  });
});

describe('applyEdit / combined ops', () => {
  it('applies style and text ops in one pass', () => {
    const src = ['export default [() => (', '<h1>Hello</h1>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-style', key: 'fontWeight', value: '700' },
      { kind: 'set-text', value: 'Bold!' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("<h1 style={{ fontWeight: '700' }}>Bold!</h1>");
  });

  it('returns an unchanged source when ops are empty', () => {
    const src = '<h1>Hi</h1>';
    const r = applyEdit(src, 1, 0, []);
    if (!r.ok) throw new Error('expected ok');
    expect(r.source).toBe(src);
  });
});

describe('safeAssetIdentifier', () => {
  it('camel-cases dashes and spaces', () => {
    expect(safeAssetIdentifier('my-logo.svg', new Set())).toBe('myLogo');
    expect(safeAssetIdentifier('hello world.png', new Set())).toBe('helloWorld');
  });

  it('prefixes identifiers that would start with a digit', () => {
    expect(safeAssetIdentifier('2026-photo.jpg', new Set())).toBe('asset2026Photo');
  });

  it('falls back to "asset" for names with no usable characters', () => {
    expect(safeAssetIdentifier('---.png', new Set())).toBe('asset');
  });

  it('appends a counter when the candidate collides with an existing name', () => {
    const taken = new Set(['logo', 'logo2']);
    expect(safeAssetIdentifier('logo.svg', taken)).toBe('logo3');
  });
});

describe('applyEdit / set-attr-asset', () => {
  it('inserts an import and rewrites the src attribute on a fresh <img>', () => {
    const src = [
      "import logo from './assets/logo.svg';",
      'export default [() => (',
      '<img src={logo} />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 0, [
      { kind: 'set-attr-asset', attr: 'src', assetPath: './assets/photo.png' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("import photo from './assets/photo.png';");
    expect(r.source).toContain('<img src={photo} />');
    // Original import is preserved.
    expect(r.source).toContain("import logo from './assets/logo.svg';");
  });

  it('reuses an existing import when the path is already imported', () => {
    const src = [
      "import logo from './assets/logo.svg';",
      "import photo from './assets/photo.png';",
      'export default [() => (',
      '<img src={logo} />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 4, 0, [
      { kind: 'set-attr-asset', attr: 'src', assetPath: './assets/photo.png' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<img src={photo} />');
    // No duplicate import added.
    const occurrences = r.source.match(/from '\.\/assets\/photo\.png'/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('inserts a fresh src attribute on an <img> that has none', () => {
    const src = [
      "import alt from './assets/alt.svg';",
      'export default [() => (',
      '<img alt="" />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 0, [
      { kind: 'set-attr-asset', attr: 'src', assetPath: './assets/alt.svg' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<img src={alt} alt="" />');
  });

  it('rejects asset paths outside ./assets/', () => {
    const src = ['export default [() => (', '<img src="x" />', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'set-attr-asset', attr: 'src', assetPath: '../foo.png' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatch(/\.\/assets\//);
  });
});

describe('applyEdit / replace-placeholder-with-image', () => {
  it('rewrites <ImagePlaceholder> to <img> and adds an import', () => {
    const src = [
      "import { ImagePlaceholder } from '@open-slide/core';",
      'export default [() => (',
      '<ImagePlaceholder hint="Product hero" width={1280} height={720} />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 0, [
      { kind: 'replace-placeholder-with-image', assetPath: './assets/hero.png' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain("import hero from './assets/hero.png';");
    expect(r.source).toContain(
      "<img src={hero} alt='Product hero' style={{ width: 1280, height: 720, objectFit: 'cover', objectPosition: '50% 50%' }} />",
    );
    expect(r.source).not.toContain('<ImagePlaceholder');
  });

  it('reuses an existing import for the same asset path', () => {
    const src = [
      "import { ImagePlaceholder } from '@open-slide/core';",
      "import hero from './assets/hero.png';",
      'export default [() => (',
      '<ImagePlaceholder hint="Hero" width={800} height={600} />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 4, 0, [
      { kind: 'replace-placeholder-with-image', assetPath: './assets/hero.png' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain('<img src={hero}');
    const occurrences = r.source.match(/from '\.\/assets\/hero\.png'/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('omits width/height when the placeholder did not specify them', () => {
    const src = [
      "import { ImagePlaceholder } from '@open-slide/core';",
      'export default [() => (',
      '<ImagePlaceholder hint="Logo" />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 0, [
      { kind: 'replace-placeholder-with-image', assetPath: './assets/logo.svg' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain(
      "<img src={logo} alt='Logo' style={{ objectFit: 'cover', objectPosition: '50% 50%' }} />",
    );
    expect(r.source).not.toMatch(/width:\s/);
    expect(r.source).not.toMatch(/height:\s/);
  });

  it("fills missing height with '100%' when only width is provided", () => {
    const src = [
      "import { ImagePlaceholder } from '@open-slide/core';",
      'export default [() => (',
      '<ImagePlaceholder hint="Cover" width={800} />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 0, [
      { kind: 'replace-placeholder-with-image', assetPath: './assets/cover.png' },
    ]);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    expect(r.source).toContain(
      "<img src={cover} alt='Cover' style={{ width: 800, height: '100%', objectFit: 'cover', objectPosition: '50% 50%' }} />",
    );
  });

  it('rejects when the targeted JSX is not an ImagePlaceholder', () => {
    const src = ['export default [() => (', '<div>hi</div>', ')];', ''].join('\n');
    const r = applyEdit(src, 2, 0, [
      { kind: 'replace-placeholder-with-image', assetPath: './assets/a.png' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/placeholder/);
  });

  it('rejects asset paths outside ./assets/', () => {
    const src = [
      "import { ImagePlaceholder } from '@open-slide/core';",
      'export default [() => (',
      '<ImagePlaceholder hint="x" />',
      ')];',
      '',
    ].join('\n');
    const r = applyEdit(src, 3, 0, [
      { kind: 'replace-placeholder-with-image', assetPath: '../bad.png' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error).toMatch(/\.\/assets\//);
  });
});
