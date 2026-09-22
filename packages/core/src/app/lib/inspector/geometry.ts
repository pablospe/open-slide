export type Point = { x: number; y: number };

export type Rect = Point & { width: number; height: number };

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export type GuideKind = 'object' | 'third' | 'grid';

export type Guide = {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  kind?: GuideKind;
};

export type SnapOptions = {
  canvas?: Pick<Rect, 'width' | 'height'>;
  thirds?: boolean;
  grid?: number | null;
};

export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

function anchors(rect: Rect, axis: 'x' | 'y'): number[] {
  const size = axis === 'x' ? rect.width : rect.height;
  return [rect[axis], rect[axis] + size / 2, rect[axis] + size];
}

function canvasSize(canvas: Pick<Rect, 'width' | 'height'>, axis: 'x' | 'y'): number {
  return axis === 'x' ? canvas.width : canvas.height;
}

export function thirdLines(canvas: Pick<Rect, 'width' | 'height'>, axis: 'x' | 'y'): number[] {
  const size = canvasSize(canvas, axis);
  return [size / 3, (size * 2) / 3];
}

type Snap = { correction: number; position: number; kind: GuideKind };

function snapLines(targets: Rect[], axis: 'x' | 'y', options: SnapOptions) {
  return [
    ...targets.flatMap((target) =>
      anchors(target, axis).map((position) => ({ position, kind: 'object' as const })),
    ),
    ...(options.thirds && options.canvas
      ? thirdLines(options.canvas, axis).map((position) => ({ position, kind: 'third' as const }))
      : []),
  ];
}

function nearestSnap(
  values: number[],
  targets: Rect[],
  axis: 'x' | 'y',
  threshold: number,
  options: SnapOptions,
): Snap | null {
  let best: Snap | null = null;
  for (const line of snapLines(targets, axis, options)) {
    for (const value of values) {
      const correction = line.position - value;
      const distance = Math.abs(correction);
      if (distance > threshold) continue;
      if (
        !best ||
        distance < Math.abs(best.correction) ||
        (distance === Math.abs(best.correction) && correction < best.correction) ||
        (correction === best.correction && line.position < best.position)
      ) {
        best = { correction, position: line.position, kind: line.kind };
      }
    }
  }
  if (best || !options.grid || options.grid <= 0) return best;
  // The grid is the fallback anchor: objects and thirds in reach win, otherwise the leading edge
  // is quantised unconditionally.
  const position = Math.round(values[0] / options.grid) * options.grid;
  return { correction: position - values[0], position, kind: 'grid' };
}

function snapGuide(
  axis: 'x' | 'y',
  snap: Snap,
  snapped: Rect,
  targets: Rect[],
  options: SnapOptions,
): Guide | null {
  if (snap.kind !== 'object' && options.canvas) {
    return {
      axis,
      position: snap.position,
      start: 0,
      end: canvasSize(options.canvas, axis === 'x' ? 'y' : 'x'),
      kind: snap.kind,
    };
  }
  const aligned =
    snap.kind === 'object'
      ? targets.filter((target) =>
          anchors(target, axis).some((anchor) => Math.abs(anchor - snap.position) < 0.000001),
        )
      : [];
  const bounds = unionRects([snapped, ...aligned]);
  if (!bounds) return null;
  return {
    axis,
    position: snap.position,
    start: axis === 'x' ? bounds.y : bounds.x,
    end: axis === 'x' ? bounds.y + bounds.height : bounds.x + bounds.width,
    kind: snap.kind,
  };
}

export function snapMove(
  rect: Rect,
  delta: Point,
  targets: Rect[],
  threshold: number,
  options: SnapOptions = {},
): { delta: Point; guides: Guide[] } {
  const moved = { ...rect, x: rect.x + delta.x, y: rect.y + delta.y };
  const xSnap = nearestSnap(anchors(moved, 'x'), targets, 'x', threshold, options);
  const ySnap = nearestSnap(anchors(moved, 'y'), targets, 'y', threshold, options);
  const snappedDelta = {
    x: delta.x + (xSnap?.correction ?? 0),
    y: delta.y + (ySnap?.correction ?? 0),
  };
  const snapped = { ...rect, x: rect.x + snappedDelta.x, y: rect.y + snappedDelta.y };
  const guides: Guide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const snap = axis === 'x' ? xSnap : ySnap;
    if (!snap) continue;
    const guide = snapGuide(axis, snap, snapped, targets, options);
    if (guide) guides.push(guide);
  }
  return { delta: snappedDelta, guides };
}

