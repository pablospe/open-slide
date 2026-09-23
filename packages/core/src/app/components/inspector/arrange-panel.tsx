import {
  ChevronDown,
  CornerLeftUp,
  Grid3x3,
  Grip,
  type LucideIcon,
  Magnet,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Field, Section } from '@/components/panel/panel-fields';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  EDITOR_ACTIONS,
  type EditorActionId,
  type EditorActionState,
  editorAction,
} from '@/lib/inspector/editor-actions';
import {
  readSelectionFacts,
  type SelectionFacts,
  useEditorActions,
} from '@/lib/inspector/use-editor-actions';
import { readCanvas, readFrame, readRotation } from '@/lib/inspector/visual-dom';
import { format, useLocale } from '@/lib/use-locale';
import { round2 } from '@/lib/utils';
import { useInspector } from './inspector-provider';

type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  facts: SelectionFacts;
};

export function ArrangePanel() {
  const { selection, opsVersion, visual, committing } = useInspector();
  const { inspector: t } = useLocale();
  const [frame, setFrame] = useState<Frame | null>(null);
  const [toSlide, setToSlide] = useState(false);
  const multiple = selection.length > 1;
  const alignToSlide = !multiple || toSlide;
  const actions = useEditorActions({ alignToSlide });

  useEffect(() => {
    void opsVersion;
    const update = () => {
      const canvas = readCanvas();
      const anchors = selection
        .map((target) => target.anchor)
        .filter((anchor) => anchor.isConnected);
      if (!canvas || anchors.length === 0) {
        setFrame(null);
        return;
      }
      const frames = anchors.map((anchor) => readFrame(anchor, canvas));
      const x = Math.min(...frames.map((frame) => frame.x));
      const y = Math.min(...frames.map((frame) => frame.y));
      setFrame({
        x,
        y,
        width: Math.max(...frames.map((frame) => frame.x + frame.width)) - x,
        height: Math.max(...frames.map((frame) => frame.y + frame.height)) - y,
        rotation: anchors.length === 1 ? readRotation(anchors[0]) : 0,
        facts: readSelectionFacts(selection),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    for (const target of selection) observer.observe(target.anchor);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [selection, opsVersion]);

  if (!frame) return null;
  const blocked = !frame.facts.transformable || committing;
  const state = actions.stateFrom(frame.facts);
  const resettable = frame.facts.resettable;
  const actionButton = (id: EditorActionId) => (
    <ActionButton key={id} id={id} state={state} onRun={() => actions.run(id)} />
  );

  return (
    <Section title={t.arrangeSection}>
      <TooltipProvider delay={350}>
        {multiple && (
          <p className="text-[11px] text-muted-foreground">
            {format(t.selectionCount, { count: selection.length })}
          </p>
        )}
        {!frame.facts.transformable && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {frame.facts.shared ? t.sharedLayoutHint : t.inlineLayoutHint}
          </p>
        )}
        <Field label={t.positionLabel}>
          <FrameInput
            label="X"
            ariaLabel={t.positionX}
            value={frame.x}
            disabled={blocked}
            onChange={(x) => visual.setFrame({ x })}
          />
          <FrameInput
            label="Y"
            ariaLabel={t.positionY}
            value={frame.y}
            disabled={blocked}
            onChange={(y) => visual.setFrame({ y })}
          />
        </Field>
        <Field label={t.dimensionsLabel}>
          <FrameInput
            label="W"
            ariaLabel={t.widthLabel}
            value={frame.width}
            min={8}
            disabled={multiple || blocked}
            onChange={(width) => visual.setFrame({ width })}
          />
          <FrameInput
            label="H"
            ariaLabel={t.heightLabel}
            value={frame.height}
            min={8}
            disabled={multiple || blocked}
            onChange={(height) => visual.setFrame({ height })}
          />
        </Field>
        <Field label={t.rotationLabel}>
          <FrameInput
            label="°"
            ariaLabel={t.rotationLabel}
            value={frame.rotation}
            disabled={multiple || blocked}
            onChange={(rotation) => visual.setFrame({ rotation })}
          />
        </Field>
        <Field label={t.alignToLabel}>
          <ToggleGroup
            variant="outline"
            size="sm"
            disabled={committing}
            value={[alignToSlide ? 'slide' : 'selection']}
            onValueChange={(value) => {
              if (value.length > 0) setToSlide(value[0] === 'slide');
            }}
            aria-label={t.alignToLabel}
          >
            <ToggleGroupItem value="selection" disabled={!multiple}>
              {t.alignToSelection}
            </ToggleGroupItem>
            <ToggleGroupItem value="slide">{t.alignToSlide}</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <fieldset className="grid grid-cols-6 gap-1">
          <legend className="sr-only">{t.alignLabel}</legend>
          {(
            [
              'alignLeft',
              'alignCenter',
              'alignRight',
              'alignTop',
              'alignMiddle',
              'alignBottom',
            ] as const
          ).map(actionButton)}
        </fieldset>
        <Field label={t.distributeLabel}>
          {actionButton('distributeHorizontal')}
          {actionButton('distributeVertical')}
        </Field>
        <Field label={t.layerLabel}>
          {actionButton('bringToFront')}
          {actionButton('bringForward')}
          {actionButton('sendBackward')}
          {actionButton('sendToBack')}
        </Field>
        <Field label={t.layoutLabel}>
          <Tooltip>
            <TooltipTrigger render={<span className="flex min-w-0 flex-1" />}>
              <Button
                variant="outline"
                size="sm"
                className="min-w-0 flex-1 rounded-r-none"
                aria-label={t.resetPositionAria}
                disabled={!editorAction('resetAll').enabled(state).enabled}
                onClick={(event) => actions.run(event.altKey ? 'resetAll' : 'resetPosition')}
              >
                <RotateCcw data-icon="inline-start" />
                {t.resetPosition}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-60">
              {resettable.transform
                ? t.resetHint
                : resettable.all
                  ? t.resetAllOnly
                  : t.resetNothing}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="-ml-1.5 rounded-l-none border-l-0"
                  aria-label={t.resetOptions}
                  disabled={!editorAction('resetAll').enabled(state).enabled}
                />
              }
            >
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent data-inspector-ui align="end" className="min-w-[200px]">
              <DropdownMenuItem
                disabled={!editorAction('resetPosition').enabled(state).enabled}
                onClick={() => actions.run('resetPosition')}
              >
                {t.resetPositionOnly}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.run('resetAll')}>
                {t.resetAll}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
        <Field label={t.snappingLabel}>
          <Toggle
            size="sm"
            variant="outline"
            disabled={committing}
            pressed={visual.snapping}
            onPressedChange={visual.setSnapping}
            aria-label={t.smartGuides}
          >
            <Magnet data-icon="inline-start" />
            {t.smartGuides}
          </Toggle>
          <Toggle
            size="sm"
            variant="outline"
            disabled={committing}
            pressed={visual.thirds}
            onPressedChange={visual.setThirds}
            aria-label={t.snapThirds}
          >
            <Grid3x3 data-icon="inline-start" />
            {t.snapThirds}
          </Toggle>
        </Field>
        <Field label={t.snapGrid}>
          <Toggle
            size="sm"
            variant="outline"
            disabled={committing}
            pressed={visual.grid.enabled}
            onPressedChange={(enabled) => visual.setGrid((grid) => ({ ...grid, enabled }))}
            aria-label={t.snapGrid}
          >
            <Grip data-icon="inline-start" />
            {t.snapGrid}
          </Toggle>
          <FrameInput
            label="px"
            ariaLabel={t.gridSize}
            value={visual.grid.size}
            min={1}
            disabled={committing}
            onChange={(size) => visual.setGrid((grid) => ({ ...grid, size }))}
          />
        </Field>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={!editorAction('selectParent').enabled(state).enabled}
            onClick={() => actions.run('selectParent')}
          >
            <CornerLeftUp data-icon="inline-start" />
            {t.selectParent}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!editorAction('selectAll').enabled(state).enabled}
            onClick={() => actions.run('selectAll')}
          >
            {t.selectAll}
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{t.visualEditorHint}</p>
      </TooltipProvider>
    </Section>
  );
}

