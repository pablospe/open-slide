import { useCallback } from 'react';

export type EditOp =
  | { kind: 'set-style'; key: string; value: string | null; prevText?: string }
  | { kind: 'set-text'; value: string; prevText?: string }
  | {
      kind: 'set-text-range-style';
      start: number;
      end: number;
      key: string;
      value: string | null;
      prevText?: string;
    }
  | { kind: 'set-attr-asset'; attr: string; assetPath: string; previewUrl: string }
  | { kind: 'replace-placeholder-with-image'; assetPath: string }
  | { kind: 'remove-element'; instanceCount?: number }
  | { kind: 'duplicate-element'; instanceCount?: number }
  | { kind: 'move-element'; direction: 'earlier' | 'later'; instanceCount?: number }
  | {
      kind: 'insert-snippet';
      snippetId: string;
      position: 'after-selection' | 'end-of-page';
      pageIndex?: number;
      assetPath?: string;
      instanceCount?: number;
    }
  | { kind: 'wrap-in-step'; instanceCount?: number }
  | { kind: 'unwrap-step'; instanceCount?: number }
  | { kind: 'move-step'; direction: 'earlier' | 'later'; instanceCount?: number }
  | { kind: 'set-step-duration'; value: number | null; instanceCount?: number };

export type Edit = { line: number; column: number; ops: EditOp[]; dependsOn?: number };

export type EditResult = { ok: boolean; error?: string };

export class NoOpEditError extends Error {
  constructor() {
    super(
      'Edit completed but the source file did not change — the target JSX may already match, or the target element may not be directly editable here.',
    );
    this.name = 'NoOpEditError';
  }
}

export type StructureEditResult = {
  changed: boolean;
  location?: { line: number; column: number };
};

export class StructureEditError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'StructureEditError';
  }
}

export function useEditor(slideId: string) {
  const applyEdit = useCallback(
    async (line: number, column: number, ops: EditOp[]) => {
      const res = await fetch('/__edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slideId, line, column, ops }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; changed?: boolean };
      if (!res.ok) {
        throw new Error(body.error ?? `POST /__edit → ${res.status}`);
      }
      if (body.changed === false) {
        throw new NoOpEditError();
      }
    },
    [slideId],
  );

  // Batch many element edits into one file write and one HMR tick.
  // Returns one result per input edit so callers can keep failed
  // edits buffered while clearing the ones that landed.
  const applyEdits = useCallback(
    async (edits: Edit[]): Promise<EditResult[]> => {
      if (edits.length === 0) return [];
      const res = await fetch('/__edit/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slideId, edits }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: EditResult[];
      };
      if (!res.ok) {
        throw new Error(body.error ?? `POST /__edit/batch → ${res.status}`);
      }
      return body.results ?? [];
    },
    [slideId],
  );

  // Structural edits rewrite sibling ranges, so they are never buffered or
  // batched: one op, one request, one file write.
  const applyStructureEdit = useCallback(
    async (line: number, column: number, op: EditOp): Promise<StructureEditResult> => {
      const res = await fetch('/__edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slideId, line, column, ops: [op] }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<StructureEditResult> & {
        error?: string;
        code?: string;
      };
      if (!res.ok)
        throw new StructureEditError(body.error ?? `POST /__edit → ${res.status}`, body.code);
      return { changed: body.changed !== false, location: body.location };
    },
    [slideId],
  );

  return { applyEdit, applyEdits, applyStructureEdit };
}
