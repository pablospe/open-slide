import * as t from '@babel/types';
import { walkAll } from './babel-walk.ts';
import {
  findEnclosingComponent,
  findEnclosingMapCallback,
  findJsxAttr,
  findJsxByStart,
  type Splice,
} from './edit-ops.ts';
import { type InsertSnippetOp, planInsertSnippet } from './insert-ops.ts';

export type StructureOp =
  | { kind: 'remove-element'; instanceCount?: number }
  | { kind: 'duplicate-element'; instanceCount?: number }
  | { kind: 'move-element'; direction: 'earlier' | 'later'; instanceCount?: number }
  | InsertSnippetOp;

export const STRUCTURE_OP_KINDS: ReadonlySet<string> = new Set([
  'remove-element',
  'duplicate-element',
  'move-element',
  'insert-snippet',
]);

export type StructureRefusal =
  | 'not-found'
  | 'root'
  | 'expression'
  | 'conditional'
  | 'map'
  | 'shared'
  | 'comment'
  | 'no-sibling'
  | 'sibling-not-element'
  | 'unknown-snippet'
  | 'asset-required'
  | 'page-not-found'
  | 'page-root';

export type GuardRefusal = 'root' | 'expression' | 'conditional' | 'map' | 'shared' | 'comment';

export type SourceLocation = { line: number; column: number };

export type StructurePlan =
  | { ok: true; splices: Splice[]; location?: SourceLocation }
  | { ok: false; status: number; error: string; code?: StructureRefusal };

export function isStructureOp(op: { kind: string }): op is StructureOp {
  return STRUCTURE_OP_KINDS.has(op.kind);
}

const REFUSALS: Record<StructureRefusal, string> = {
  'not-found': 'no JSX element starts at this location',
  root: 'the page or component root cannot be removed, duplicated or moved',
  expression: 'the element is inside a JSX expression, not a list of JSX children',
  conditional: 'the element is rendered conditionally',
  map: 'the element is rendered by a .map() callback',
  shared: 'the element is rendered more than once, so changing its definition affects every copy',
  comment: 'the element contains an inspector comment',
  'no-sibling': 'there is no sibling element to swap with in that direction',
  'sibling-not-element': 'the adjacent sibling is text or an expression, not a JSX element',
  'unknown-snippet': 'unknown snippet',
  'asset-required': 'this snippet needs an asset path under ./assets/ or @assets/',
  'page-not-found': 'the page could not be found in the default export',
  'page-root': 'the page does not return a JSX element that can hold children',
};

export function refuse(code: StructureRefusal): StructurePlan {
  return { ok: false, status: 422, error: REFUSALS[code], code };
}

export function findParent(ast: t.Node, target: t.Node): t.Node | null {
  let parent: t.Node | null = null;
  walkAll(ast, (node) => {
    for (const value of Object.values(node)) {
      if (value === target || (Array.isArray(value) && value.includes(target))) {
        parent = node;
        return 'stop';
      }
    }
  });
  return parent;
}

export function isBlankText(node: t.Node): boolean {
  return t.isJSXText(node) && node.value.trim() === '';
}

export function isCommentContainer(node: t.Node): boolean {
  return t.isJSXExpressionContainer(node) && t.isJSXEmptyExpression(node.expression);
}

// A component defined in this file and rendered at more than one call site
// shares its JSX: editing it structurally changes every call site at once.
export function isReusedComponent(ast: t.File, element: t.JSXElement): boolean {
  const component = findEnclosingComponent(ast, element);
  if (!component) return false;
  let uses = 0;
  walkAll(ast, (node) => {
    if (!t.isJSXOpeningElement(node)) return;
    if (t.isJSXIdentifier(node.name) && node.name.name === component.name) uses++;
  });
  return uses > 1;
}

export function offsetToLocation(source: string, offset: number): SourceLocation {
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') - 1 };
}

// The bytes an element owns on its own line(s): leading indentation through
// the newline after it. `null` when the element shares a line with other
// content (inline JSX), where only its own bytes are safe to touch.
export function ownedLines(
  source: string,
  node: t.Node | { start: number; end: number },
): { from: number; to: number } | null {
  const start = node.start ?? 0;
  const end = node.end ?? 0;
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  if (!/^[ \t]*$/.test(source.slice(lineStart, start))) return null;
  const newline = source.indexOf('\n', end);
  const lineEnd = newline === -1 ? source.length : newline;
  if (!/^[ \t]*$/.test(source.slice(end, lineEnd))) return null;
  return { from: lineStart, to: newline === -1 ? lineEnd : newline + 1 };
}

function horizontalSpaceBefore(source: string, offset: number): number {
  let from = offset;
  while (from > 0 && (source[from - 1] === ' ' || source[from - 1] === '\t')) from--;
  return from;
}

function horizontalSpaceAfter(source: string, offset: number): number {
  let to = offset;
  while (to < source.length && (source[to] === ' ' || source[to] === '\t')) to++;
  return to;
}

function removeSplice(source: string, element: t.JSXElement): Splice {
  const lines = ownedLines(source, element);
  if (lines) return { ...lines, text: '' };
  const start = element.start ?? 0;
  const end = element.end ?? 0;
  const spaceBefore = horizontalSpaceBefore(source, start) < start;
  const after = horizontalSpaceAfter(source, end);
  // `a <b/> c` → `a c`: drop one of the two surrounding runs, never both.
  return { from: start, to: spaceBefore ? after : end, text: '' };
}