export function snapResize(
  frame: Rect,
  handle: ResizeHandle,
  targets: Rect[],
  threshold: number,
  options: SnapOptions = {},
): { frame: Rect; guides: Guide[] } {
  const next = { ...frame };
  const snaps: Array<{ axis: 'x' | 'y'; snap: Snap }> = [];
  const edges = [
    { axis: 'x' as const, start: handle.includes('w'), end: handle.includes('e') },
    { axis: 'y' as const, start: handle.includes('n'), end: handle.includes('s') },
  ];
  for (const { axis, start, end } of edges) {
    if (!start && !end) continue;
    const size = axis === 'x' ? 'width' : 'height';
    const edge = start ? frame[axis] : frame[axis] + frame[size];
    const snap = nearestSnap([edge], targets, axis, threshold, options);
    if (!snap) continue;
    const nextSize = frame[size] + (start ? -snap.correction : snap.correction);
    if (nextSize < 8) continue;
    next[size] = nextSize;
    if (start) next[axis] = frame[axis] + snap.correction;
    snaps.push({ axis, snap });
  }
  const guides = snaps.flatMap(({ axis, snap }) => {
    const guide = snapGuide(axis, snap, next, targets, options);
    return guide ? [guide] : [];
  });
  return { frame: next, guides };
}

export function alignRects(rects: Rect[], alignment: Alignment, bounds?: Rect): Point[] {
  const target = bounds ?? unionRects(rects);
  if (!target) return [];
  return rects.map((rect) => {
    switch (alignment) {
      case 'left':
        return { x: target.x - rect.x, y: 0 };
      case 'center':
        return { x: target.x + target.width / 2 - rect.x - rect.width / 2, y: 0 };
      case 'right':
        return { x: target.x + target.width - rect.x - rect.width, y: 0 };
      case 'top':
        return { x: 0, y: target.y - rect.y };
      case 'middle':
        return { x: 0, y: target.y + target.height / 2 - rect.y - rect.height / 2 };
      default:
        return { x: 0, y: target.y + target.height - rect.y - rect.height };
    }
  });
}

export function distributeRects(rects: Rect[], axis: 'x' | 'y'): Point[] {
  const deltas = rects.map(() => ({ x: 0, y: 0 }));
  if (rects.length < 3) return deltas;
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = rects
    .map((rect, index) => ({ rect, index }))
    .sort((a, b) => a.rect[axis] - b.rect[axis] || a.index - b.index);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSize = rects.reduce((sum, rect) => sum + rect[size], 0);
  const gap =
    (last.rect[axis] + last.rect[size] - first.rect[axis] - totalSize) / (rects.length - 1);
  let position = first.rect[axis];
  for (const { rect, index } of sorted) {
    deltas[index][axis] = position - rect[axis];
    position += rect[size] + gap;
  }
  return deltas;
}

export function solveResizeDimensions(
  size: Pick<Rect, 'width' | 'height'>,
  basis: { a: number; b: number; c: number; d: number },
  delta: Point,
): Pick<Rect, 'width' | 'height'> {
  const { a, b, c, d } = basis;
  const determinant = a * d - b * c;
  const magnitude = Math.hypot(a, b) * Math.hypot(c, d);
  // Nearly parallel dimension vectors amplify small pointer deltas into large distortions.
  if (Math.abs(determinant) > magnitude * 0.1) {
    const width = size.width + (d * delta.x - c * delta.y) / determinant;
    const height = size.height + (a * delta.y - b * delta.x) / determinant;
    if (Number.isFinite(width) && Number.isFinite(height) && width >= 8 && height >= 8)
      return { width, height };
  }
  const direction = {
    x: a * size.width + c * size.height,
    y: b * size.width + d * size.height,
  };
  const lengthSquared = direction.x ** 2 + direction.y ** 2;
  const requestedScale =
    lengthSquared > 0 ? 1 + (direction.x * delta.x + direction.y * delta.y) / lengthSquared : 1;
  const scale = Math.max(8 / size.width, 8 / size.height, requestedScale);
  return { width: size.width * scale, height: size.height * scale };
}

export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  delta: Point,
  lockAspect = false,
): Rect {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const horizontal = west || east;
  const vertical = north || south;
  const requestedWidth = rect.width + (west ? -delta.x : east ? delta.x : 0);
  const requestedHeight = rect.height + (north ? -delta.y : south ? delta.y : 0);
  let width = Math.max(8, requestedWidth);
  let height = Math.max(8, requestedHeight);
  if (lockAspect && rect.width > 0 && rect.height > 0) {
    const widthScale = requestedWidth / rect.width;
    const heightScale = requestedHeight / rect.height;
    const scale = Math.max(
      8 / rect.width,
      8 / rect.height,
      horizontal && (!vertical || Math.abs(widthScale - 1) >= Math.abs(heightScale - 1))
        ? widthScale
        : heightScale,
    );
    width = rect.width * scale;
    height = rect.height * scale;
  }
  return {
    x: west ? rect.x + rect.width - width : horizontal ? rect.x : rect.x + (rect.width - width) / 2,
    y: north
      ? rect.y + rect.height - height
      : vertical
        ? rect.y
        : rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}
