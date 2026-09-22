import * as t from '@babel/types';
import { walkAll } from './babel-walk.ts';
import { findJsxAttr, findJsxByStart, type Splice } from './edit-ops.ts';
import {
  findParent,
  type GuardRefusal,
  guardElement,
  isBlankText,
  offsetToLocation,
  ownedLines,
  type SourceLocation,
  swapSplices,
} from './structure-ops.ts';

export type StepOp =
  | { kind: 'wrap-in-step'; instanceCount?: number }
  | { kind: 'unwrap-step'; instanceCount?: number }
  | { kind: 'move-step'; direction: 'earlier' | 'later'; instanceCount?: number }
  | { kind: 'set-step-duration'; value: number | null; instanceCount?: number };

export const STEP_OP_KINDS: ReadonlySet<string> = new Set([
  'wrap-in-step',
  'unwrap-step',
  'move-step',
  'set-step-duration',
]);

export type StepRefusal =
  | 'not-found'
  | GuardRefusal
  | 'already-step'
  | 'parent-not-host'
  | 'mixed-children'
  | 'name-conflict'
  | 'not-step'
  | 'step-has-siblings'
  | 'no-step-sibling'
  | 'invalid-duration';

export type StepPlan =
  | { ok: true; splices: Splice[]; location?: SourceLocation }
  | { ok: false; status: number; error: string; code: StepRefusal };

export type StepActionId = 'wrap' | 'unwrap' | 'earlier' | 'later' | 'duration';

export type StepInfo = {
  inStep: boolean;
  index: number | null;
  count: number | null;
  duration: number | null;
  actions: Record<StepActionId, StepRefusal | null>;
};

export const MAX_STEP_DURATION = 60000;

export function isStepOp(op: { kind: string }): op is StepOp {
  return STEP_OP_KINDS.has(op.kind);
}

const REFUSALS: Record<StepRefusal, string> = {
  'not-found': 'no JSX element starts at this location',
  root: 'the page or component root cannot be a step',
  expression: 'the element is inside a JSX expression, not a list of JSX children',
  conditional: 'the element is rendered conditionally',
  map: 'the element is rendered by a .map() callback',
  shared: 'the element is rendered more than once, so changing its definition affects every copy',
  comment: 'the element or its siblings contain an inspector comment',
  'already-step': 'the element is already a step',
  'parent-not-host':
    'the parent is a component or fragment, so it cannot be turned into a <Steps> container',
  'mixed-children':
    'the parent also holds text or expressions, which cannot be moved into a <Steps> container',
  'name-conflict': 'this file already defines another Step or Steps',
  'not-step': 'the element is not a step',
  'step-has-siblings': 'the step holds more than one child, so it cannot be unwrapped',
  'no-step-sibling': 'there is no other step in that direction',
  'invalid-duration': `the duration must be a number of milliseconds between 0 and ${MAX_STEP_DURATION}`,
};

function refuse(code: StepRefusal): StepPlan & { ok: false } {
  return { ok: false, status: 422, error: REFUSALS[code], code };
}

const CORE_MODULE = '@open-slide/core';
const MARK = '\u0000';

type Names = { step: string; steps: string };

function coreImports(ast: t.File): t.ImportDeclaration[] {
  return ast.program.body.filter(
    (node): node is t.ImportDeclaration =>
      t.isImportDeclaration(node) &&
      node.source.value === CORE_MODULE &&
      node.importKind !== 'type' &&
      node.importKind !== 'typeof',
  );
}

function importedLocal(ast: t.File, imported: string): string | null {
  for (const decl of coreImports(ast)) {
    for (const spec of decl.specifiers) {
      if (!t.isImportSpecifier(spec) || spec.importKind === 'type') continue;
      const name = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
      if (name === imported) return spec.local.name;
    }
  }
  return null;
}