// DOM ids are page-global, so every `id` in the copy is dropped. React keys
// only need to be unique among siblings: just the copied element's own `key`
// can collide, while keys of lists mapped inside the copy must stay.
function copyWithoutIdentity(source: string, element: t.JSXElement): string {
  const start = element.start ?? 0;
  const ownKey = findJsxAttr(element.openingElement, 'key');
  const cuts: { from: number; to: number }[] = [];
  walkAll(element, (node) => {
    if (!t.isJSXAttribute(node) || !t.isJSXIdentifier(node.name)) return;
    if (node.name.name !== 'id' && node !== ownKey) return;
    let from = node.start ?? 0;
    while (from > start && /\s/.test(source[from - 1])) from--;
    cuts.push({ from, to: node.end ?? 0 });
  });
  cuts.sort((a, b) => b.from - a.from);
  let text = source.slice(start, element.end ?? 0);
  for (const cut of cuts) text = text.slice(0, cut.from - start) + text.slice(cut.to - start);
  return text;
}

function duplicateSplice(
  source: string,
  element: t.JSXElement,
): { splice: Splice; copyOffset: number } {
  const start = element.start ?? 0;
  const end = element.end ?? 0;
  const lines = ownedLines(source, element);
  const separator = lines
    ? `\n${source.slice(lines.from, start)}`
    : source.slice(horizontalSpaceBefore(source, start), start);
  return {
    splice: { from: end, to: end, text: `${separator}${copyWithoutIdentity(source, element)}` },
    copyOffset: end + separator.length,
  };
}

function adjacentSibling(
  children: t.Node[],
  index: number,
  direction: 'earlier' | 'later',
): t.JSXElement | StructureRefusal {
  const step = direction === 'earlier' ? -1 : 1;
  for (let i = index + step; i >= 0 && i < children.length; i += step) {
    const child = children[i];
    if (isBlankText(child) || isCommentContainer(child)) continue;
    return t.isJSXElement(child) ? child : 'sibling-not-element';
  }
  return 'no-sibling';
}

// The JSX parent an element sits in as a plain child, or why its siblings
// cannot be rewritten without touching other renders.
export function siblingParent(
  ast: t.File,
  element: t.JSXElement,
  instanceCount = 1,
): t.JSXElement | t.JSXFragment | Exclude<GuardRefusal, 'comment'> {
  const parent = findParent(ast, element);
  if (!parent || !(t.isJSXElement(parent) || t.isJSXFragment(parent))) {
    if (t.isLogicalExpression(parent) || t.isConditionalExpression(parent)) return 'conditional';
    if (t.isJSXExpressionContainer(parent)) return 'expression';
    if (findEnclosingMapCallback(ast, element)) return 'map';
    return 'root';
  }
  if (findEnclosingMapCallback(ast, element)) return 'map';
  if (instanceCount > 1 || isReusedComponent(ast, element)) return 'shared';
  return parent;
}

// Checks shared by every op that rewrites an element's own bytes: the element
// must be a plain JSX child, rendered once, and free of inspector comments.
export function guardElement(
  ast: t.File,
  source: string,
  element: t.JSXElement,
  instanceCount = 1,
): t.JSXElement | t.JSXFragment | GuardRefusal {
  const parent = siblingParent(ast, element, instanceCount);
  if (typeof parent === 'string') return parent;
  if (source.slice(element.start ?? 0, element.end ?? 0).includes('@slide-comment'))
    return 'comment';
  return parent;
}

// Swaps two sibling elements' bytes; everything between them stays in place.
export function swapSplices(source: string, first: t.Node, second: t.Node): Splice[] {
  return [
    {
      from: first.start ?? 0,
      to: first.end ?? 0,
      text: source.slice(second.start ?? 0, second.end ?? 0),
    },
    {
      from: second.start ?? 0,
      to: second.end ?? 0,
      text: source.slice(first.start ?? 0, first.end ?? 0),
    },
  ];
}

export function planStructureEdit(
  ast: t.File,
  source: string,
  line: number,
  column: number,
  op: StructureOp,
): StructurePlan {
  if (op.kind === 'insert-snippet') return planInsertSnippet(ast, source, line, column, op);
  const element = findJsxByStart(ast, line, column);
  if (!element) return refuse('not-found');
  const parent = guardElement(ast, source, element, op.instanceCount);
  if (typeof parent === 'string') return refuse(parent);

  if (op.kind === 'remove-element') return { ok: true, splices: [removeSplice(source, element)] };

  if (op.kind === 'duplicate-element') {
    const { splice, copyOffset } = duplicateSplice(source, element);
    const next = source.slice(0, splice.from) + splice.text + source.slice(splice.to);
    return { ok: true, splices: [splice], location: offsetToLocation(next, copyOffset) };
  }

  const sibling = adjacentSibling(parent.children, parent.children.indexOf(element), op.direction);
  if (typeof sibling === 'string') return refuse(sibling);
  const [first, second] = op.direction === 'earlier' ? [sibling, element] : [element, sibling];
  const firstText = source.slice(first.start ?? 0, first.end ?? 0);
  const secondText = source.slice(second.start ?? 0, second.end ?? 0);
  const splices = swapSplices(source, first, second);
  const movedOffset =
    op.direction === 'earlier'
      ? (first.start ?? 0)
      : (second.start ?? 0) + secondText.length - firstText.length;
  const next =
    source.slice(0, first.start ?? 0) +
    secondText +
    source.slice(first.end ?? 0, second.start ?? 0) +
    firstText +
    source.slice(second.end ?? 0);
  return { ok: true, splices, location: offsetToLocation(next, movedOffset) };
}
