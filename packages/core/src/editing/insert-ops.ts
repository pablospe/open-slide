import * as t from '@babel/types';
import { walkAll, walkJsx } from './babel-walk.ts';
import { findJsxByStart, planAssetImport, type Splice } from './edit-ops.ts';
import { findSnippet, renderSnippetTsx } from './snippets.ts';
import {
  isBlankText,
  offsetToLocation,
  ownedLines,
  refuse,
  type StructurePlan,
  type StructureRefusal,
  siblingParent,
} from './structure-ops.ts';

export type InsertPosition = 'after-selection' | 'end-of-page';

export type InsertSnippetOp = {
  kind: 'insert-snippet';
  snippetId: string;
  position: InsertPosition;
  pageIndex?: number;
  assetPath?: string;
  instanceCount?: number;
};

type JsxParent = t.JSXElement | t.JSXFragment;

function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? '';
}

function startsLine(source: string, node: t.Node): boolean {
  const start = node.start ?? 0;
  return /^[ \t]*$/.test(source.slice(source.lastIndexOf('\n', start - 1) + 1, start));
}

// Measured between JSX parents and children that each start their own line,
// so comments, strings and template literals never skew it.
function indentUnit(ast: t.File, source: string): string {
  const steps: string[] = [];
  walkJsx(ast, (node) => {
    if ((!t.isJSXElement(node) && !t.isJSXFragment(node)) || !startsLine(source, node)) return;
    const parentIndent = lineIndent(source, node.start ?? 0);
    for (const child of node.children) {
      if (!(t.isJSXElement(child) || t.isJSXFragment(child)) || !startsLine(source, child))
        continue;
      const childIndent = lineIndent(source, child.start ?? 0);
      if (childIndent.length > parentIndent.length && childIndent.startsWith(parentIndent)) {
        steps.push(childIndent.slice(parentIndent.length));
      }
    }
  });
  if (steps.some((step) => step.includes('\t'))) return '\t';
  const smallest = Math.min(...steps.map((step) => step.length));
  return Number.isFinite(smallest) && smallest <= 8 ? ' '.repeat(smallest) : '  ';
}