function topLevelBindings(ast: t.File): Set<string> {
  const names = new Set<string>();
  for (const node of ast.program.body) {
    const decl =
      t.isExportNamedDeclaration(node) || t.isExportDefaultDeclaration(node)
        ? node.declaration
        : node;
    if (t.isImportDeclaration(decl)) {
      for (const spec of decl.specifiers) names.add(spec.local.name);
    } else if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.id) {
      names.add(decl.id.name);
    } else if (t.isVariableDeclaration(decl)) {
      for (const d of decl.declarations) if (t.isIdentifier(d.id)) names.add(d.id.name);
    }
  }
  return names;
}

function resolveNames(ast: t.File): { names: Names; missing: string[] } | null {
  const bound = topLevelBindings(ast);
  const missing: string[] = [];
  const resolve = (name: string) => {
    const local = importedLocal(ast, name);
    if (local) return local;
    if (bound.has(name)) return null;
    missing.push(name);
    return name;
  };
  const step = resolve('Step');
  const steps = resolve('Steps');
  if (!step || !steps) return null;
  return { names: { step, steps }, missing };
}

function knownNames(ast: t.File): Names {
  return {
    step: importedLocal(ast, 'Step') ?? 'Step',
    steps: importedLocal(ast, 'Steps') ?? 'Steps',
  };
}

function isNamed(node: t.Node | null, name: string): boolean {
  return (
    t.isJSXElement(node) &&
    t.isJSXIdentifier(node.openingElement.name) &&
    node.openingElement.name.name === name
  );
}

function isHostElement(node: t.Node): node is t.JSXElement {
  return (
    t.isJSXElement(node) &&
    t.isJSXIdentifier(node.openingElement.name) &&
    /^[a-z]/.test(node.openingElement.name.name)
  );
}

function contentChildren(node: t.JSXElement | t.JSXFragment): t.Node[] {
  return node.children.filter((child) => !isBlankText(child));
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', offset - 1) + 1;
}

function lineIndent(source: string, offset: number): string {
  const from = lineStart(source, offset);
  return /^[ \t]*/.exec(source.slice(from))?.[0] ?? '';
}

function indentUnit(source: string, child: t.Node, parent: t.Node): string {
  const inner = lineIndent(source, child.start ?? 0);
  const outer = lineIndent(source, parent.start ?? 0);
  if (inner.length > outer.length && inner.startsWith(outer)) return inner.slice(outer.length);
  return /^\t/m.test(source) ? '\t' : '  ';
}

// Line starts inside string or template literals are content, not layout:
// shifting them would change the string's value.
function literalRanges(ast: t.File): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  walkAll(ast, (node) => {
    if (t.isTemplateLiteral(node) || t.isStringLiteral(node))
      ranges.push({ start: node.start ?? 0, end: node.end ?? 0 });
  });
  return ranges;
}

type Ctx = { ast: t.File; source: string; literals: { start: number; end: number }[] };

function shiftableLine(ctx: Ctx, newline: number): boolean {
  const from = newline + 1;
  const next = ctx.source.indexOf('\n', from);
  const line = ctx.source.slice(from, next === -1 ? ctx.source.length : next);
  if (line.trim() === '') return false;
  return !ctx.literals.some((r) => r.start < from && from < r.end);
}

// The wrapped content moves one level deeper; every other byte stays put.
function indented(ctx: Ctx, from: number, to: number, unit: string): string {
  if (!unit) return ctx.source.slice(from, to);
  let out = '';
  let cursor = from;
  for (let nl = ctx.source.indexOf('\n', from); nl !== -1 && nl < to; ) {
    out += ctx.source.slice(cursor, nl + 1);
    if (shiftableLine(ctx, nl)) out += unit;
    cursor = nl + 1;
    nl = ctx.source.indexOf('\n', cursor);
  }
  return out + ctx.source.slice(cursor, to);
}

function dedented(ctx: Ctx, from: number, to: number, unit: string): string {
  if (!unit) return ctx.source.slice(from, to);
  let out = '';
  let cursor = from;
  for (let nl = ctx.source.indexOf('\n', from); nl !== -1 && nl < to; ) {
    out += ctx.source.slice(cursor, nl + 1);
    cursor = nl + 1;
    if (shiftableLine(ctx, nl) && ctx.source.startsWith(unit, cursor)) cursor += unit.length;
    nl = ctx.source.indexOf('\n', cursor);
  }
  return out + ctx.source.slice(cursor, to);
}

