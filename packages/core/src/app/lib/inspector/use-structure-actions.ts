import { type RefObject, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SelectedTarget } from '@/components/inspector/inspector-provider';
import { useLocale } from '@/lib/use-locale';
import { findSlideSource } from './fiber';
import { refusalMessage, STRUCTURE_OPS, type StructureActionId } from './structure-actions';
import { StructureEditError, useEditor } from './use-editor';

type Options = {
  // Shared by every hook that rewrites the slide by source location, so one
  // op never targets a loc another in-flight op is about to shift.
  lock: RefObject<boolean>;
  committing: boolean;
  slideId: string;
  selection: SelectedTarget[];
  setSelection: (targets: SelectedTarget[]) => void;
  onApplied: () => void;
};

export function inspectorRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-inspector-root]');
}

// Resolves once the rewritten slide module has re-rendered the canvas.
// Waiting on the loc alone is not enough: after a move earlier the moved
// element's new loc is the old loc of its sibling, which is already in the
// DOM before the update lands. Only structure and loc mutations count, since
// animated decks mutate inline styles continuously.
export function waitForSlideUpdate(slideId: string): { ready: Promise<void>; cancel: () => void } {
  let cancel = () => {};
  const ready = new Promise<void>((resolve) => {
    const hot = import.meta.hot;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | null = null;
    const finish = () => {
      clearTimeout(giveUp);
      clearTimeout(settleTimer);
      observer?.disconnect();
      hot?.off('open-slide:slide-changed', onSlideChanged);
      hot?.off('vite:afterUpdate', onUpdate);
      resolve();
    };
    const settle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, 120);
    };
    const onUpdate = () => {
      if (observer) return;
      const root = inspectorRoot();
      if (root) {
        observer = new MutationObserver(settle);
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-slide-loc'],
        });
      }
      clearTimeout(giveUp);
      giveUp = setTimeout(finish, 1500);
    };
    const onSlideChanged = (data: { slideIds?: string[] }) => {
      if (!data?.slideIds || data.slideIds.includes(slideId)) onUpdate();
    };
    let giveUp = setTimeout(finish, 4000);
    hot?.on('open-slide:slide-changed', onSlideChanged);
    hot?.on('vite:afterUpdate', onUpdate);
    cancel = finish;
  });
  return { ready, cancel };
}

export function useStructureActions({
  committing,
  slideId,
  selection,
  setSelection,
  onApplied,
  lock,
}: Options) {
  const { inspector: t } = useLocale();
  const { applyStructureEdit } = useEditor(slideId);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (id: StructureActionId) => {
      if (lock.current || committing) return;
      const target = selection[0];
      if (!target) return;
      const loc = `${target.line}:${target.column}`;
      const instanceCount =
        inspectorRoot()?.querySelectorAll(`[data-slide-loc="${loc}"]`).length ?? 1;
      lock.current = true;
      setBusy(true);
      const update = waitForSlideUpdate(slideId);
      try {
        const { changed, location } = await applyStructureEdit(
          target.line,
          target.column,
          STRUCTURE_OPS[id](instanceCount),
        );
        onApplied();
        if (id === 'delete' || !location) {
          update.cancel();
          setSelection([]);
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
        toast.error(`${t.structureFailed} ${reason}`);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [applyStructureEdit, committing, lock, onApplied, selection, setSelection, slideId, t],
  );

  return useMemo(() => ({ run, busy }), [run, busy]);
}