const STRUCTURE_BUTTONS = EDITOR_ACTIONS.filter((action) => action.group === 'structure');

export function StructureSection() {
  const { inspector: t } = useLocale();
  const actions = useEditorActions();
  const state = actions.readState();
  const status = editorAction('delete').enabled(state);
  const reason =
    !status.enabled && status.reason !== 'actionCommitting' && status.reason !== 'actionBusy'
      ? t[status.reason]
      : null;

  return (
    <Section title={t.structureSection}>
      <TooltipProvider delay={350}>
        {reason && <p className="text-[11px] leading-relaxed text-muted-foreground">{reason}</p>}
        <fieldset className="grid grid-cols-4 gap-1" data-structure-actions>
          <legend className="sr-only">{t.structureSection}</legend>
          {STRUCTURE_BUTTONS.map((action) => (
            <ActionButton
              key={action.id}
              id={action.id}
              state={state}
              onRun={() => actions.run(action.id)}
            />
          ))}
        </fieldset>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{t.structureHint}</p>
      </TooltipProvider>
    </Section>
  );
}

function ActionButton({
  id,
  state,
  onRun,
}: {
  id: EditorActionId;
  state: EditorActionState;
  onRun: () => void;
}) {
  const { inspector: t } = useLocale();
  const action = editorAction(id);
  return (
    <ArrangeButton
      label={t[action.label]}
      icon={action.icon}
      disabled={!action.enabled(state).enabled}
      onClick={onRun}
    />
  );
}

export function ArrangeButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            className="w-auto min-w-0 flex-1"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <Icon data-icon="inline-start" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function FrameInput({
  label,
  ariaLabel,
  value,
  onChange,
  min,
  disabled = false,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(round2(value)));
  const id = useId();
  const focused = useRef(false);
  const cancelled = useRef(false);
  const edit = useRef({ value, onChange });

  useEffect(() => {
    if (!focused.current) setDraft(String(round2(value)));
  }, [value]);

  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 items-center gap-1">
      <span aria-hidden className="font-mono text-[10px] text-muted-foreground">
        {label}
      </span>
      <Input
        id={id}
        type="number"
        className="h-7 px-1.5"
        aria-label={ariaLabel}
        value={draft}
        min={min}
        step={1}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
          cancelled.current = false;
          edit.current = { value, onChange };
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          focused.current = false;
          const next = Number(draft);
          if (
            !disabled &&
            !cancelled.current &&
            draft.trim() &&
            Number.isFinite(next) &&
            next !== round2(edit.current.value)
          ) {
            const clamped = min === undefined ? next : Math.max(min, next);
            edit.current.onChange(clamped);
          }
          setDraft(String(round2(value)));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.stopPropagation();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