function stepWrapText(
  ctx: Ctx,
  element: t.JSXElement,
  step: string,
  unit: string,
  outerShift: string,
): string {
  const start = element.start ?? 0;
  const end = element.end ?? 0;
  if (!ownedLines(ctx.source, element)) {
    return `<${step}>${MARK}${indented(ctx, start, end, outerShift)}</${step}>`;
  }
  const ind = outerShift + lineIndent(ctx.source, start);
  return `<${step}>\n${ind}${unit}${MARK}${indented(ctx, start, end, outerShift + unit)}\n${ind}</${step}>`;
}

function importSplice(ast: t.File, source: string, missing: string[]): Splice | null {
  if (!missing.length) return null;
  const decl = coreImports(ast).find(
    (d) => !d.specifiers.some((spec) => t.isImportNamespaceSpecifier(spec)),
  );
  const named = decl?.specifiers.filter((spec) => t.isImportSpecifier(spec)) ?? [];
  const last = named.at(-1);
  if (decl && last) {
    const close = source.indexOf('}', last.end ?? 0);
    const between = source.slice(last.end ?? 0, close);
    if (!between.includes('\n')) {
      return { from: last.end ?? 0, to: last.end ?? 0, text: `, ${missing.join(', ')}` };
    }
    const ind = lineIndent(source, last.start ?? 0);
    const comma = between.indexOf(',');
    if (comma === -1) {
      const text = missing.map((name) => `,\n${ind}${name}`).join('');
      return { from: last.end ?? 0, to: last.end ?? 0, text };
    }
    const at = (last.end ?? 0) + comma + 1;
    return { from: at, to: at, text: missing.map((name) => `\n${ind}${name},`).join('') };
  }
  const defaultSpec = decl?.specifiers.find((spec) => t.isImportDefaultSpecifier(spec));
  if (decl && defaultSpec && decl.specifiers.length === 1) {
    const at = defaultSpec.end ?? 0;
    return { from: at, to: at, text: `, { ${missing.join(', ')} }` };
  }
  const imports = ast.program.body.filter((node) => t.isImportDeclaration(node));
  const lastImport = imports.at(-1);
  const quote = lastImport ? source[lastImport.source.start ?? 0] : "'";
  const semi = !lastImport || source[(lastImport.end ?? 0) - 1] === ';' ? ';' : '';
  const line = `import { ${missing.join(', ')} } from ${quote}${CORE_MODULE}${quote}${semi}`;
  if (lastImport) return { from: lastImport.end ?? 0, to: lastImport.end ?? 0, text: `\n${line}` };
  const first = ast.program.body[0];
  const directive = ast.program.directives.at(-1);
  if (directive) return { from: directive.end ?? 0, to: directive.end ?? 0, text: `\n${line}` };
  return { from: first?.start ?? 0, to: first?.start ?? 0, text: `${line}\n` };
}

// The target's new position is marked inside the rewritten text so its
// location can be read back after every splice has been applied.
function finish(source: string, splices: Splice[]): StepPlan {
  let next = source;
  for (const sp of [...splices].sort((a, b) => b.from - a.from)) {
    next = next.slice(0, sp.from) + sp.text + next.slice(sp.to);
  }
  const at = next.indexOf(MARK);
  const clean = splices
    .map((sp) => ({ ...sp, text: sp.text.replace(MARK, '') }))
    .filter((sp) => sp.text || sp.from !== sp.to);
  if (at === -1 || source.includes(MARK)) return { ok: true, splices: clean };
  return { ok: true, splices: clean, location: offsetToLocation(next.replace(MARK, ''), at) };
}

function markAt(offset: number): Splice {
  return { from: offset, to: offset, text: MARK };
}

