import config from 'virtual:open-slide/config';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { type SelectedTarget, useInspector } from '@/components/inspector/inspector-provider';
import { useLocale } from '@/lib/use-locale';
import {
  type ActionTrigger,
  type EditorActionContext,
  type EditorActionId,
  type EditorActionState,
  editorAction,
} from './editor-actions';
import { isEditableTextContainer } from './pick-target';
import { formatSourceLocation } from './source-location';
import { canTransform, clearLayoutOps, readCanvas, readInlineLayout } from './visual-dom';

export type SelectionFacts = Pick<
  EditorActionState,
  'transformable' | 'shared' | 'external' | 'text' | 'clearable'
>;

export function readSelectionFacts(selection: SelectedTarget[]): SelectionFacts {
  const canvas = readCanvas();
  const anchors = selection.map((target) => target.anchor).filter((anchor) => anchor.isConnected);
  const primary = selection.at(-1);
  const clearable = (scope: 'transform' | 'all') =>
    anchors.some((anchor) => clearLayoutOps(readInlineLayout(anchor), scope).length > 0);
  return {
    transformable:
      !!canvas && selection.length > 0 && selection.every((target) => canTransform(target, canvas)),
    shared:
      !!canvas &&
      selection.some(
        (target) =>
          canvas.root.querySelectorAll(`[data-slide-loc="${target.line}:${target.column}"]`)
            .length > 1,
      ),
    external: !!primary && primary.anchor.dataset.slideLoc !== `${primary.line}:${primary.column}`,
    text: selection.length === 1 && !!primary && isEditableTextContainer(primary.anchor),
    clearable: { transform: clearable('transform'), all: clearable('all') },
  };
}

type Options = {
  onAddPage?: () => void;
  alignToSlide?: boolean;
};

export function useEditorActions({ onAddPage, alignToSlide = false }: Options = {}) {
  const inspector = useInspector();
  const { inspector: t } = useLocale();
  const {
    selection,
    inlineEdit,
    committing,
    pendingCount,
    structure,
    insert,
    visual,
    startInlineEdit,
    slideId,
  } = inspector;

  const stateFrom = useCallback(
    (facts: SelectionFacts): EditorActionState => ({
      selectionCount: selection.length,
      inlineEditing: !!inlineEdit,
      committing,
      pendingCount,
      structureBusy: structure.busy || insert.busy,
      canAddPage: import.meta.env.DEV && !!onAddPage,
      ...facts,
    }),
    [
      selection.length,
      inlineEdit,
      committing,
      pendingCount,
      structure.busy,
      insert.busy,
      onAddPage,
    ],
  );
  const readState = useCallback(
    () => stateFrom(readSelectionFacts(selection)),
    [stateFrom, selection],
  );

  const context = useMemo(
    (): EditorActionContext => ({
      selection,
      alignToSlide,
      visual,
      runStructure: (id) => void structure.run(id),
      editText: startInlineEdit,
      copySourceLocation: (target) => {
        navigator.clipboard.writeText(formatSourceLocation(slideId, target, config.slidesDir)).then(
          () => toast.success(t.sourceLocationCopied),
          () => toast.error(t.clipboardFailed),
        );
      },
      addPage: onAddPage,
    }),
    [selection, alignToSlide, visual, structure, startInlineEdit, slideId, t, onAddPage],
  );

  const run = useCallback(
    (id: EditorActionId, trigger?: ActionTrigger, state: EditorActionState = readState()) => {
      const status = editorAction(id).enabled(state);
      if (status.enabled) editorAction(id).run(context, trigger);
      return status;
    },
    [context, readState],
  );

  return { stateFrom, readState, run };
}
