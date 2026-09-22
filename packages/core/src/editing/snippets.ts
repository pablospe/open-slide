export type SnippetId = 'heading' | 'paragraph' | 'bullet-list' | 'box' | 'image' | 'two-column';

export type SnippetStyle = Record<string, string | number>;

export type SnippetNode = {
  tag: string;
  style?: SnippetStyle;
  attrs?: Record<string, string | { asset: true }>;
  children?: Array<SnippetNode | string>;
};

export type Snippet = {
  id: SnippetId;
  root: SnippetNode;
  needsAsset?: boolean;
};

const bodyText: SnippetStyle = {
  fontFamily: 'var(--osd-font-body)',
  fontSize: 36,
  lineHeight: 1.5,
  color: 'var(--osd-text)',
};

export const SNIPPETS: readonly Snippet[] = [
  {
    id: 'heading',
    root: {
      tag: 'h2',
      style: {
        margin: 0,
        fontFamily: 'var(--osd-font-display)',
        fontSize: 96,
        fontWeight: 700,
        lineHeight: 1.1,
        color: 'var(--osd-text)',
      },
      children: ['Heading'],
    },
  },
  {
    id: 'paragraph',
    root: {
      tag: 'p',
      style: { margin: 0, ...bodyText },
      children: ['Write your text here.'],
    },
  },
  {
    id: 'bullet-list',
    root: {
      tag: 'ul',
      style: { margin: 0, paddingLeft: '1.2em', ...bodyText },
      children: [
        { tag: 'li', children: ['First point'] },
        { tag: 'li', children: ['Second point'] },
        { tag: 'li', children: ['Third point'] },
      ],
    },
  },
  {
    id: 'box',
    root: {
      tag: 'div',
      style: {
        padding: 48,
        border: '2px solid var(--osd-accent)',
        borderRadius: 'var(--osd-radius)',
        ...bodyText,
      },
      children: ['Box content'],
    },
  },
  {
    id: 'image',
    needsAsset: true,
    root: {
      tag: 'img',
      attrs: { src: { asset: true }, alt: '' },
      style: {
        width: 800,
        height: 450,
        objectFit: 'cover',
        borderRadius: 'var(--osd-radius)',
      },
    },
  },
  {
    id: 'two-column',
    root: {
      tag: 'div',
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64 },
      children: [
        { tag: 'div', style: bodyText, children: ['Left column'] },
        { tag: 'div', style: bodyText, children: ['Right column'] },
      ],
    },
  },
];

export function findSnippet(id: unknown): Snippet | null {
  return SNIPPETS.find((snippet) => snippet.id === id) ?? null;
}

const LINE_WIDTH = 100;

function jsValue(value: string | number): string {
  if (typeof value === 'number') return String(value);
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function attrText(name: string, value: string | { asset: true }, assetIdentifier: string): string {
  return typeof value === 'string' ? `${name}="${value}"` : `${name}={${assetIdentifier}}`;
}

function styleEntries(style: SnippetStyle): string[] {
  return Object.entries(style).map(([key, value]) => `${key}: ${jsValue(value)}`);
}

// The layout follows what biome/prettier would print at a 100-column line
// width, measured from the column the snippet lands at.
function renderNode(
  node: SnippetNode,
  pad: string,
  unit: string,
  assetIdentifier: string,
): string[] {
  const inner = pad + unit;
  const attrs = Object.entries(node.attrs ?? {}).map(([name, value]) =>
    attrText(name, value, assetIdentifier),
  );
  const style = node.style ? styleEntries(node.style) : [];
  const children = node.children ?? [];
  const selfClosing = children.length === 0;
  const inlineAttrs = [...attrs, ...(style.length ? [`style={{ ${style.join(', ')} }}`] : [])];
  const inlineOpening = `<${node.tag}${inlineAttrs.map((a) => ` ${a}`).join('')}${selfClosing ? ' />' : '>'}`;
  const onlyText = children.length === 1 && typeof children[0] === 'string' ? children[0] : null;

  if (pad.length + inlineOpening.length <= LINE_WIDTH) {
    if (selfClosing) return [pad + inlineOpening];
    const oneLine = `${pad}${inlineOpening}${onlyText ?? ''}</${node.tag}>`;
    if (onlyText !== null && oneLine.length <= LINE_WIDTH) return [oneLine];
    return [
      pad + inlineOpening,
      ...renderChildren(children, inner, unit, assetIdentifier),
      `${pad}</${node.tag}>`,
    ];
  }

  const opening = [
    `${pad}<${node.tag}`,
    ...attrs.map((a) => inner + a),
    ...(style.length
      ? [`${inner}style={{`, ...style.map((entry) => `${inner}${unit}${entry},`), `${inner}}}`]
      : []),
  ];
  if (selfClosing) return [...opening, `${pad}/>`];
  return [
    ...opening,
    `${pad}>`,
    ...renderChildren(children, inner, unit, assetIdentifier),
    `${pad}</${node.tag}>`,
  ];
}

function renderChildren(
  children: Array<SnippetNode | string>,
  pad: string,
  unit: string,
  assetIdentifier: string,
): string[] {
  return children.flatMap((child) =>
    typeof child === 'string' ? [pad + child] : renderNode(child, pad, unit, assetIdentifier),
  );
}

export function renderSnippetTsx(
  snippet: Snippet,
  { indent = '', unit = '  ', assetIdentifier = 'image' } = {},
): string {
  return renderNode(snippet.root, indent, unit, assetIdentifier).join('\n').slice(indent.length);
}