function unwrapTs(node: t.Node | null | undefined): t.Node | null | undefined {
  let current = node;
  while (
    current &&
    (t.isTSAsExpression(current) ||
      t.isTSSatisfiesExpression(current) ||
      t.isTSNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

type PageFn = t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;

function isPageFn(node: t.Node | null | undefined): node is PageFn {
  return (
    t.isArrowFunctionExpression(node) ||
    t.isFunctionExpression(node) ||
    t.isFunctionDeclaration(node)
  );
}

function findTopLevelFunction(ast: t.File, name: string): PageFn | null {
  for (const stmt of ast.program.body) {
    const decl =
      t.isExportNamedDeclaration(stmt) || t.isExportDefaultDeclaration(stmt)
        ? stmt.declaration
        : stmt;
    if (t.isFunctionDeclaration(decl) && decl.id?.name === name) return decl;
    if (!t.isVariableDeclaration(decl)) continue;
    for (const d of decl.declarations) {
      if (!t.isIdentifier(d.id) || d.id.name !== name) continue;
      const init = unwrapTs(d.init);
      return isPageFn(init) ? init : null;
    }
  }
  return null;
}

function returnedJsx(fn: PageFn): JsxParent | StructureRefusal {
  let body: t.Node | null | undefined = fn.body;
  if (t.isBlockStatement(body)) {
    const nested: t.Node[] = [];
    const returns: t.ReturnStatement[] = [];
    walkAll(body, (node) => {
      if (isPageFn(node) || t.isObjectMethod(node) || t.isClassMethod(node)) nested.push(node);
      else if (t.isReturnStatement(node)) returns.push(node);
    });
    const own = returns.filter(
      (ret) =>
        !nested.some(
          (fnNode) =>
            (fnNode.start ?? 0) <= (ret.start ?? 0) && (ret.end ?? 0) <= (fnNode.end ?? 0),
        ),
    );
    if (own.length > 1) return 'conditional';
    if (own.length === 0 || !body.body.includes(own[0])) return 'page-root';
    body = own[0].argument;
  }
  body = unwrapTs(body);
  if (t.isJSXElement(body) || t.isJSXFragment(body)) return body;
  if (t.isConditionalExpression(body) || t.isLogicalExpression(body)) return 'conditional';
  return 'page-root';
}

export function findPageRoot(ast: t.File, pageIndex: number): JsxParent | StructureRefusal {
  const exported = ast.program.body.find((stmt) => t.isExportDefaultDeclaration(stmt));
  const pages = unwrapTs(exported?.declaration);
  if (!t.isArrayExpression(pages) || !Number.isInteger(pageIndex) || pageIndex < 0)
    return 'page-not-found';
  const entry = unwrapTs(pages.elements[pageIndex]);
  if (!entry) return 'page-not-found';
  if (isPageFn(entry)) return returnedJsx(entry);
  if (!t.isIdentifier(entry)) return 'page-not-found';
  const uses = pages.elements.filter((el) => t.isIdentifier(unwrapTs(el), { name: entry.name }));
  if (uses.length > 1) return 'shared';
  const fn = findTopLevelFunction(ast, entry.name);
  return fn ? returnedJsx(fn) : 'page-not-found';
}

function isAssetPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(\.\/assets\/|@assets\/)[^\\\n\r]+$/.test(value) &&
    !value.split('/').includes('..')
  );
}

function meaningfulEnd(source: string, node: t.Node): number {
  const end = node.end ?? 0;
  if (!t.isJSXText(node)) return end;
  const raw = source.slice(node.start ?? 0, end);
  return (node.start ?? 0) + raw.trimEnd().length;
}

type Insertion = { splice: Splice; offset: number };

// `render(indent)` returns the snippet text for a first line that starts at
// `indent`; `offset` is where the snippet's `<` lands in the new source.
function insertAfter(
  source: string,
  element: t.JSXElement,
  render: (indent: string) => string,
): Insertion {
  const end = element.end ?? 0;
  const lines = ownedLines(source, element);
  const indent = lineIndent(source, element.start ?? 0);
  const separator = lines ? `\n${indent}` : ' ';
  return {
    splice: { from: end, to: end, text: separator + render(indent) },
    offset: end + separator.length,
  };
}

function insertLastChild(
  source: string,
  root: JsxParent,
  unit: string,
  render: (indent: string) => string,
): Insertion | StructureRefusal {
  const rootIndent = lineIndent(source, root.start ?? 0);
  const opening = t.isJSXElement(root) ? root.openingElement : root.openingFragment;

  if (t.isJSXElement(root) && root.openingElement.selfClosing) {
    const name = root.openingElement.name;
    if (!t.isJSXIdentifier(name) || !/^[a-z]/.test(name.name)) return 'page-root';
    const openEnd = opening.end ?? 0;
    const slash = source.lastIndexOf('/>', openEnd);
    let from = slash;
    while (from > 0 && /[ \t]/.test(source[from - 1])) from--;
    if (source[from - 1] === '\n') from = slash;
    const childIndent = rootIndent + unit;
    const prefix = `>\n${childIndent}`;
    return {
      splice: {
        from,
        to: openEnd,
        text: `${prefix}${render(childIndent)}\n${rootIndent}</${name.name}>`,
      },
      offset: from + prefix.length,
    };
  }

  const closing = t.isJSXElement(root) ? root.closingElement : root.closingFragment;
  const closeStart = closing?.start ?? 0;
  const children = root.children.filter((child) => !isBlankText(child));
  const last = children.at(-1);
  if (!last) {
    const childIndent = rootIndent + unit;
    const prefix = `\n${childIndent}`;
    const from = opening.end ?? 0;
    return {
      splice: { from, to: closeStart, text: `${prefix}${render(childIndent)}\n${rootIndent}` },
      offset: from + prefix.length,
    };
  }

  const lastEnd = meaningfulEnd(source, last);
  const lastOnOwnLine = /^[ \t]*$/.test(
    source.slice(source.lastIndexOf('\n', (last.start ?? 0) - 1) + 1, last.start ?? 0),
  );
  const childIndent =
    lastOnOwnLine && !t.isJSXText(last) ? lineIndent(source, last.start ?? 0) : rootIndent + unit;
  const prefix = `\n${childIndent}`;
  const tail = source.slice(lastEnd, closeStart);
  if (tail.includes('\n') && tail.trim() === '') {
    return {
      splice: { from: lastEnd, to: lastEnd, text: prefix + render(childIndent) },
      offset: lastEnd + prefix.length,
    };
  }
  return {
    splice: {
      from: lastEnd,
      to: closeStart,
      text: `${prefix}${render(childIndent)}\n${rootIndent}`,
    },
    offset: lastEnd + prefix.length,
  };
}

export function planInsertSnippet(
  ast: t.File,
  source: string,
  line: number,
  column: number,
  op: InsertSnippetOp,
): StructurePlan {
  const snippet = findSnippet(op.snippetId);
  if (!snippet) return refuse('unknown-snippet');
  if (snippet.needsAsset && !isAssetPath(op.assetPath)) return refuse('asset-required');

  const imported = snippet.needsAsset ? planAssetImport(ast, op.assetPath as string) : null;
  const unit = indentUnit(ast, source);
  const render = (indent: string) =>
    renderSnippetTsx(snippet, { indent, unit, assetIdentifier: imported?.identifier });

  let insertion: Insertion | StructureRefusal;
  if (op.position === 'after-selection') {
    const element = findJsxByStart(ast, line, column);
    if (!element) return refuse('not-found');
    const parent = siblingParent(ast, element, op.instanceCount);
    // A selected page root has no siblings; the block goes inside it instead.
    if (
      parent === 'root' &&
      op.pageIndex !== undefined &&
      findPageRoot(ast, op.pageIndex) === element
    )
      insertion = insertLastChild(source, element, unit, render);
    else if (typeof parent === 'string') return refuse(parent);
    else insertion = insertAfter(source, element, render);
  } else if (op.position === 'end-of-page') {
    const root = findPageRoot(ast, op.pageIndex ?? -1);
    insertion = typeof root === 'string' ? root : insertLastChild(source, root, unit, render);
  } else {
    return { ok: false, status: 400, error: 'invalid insert position' };
  }
  if (typeof insertion === 'string') return refuse(insertion);

  const splices = [insertion.splice];
  let offset = insertion.offset;
  if (imported?.importSplice) {
    splices.push(imported.importSplice);
    if (imported.importSplice.from <= insertion.splice.from) {
      offset += imported.importSplice.text.length;
    }
  }
  let next = source;
  for (const sp of [...splices].sort((a, b) => b.from - a.from)) {
    next = next.slice(0, sp.from) + sp.text + next.slice(sp.to);
  }
  return { ok: true, splices, location: offsetToLocation(next, offset) };
}
