import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SelectedTarget } from '@/components/inspector/inspector-provider';
import { useLocale } from '@/lib/use-locale';
import type { SnippetId } from '../../../editing/snippets';
import { findSlideSource } from './fiber';
import { refusalMessage } from './structure-actions';
import { StructureEditError, useEditor } from './use-editor';
import { inspectorRoot, waitForSlideUpdate } from './use-structure-actions';

type Options = {
  committing: boolean;
  pendingCount: number;
  slideId: string;
  pageIndex: number;
  selection: SelectedTarget[];
  setSelection: (targets: SelectedTarget[]) => void;
  onApplied: () => void;
};

export type InsertPlacement = 'after-selection' | 'end-of-page';

// A selection whose anchor carries its own loc sits in the slide file, so the
// new block can go right after it; anything else appends to the page.
export function insertPlacement(selection: SelectedTarget[]): InsertPlacement {
  if (selection.length !== 1) return 'end-of-page';
  const target = selection[0];
  return target.anchor.dataset.slideLoc === `${target.line}:${target.column}`
    ? 'after-selection'
    : 'end-of-page';
}

export function useInsertSnippet({
  committing,
  pendingCount,
  slideId,
  pageIndex,
  selection,
  setSelection,
  onApplied,
}: Options) {
  const { inspector: t } = useLocale();
  const { applyStructureEdit } = useEditor(slideId);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const placement = insertPlacement(selection);
  const blockedReason = pendingCount > 0 ? t.structurePendingEdits : null;

  const insert = useCallback(
    async (snippetId: SnippetId, assetPath?: string) => {
      if (busyRef.current || committing) return;
      if (blockedReason) {
        toast.error(blockedReason);
        return;
      }
      const target = placement === 'after-selection' ? selection[0] : null;
      const instanceCount = target
        ? (inspectorRoot()?.querySelectorAll(`[data-slide-loc="${target.line}:${target.column}"]`)
            .length ?? 1)
        : 1;
      busyRef.current = true;
      setBusy(true);
      const update = waitForSlideUpdate(slideId);
      try {
        const { changed, location } = await applyStructureEdit(
          target?.line ?? 1,
          target?.column ?? 0,
          {
            kind: 'insert-snippet',
            snippetId,
            position: placement,
            pageIndex,
            instanceCount,
            ...(assetPath ? { assetPath } : {}),
          },
        );
        onApplied();
        if (!location) {
          update.cancel();
          return;
        }
        if (changed) await update.ready;
        else update.cancel();
        const anchor = inspectorRoot()?.querySelector<HTMLElement>(
          `[data-slide-loc="${location.line}:${location.column}"]`,
        );
        const hit = anchor ? findSlideSource(anchor, slideId, { hostOnly: true }) : null;
        setSelection(hit ? [hit] : []);
      } catch (err) {
        update.cancel();
        const reason =
          (err instanceof StructureEditError && refusalMessage(t, err.code)) ||
          (err instanceof Error ? err.message : String(err));
        toast.error(`${t.insertFailed} ${reason}`);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [
      applyStructureEdit,
      blockedReason,
      committing,
      onApplied,
      pageIndex,
      placement,
      selection,
      setSelection,
      slideId,
      t,
    ],
  );

  return useMemo(
    () => ({ insert, busy, blockedReason, placement }),
    [insert, busy, blockedReason, placement],
  );
}
