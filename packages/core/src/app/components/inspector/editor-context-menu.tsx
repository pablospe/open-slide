import type { BaseUIEvent } from '@base-ui/react/types';
import { AlignHorizontalJustifyCenter, BringToFront } from 'lucide-react';
import {
  Fragment,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type TouchEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { IS_APPLE } from '@/components/command/command-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  actionForKey,
  EDITOR_ACTIONS,
  type EditorAction,
  type EditorActionGroup,
  type EditorActionState,
  type EditorActionStatus,
  formatShortcut,
} from '@/lib/inspector/editor-actions';
import { findSlideSource } from '@/lib/inspector/fiber';
import {
  isInspectableEventTarget,
  pickElement,
  pickInspectorTarget,
} from '@/lib/inspector/pick-target';
import { useEditorActions } from '@/lib/inspector/use-editor-actions';
import { readCanvas, readFrame } from '@/lib/inspector/visual-dom';
import { isTypingTarget } from '@/lib/keys';
import { useLocale } from '@/lib/use-locale';
import { useInspector } from './inspector-provider';

export function EditorShortcuts() {
  const { active, inlineEdit, committing } = useInspector();
  const { inspector: t } = useLocale();
  const { readState, run } = useEditorActions();

  useEffect(() => {
    if (!active || inlineEdit || committing) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        isTypingTarget(event.target) ||
        document.querySelector('[data-visual-gesture]')
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest('[role="dialog"], [role="menu"], [role="listbox"]') ||
        target?.closest('[data-inspector-ui]')
      )
        return;
      const action = actionForKey(event);
      if (!action || (event.repeat && !action.repeat)) return;
      if (action.ignoreTargets && target?.closest(action.ignoreTargets)) return;
      const state = readState();
      const status = action.enabled(state);
      if (!status.enabled) {
        if (status.reason === 'actionNeedsSelection' || action.whenDisabled === 'pass') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (action.whenDisabled === 'toast' && status.reason !== 'actionBusy')
          toast.error(t[status.reason]);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      run(action.id, { shiftKey: event.shiftKey }, state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, inlineEdit, committing, readState, run, t]);

  return null;
}

const MENU_GROUPS: { group: EditorActionGroup; submenu?: 'layer' | 'align' }[] = [
  { group: 'edit' },
  { group: 'structure' },
  { group: 'layer', submenu: 'layer' },
  { group: 'align', submenu: 'align' },
  { group: 'layout' },
  { group: 'selection' },
  { group: 'page' },
];

type Entry = { action: EditorAction; status: EditorActionStatus };

export function EditorContextMenu({
  render,
  children,
  onAddPage,
}: {
  render: ReactElement;
  children: ReactNode;
  onAddPage?: () => void;
}) {
  const { active, slideId, selection, setSelection, inlineEdit, committing } = useInspector();
  const [open, setOpen] = useState(false);
  const { readState, run } = useEditorActions({ onAddPage });

  const triggerRef = useRef<HTMLDivElement>(null);

  // Base UI swallows every contextmenu event inside the trigger at the document level, so right
  // clicks that should get the browser menu (inline text editing, save bar, comment widget) must
  // stop before they bubble there.
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger || !active) return;
    const onNativeContextMenu = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (
        committing ||
        !isInspectableEventTarget(target) ||
        inlineEdit?.anchor.contains(target as Node) ||
        document.querySelector('[data-visual-gesture]')
      )
        event.stopPropagation();
    };
    trigger.addEventListener('contextmenu', onNativeContextMenu, true);
    return () => trigger.removeEventListener('contextmenu', onNativeContextMenu, true);
  }, [active, committing, inlineEdit]);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const canvas = readCanvas();
    const element = pickInspectorTarget(pickElement(event.clientX, event.clientY));
    let hit = element ? findSlideSource(element, slideId, { hostOnly: true }) : null;
    if (hit && canvas && !selection.some((selected) => selected.anchor === hit?.anchor)) {
      const frame = readFrame(hit.anchor, canvas);
      const background =
        Math.abs(frame.x) < 1 &&
        Math.abs(frame.y) < 1 &&
        frame.width >= canvas.width - 1 &&
        frame.height >= canvas.height - 1;
      if (background) hit = null;
    }
    if (!hit) {
      if (selection.length) setSelection([]);
    } else if (!selection.some((selected) => selected.anchor.contains(hit.anchor))) {
      setSelection([hit]);
    }
  };

  return (
    <ContextMenu disabled={!active} onOpenChange={setOpen}>
      <ContextMenuTrigger
        ref={triggerRef}
        render={render}
        onContextMenu={onContextMenu}
        // Base UI's long-press opens the menu without our selection logic; touch browsers that
        // support it still send a contextmenu event, which does go through it.
        onTouchStart={(event: BaseUIEvent<TouchEvent<HTMLElement>>) => event.preventBaseUIHandler()}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent data-inspector-ui data-editor-context-menu className="w-[260px]">
        {open && <EditorMenuItems state={readState()} run={run} />}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function EditorMenuItems({
  state,
  run,
}: {
  state: EditorActionState;
  run: (id: EditorAction['id']) => void;
}) {
  const { inspector: t } = useLocale();
  const sections = MENU_GROUPS.map(({ group, submenu }) => ({
    group,
    submenu,
    entries: EDITOR_ACTIONS.filter((action) => action.group === group && action.menu !== false)
      .map((action) => ({ action, status: action.enabled(state) }))
      .filter(
        ({ status }) => status.enabled || status.reason !== 'actionNeedsSelection',
      ) satisfies Entry[],
  })).filter((section) => section.entries.length > 0);

  const item = ({ action, status }: Entry) => (
    <ContextMenuItem
      key={action.id}
      data-editor-action={action.id}
      disabled={!status.enabled}
      variant={action.destructive ? 'destructive' : 'default'}
      onClick={() => run(action.id)}
      className="items-start"
    >
      <action.icon className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{t[action.label]}</span>
        {!status.enabled && (
          <span className="text-[10.5px] leading-snug whitespace-normal text-muted-foreground">
            {t[status.reason]}
          </span>
        )}
      </span>
      {action.shortcut && (
        <ContextMenuShortcut className="mt-0.5">
          {formatShortcut(action.shortcut, IS_APPLE)}
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );

  return sections.map(({ group, submenu, entries }, index) => {
    const enabled = entries.filter(({ status }) => status.enabled);
    const firstReason = entries.find(({ status }) => !status.enabled)?.status;
    return (
      <Fragment key={group}>
        {index > 0 && <ContextMenuSeparator />}
        {submenu ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger
              data-editor-submenu={submenu}
              disabled={enabled.length === 0}
              className="items-start data-popup-open:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
            >
              {submenu === 'layer' ? (
                <BringToFront className="mt-0.5 size-3.5 opacity-80" />
              ) : (
                <AlignHorizontalJustifyCenter className="mt-0.5 size-3.5 opacity-80" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{submenu === 'layer' ? t.layerLabel : t.alignLabel}</span>
                {enabled.length === 0 && firstReason && !firstReason.enabled && (
                  <span className="text-[10.5px] leading-snug whitespace-normal text-muted-foreground">
                    {t[firstReason.reason]}
                  </span>
                )}
              </span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent data-inspector-ui className="w-[260px]">
              {entries.map(item)}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          entries.map(item)
        )}
      </Fragment>
    );
  });
}