function planWrap(ctx: Ctx, element: t.JSXElement, parent: t.JSXElement | t.JSXFragment): StepPlan {
  const { ast, source } = ctx;
  const known = knownNames(ast);
  if (isNamed(element, known.step) || isNamed(element, known.steps) || isNamed(parent, known.step))
    return refuse('already-step');
  const resolved = resolveNames(ast);
  if (!resolved) return refuse('name-conflict');
  const { names, missing } = resolved;
  const imports = importSplice(ast, source, missing);
  const withImports = (splice: Splice) => finish(source, imports ? [imports, splice] : [splice]);

  if (isNamed(parent, names.steps)) {
    const unit = indentUnit(source, element, parent);
    const text = stepWrapText(ctx, element, names.step, unit, '');
    return withImports({ from: element.start ?? 0, to: element.end ?? 0, text });
  }
  if (!isHostElement(parent)) return refuse('parent-not-host');
  const children = contentChildren(parent);
  if (children.some((child) => !t.isJSXElement(child))) return refuse('mixed-children');
  const first = children[0];
  const last = children.at(-1) ?? first;
  const run = { start: first.start ?? 0, end: last.end ?? 0 };
  if (source.slice(run.start, run.end).includes('@slide-comment')) return refuse('comment');

  const unit = indentUnit(source, first, parent);
  const block = !!ownedLines(source, run);
  const shift = block ? unit : '';
  const body =
    indented(ctx, run.start, element.start ?? 0, shift) +
    stepWrapText(ctx, element, names.step, unit, shift) +
    indented(ctx, element.end ?? 0, run.end, shift);
  const ind = lineIndent(source, run.start);
  const text = block
    ? `<${names.steps}>\n${ind}${unit}${body}\n${ind}</${names.steps}>`
    : `<${names.steps}>${body}</${names.steps}>`;
  return withImports({ from: run.start, to: run.end, text });
}

function enclosingStep(
  ast: t.File,
  element: t.JSXElement,
  names: Names,
): { step: t.JSXElement; steps: t.JSXElement | null } | null {
  const parent = findParent(ast, element);
  if (!t.isJSXElement(parent) || !isNamed(parent, names.step)) return null;
  const grand = findParent(ast, parent);
  return {
    step: parent,
    steps: t.isJSXElement(grand) && isNamed(grand, names.steps) ? grand : null,
  };
}

function stepSiblings(steps: t.JSXElement, names: Names): t.JSXElement[] {
  return steps.children.filter(
    (child): child is t.JSXElement => t.isJSXElement(child) && isNamed(child, names.step),
  );
}

function planUnwrap(ctx: Ctx, element: t.JSXElement, step: t.JSXElement): StepPlan {
  const { source } = ctx;
  if (contentChildren(step).length !== 1) return refuse('step-has-siblings');
  const start = element.start ?? 0;
  const end = element.end ?? 0;
  const stepIndent = lineIndent(source, step.start ?? 0);
  const innerIndent = lineIndent(source, start);
  const block =
    !!ownedLines(source, step) &&
    !!ownedLines(source, element) &&
    innerIndent.startsWith(stepIndent);
  const text = block
    ? MARK + dedented(ctx, start, end, innerIndent.slice(stepIndent.length))
    : MARK + source.slice(start, end);
  return finish(source, [{ from: step.start ?? 0, to: step.end ?? 0, text }]);
}

function planMove(
  ctx: Ctx,
  element: t.JSXElement,
  step: t.JSXElement,
  steps: t.JSXElement,
  direction: 'earlier' | 'later',
  names: Names,
): StepPlan {
  const siblings = stepSiblings(steps, names);
  const index = siblings.indexOf(step);
  const other = siblings[direction === 'earlier' ? index - 1 : index + 1];
  if (!other) return refuse('no-step-sibling');
  if (ctx.source.slice(other.start ?? 0, other.end ?? 0).includes('@slide-comment'))
    return refuse('comment');
  const [first, second] = direction === 'earlier' ? [other, step] : [step, other];
  const splices = swapSplices(ctx.source, first, second);
  const moved = splices[direction === 'earlier' ? 0 : 1];
  const at = (element.start ?? 0) - (step.start ?? 0);
  moved.text = moved.text.slice(0, at) + MARK + moved.text.slice(at);
  return finish(ctx.source, splices);
}

