import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SelectedTarget } from '@/components/inspector/inspector-provider';
import { isTypingTarget } from '@/lib/keys';
import { useLocale } from '@/lib/use-locale';
import {
  isWrapShortcut,
  type StepActionId,
  type StepInfo,
  stepOp,
  stepRefusalMessage,
} from './step-actions';
import { stepPreview } from './step-preview';
import { refusalMessage } from './structure-actions';
import { StructureEditError, useEditor } from './use-editor';
import {
  instanceCountOf,
  selectAtLocation,
  sourceEditBlockedReason,
  waitForSlideUpdate,
} from './use-structure-actions';

type Options = {
  active: boolean;
  inlineEditing: boolean;
  committing: boolean;
  pendingCount: number;
  slideId: string;
  selection: SelectedTarget[];
  setSelection: (targets: SelectedTarget[]) => void;
  onApplied: () => void;
};

export function useStepActions({
  active,
  inlineEditing,
  committing,
  pendingCount,
  slideId,
  selection,
  setSelection,
  onApplied,
}: Options) {
  const { inspector: t } = useLocale();
  const { applyStructureEdit } = useEditor(slideId);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [info, setInfo] = useState<StepInfo | null>(null);
  const [revision, setRevision] = useState(0);

  const blockedReason = useMemo(
    () => sourceEditBlockedReason(t, selection, pendingCount),
    [selection, pendingCount, t],
  );
  const target = selection.length === 1 ? selection[0] : null;
  const external = !!target && target.anchor.dataset.slideLoc !== `${target.line}:${target.column}`;

  useEffect(() => {
    if (!active) stepPreview.setRevealed(null);
  }, [active]);
  useEffect(() => () => stepPreview.setRevealed(null), []);

  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const bump = () => setRevision((n) => n + 1);
    hot.on('open-slide:slide-changed', bump);
    hot.on('vite:afterUpdate', bump);
    return () => {
      hot.off('open-slide:slide-changed', bump);
      hot.off('vite:afterUpdate', bump);
    };
  }, []);

  useEffect(() => {
    void revision;
    if (!active || !target || external) {
      setInfo(null);
      return;
    }
    const controller = new AbortController();
    fetch('/__edit/step-info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slideId,
        line: target.line,
        column: target.column,
        instanceCount: instanceCountOf(target),
      }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<StepInfo>) : null))
      .then((next) => setInfo(next))
      .catch(() => {
        if (!controller.signal.aborted) setInfo(null);
      });
    return () => controller.abort();
  }, [active, target, external, slideId, revision]);

  const run = useCallback(
    async (id: StepActionId, duration?: number | null) => {
      if (busyRef.current || committing || !target) return;
      if (blockedReason) {
        toast.error(blockedReason);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const update = waitForSlideUpdate(slideId);
      try {
        const { changed, location } = await applyStructureEdit(
          target.line,
          target.column,
          stepOp(id, instanceCountOf(target), duration),
        );
        onApplied();
        if (!changed || !location) {
          update.cancel();
          return;
        }
        await update.ready;
        const hit = selectAtLocation(location, slideId);
        setSelection(hit ? [hit] : []);
      } catch (err) {
        update.cancel();
        const code = err instanceof StructureEditError ? err.code : undefined;
        const reason =
          stepRefusalMessage(t, code) ||
          refusalMessage(t, code) ||
          (err instanceof Error ? err.message : String(err));
        toast.error(`${t.stepFailed} ${reason}`);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyStructureEdit, blockedReason, committing, onApplied, target, setSelection, slideId, t],
  );

  useEffect(() => {
    if (!active || inlineEditing || committing || !target) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !isWrapShortcut(event) ||
        isTypingTarget(event.target) ||
        document.querySelector('[data-visual-gesture]')
      )
        return;
      const el = event.target;
      if (el instanceof Element && el.closest('[role="dialog"], [role="menu"], [role="listbox"]'))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void run('wrap');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, inlineEditing, committing, target, run]);

  return useMemo(() => ({ info, run, busy, blockedReason }), [info, run, busy, blockedReason]);
}