function planDuration(
  ctx: Ctx,
  element: t.JSXElement,
  step: t.JSXElement,
  value: unknown,
): StepPlan {
  const { source } = ctx;
  if (
    value !== null &&
    (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_STEP_DURATION)
  )
    return refuse('invalid-duration');
  const opening = step.openingElement;
  const attr = findJsxAttr(opening, 'duration');
  const mark = markAt(element.start ?? 0);
  if (value === null) {
    if (!attr) return { ok: true, splices: [] };
    let from = attr.start ?? 0;
    while (from > 0 && /[ \t]/.test(source[from - 1])) from--;
    return finish(source, [{ from, to: attr.end ?? 0, text: '' }, mark]);
  }
  const text = `{${Math.round(value)}}`;
  if (attr?.value) {
    if (source.slice(attr.value.start ?? 0, attr.value.end ?? 0) === text)
      return { ok: true, splices: [] };
    return finish(source, [{ from: attr.value.start ?? 0, to: attr.value.end ?? 0, text }, mark]);
  }
  if (attr)
    return finish(source, [{ from: attr.end ?? 0, to: attr.end ?? 0, text: `=${text}` }, mark]);
  const at = opening.name.end ?? 0;
  return finish(source, [{ from: at, to: at, text: ` duration=${text}` }, mark]);
}

export function planStepEdit(
  ast: t.File,
  source: string,
  line: number,
  column: number,
  op: StepOp,
): StepPlan {
  const element = findJsxByStart(ast, line, column);
  if (!element) return refuse('not-found');
  const ctx: Ctx = { ast, source, literals: literalRanges(ast) };
  const parent = guardElement(ast, source, element, op.instanceCount);
  if (typeof parent === 'string') return refuse(parent);
  if (op.kind === 'wrap-in-step') return planWrap(ctx, element, parent);

  const names = knownNames(ast);
  const enclosing = enclosingStep(ast, element, names);
  if (!enclosing) return refuse('not-step');
  const stepGuard = guardElement(ast, source, enclosing.step);
  if (typeof stepGuard === 'string') return refuse(stepGuard);

  if (op.kind === 'unwrap-step') return planUnwrap(ctx, element, enclosing.step);
  if (op.kind === 'set-step-duration') return planDuration(ctx, element, enclosing.step, op.value);
  if (!enclosing.steps) return refuse('not-step');
  return planMove(ctx, element, enclosing.step, enclosing.steps, op.direction, names);
}

function readDuration(step: t.JSXElement): number | null {
  const value = findJsxAttr(step.openingElement, 'duration')?.value;
  if (!value || !t.isJSXExpressionContainer(value) || !t.isNumericLiteral(value.expression))
    return null;
  return value.expression.value;
}

export function stepInfo(
  ast: t.File,
  source: string,
  line: number,
  column: number,
  instanceCount = 1,
): StepInfo {
  const code = (op: StepOp): StepRefusal | null => {
    const plan = planStepEdit(ast, source, line, column, { ...op, instanceCount });
    return plan.ok ? null : plan.code;
  };
  const actions: Record<StepActionId, StepRefusal | null> = {
    wrap: code({ kind: 'wrap-in-step' }),
    unwrap: code({ kind: 'unwrap-step' }),
    earlier: code({ kind: 'move-step', direction: 'earlier' }),
    later: code({ kind: 'move-step', direction: 'later' }),
    duration: code({ kind: 'set-step-duration', value: 0 }),
  };
  const element = findJsxByStart(ast, line, column);
  const names = knownNames(ast);
  const enclosing = element ? enclosingStep(ast, element, names) : null;
  if (!enclosing) return { inStep: false, index: null, count: null, duration: null, actions };
  const siblings = enclosing.steps ? stepSiblings(enclosing.steps, names) : null;
  return {
    inStep: true,
    index: siblings ? siblings.indexOf(enclosing.step) + 1 : null,
    count: siblings ? siblings.length : null,
    duration: readDuration(enclosing.step),
    actions,
  };
}
