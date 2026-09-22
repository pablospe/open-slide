import { ArrowDown, ArrowUp, Eye, ListMinus, ListPlus, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Field, Section } from '@/components/panel/panel-fields';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Toggle } from '@/components/ui/toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  parseDurationInput,
  type StepActionId,
  stepRefusalMessage,
} from '@/lib/inspector/step-actions';
import { stepPreview, useStepPreview } from '@/lib/inspector/step-preview';
import { refusalMessage } from '@/lib/inspector/structure-actions';
import { format, useLocale } from '@/lib/use-locale';
import { ArrangeButton } from './arrange-panel';
import { useInspector } from './inspector-provider';

const BUTTONS: {
  id: Exclude<StepActionId, 'duration'>;
  label: 'wrapInStep' | 'unwrapStep' | 'moveStepEarlier' | 'moveStepLater';
  icon: LucideIcon;
}[] = [
  { id: 'wrap', label: 'wrapInStep', icon: ListPlus },
  { id: 'unwrap', label: 'unwrapStep', icon: ListMinus },
  { id: 'earlier', label: 'moveStepEarlier', icon: ArrowUp },
  { id: 'later', label: 'moveStepLater', icon: ArrowDown },
];

export function RevealSection() {
  const { steps, committing } = useInspector();
  const { inspector: t } = useLocale();
  const { info, blockedReason, busy } = steps;
  const disabled = committing || busy || !!blockedReason || !info;
  const reason = (code: string | null | undefined) =>
    stepRefusalMessage(t, code) ?? refusalMessage(t, code ?? undefined);

  const status = !info
    ? null
    : info.inStep
      ? info.index !== null && info.count !== null
        ? format(t.stepStatus, { index: info.index, count: info.count })
        : t.stepLoose
      : t.notAStep;
  const wrapRefusal = info && !info.inStep ? reason(info.actions.wrap) : null;

  return (
    <Section title={t.revealSection}>
      <TooltipProvider delay={350}>
        {blockedReason ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{blockedReason}</p>
        ) : (
          status && (
            <p className="text-[11px] leading-relaxed text-muted-foreground" data-step-status>
              {status}
            </p>
          )
        )}
        <fieldset className="grid grid-cols-4 gap-1" data-step-actions>
          <legend className="sr-only">{t.revealSection}</legend>
          {BUTTONS.map((button) => (
            <ArrangeButton
              key={button.id}
              label={t[button.label]}
              icon={button.icon}
              disabled={disabled || !!info?.actions[button.id]}
              onClick={() => void steps.run(button.id)}
            />
          ))}
        </fieldset>
        {!blockedReason && wrapRefusal && (
          <p className="text-[11px] leading-relaxed text-muted-foreground" data-step-refusal>
            {wrapRefusal}
          </p>
        )}
        {info?.inStep && !info.actions.duration && (
          <DurationField
            value={info.duration}
            disabled={disabled}
            onCommit={(value) => void steps.run('duration', value)}
          />
        )}
        <StepScrubber />
        <p className="text-[10px] leading-relaxed text-muted-foreground">{t.revealHint}</p>
      </TooltipProvider>
    </Section>
  );
}

function DurationField({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const { inspector: t } = useLocale();
  const id = useId();
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);

  const commit = () => {
    const next = parseDurationInput(draft);
    if (next === 'invalid') {
      setDraft(value === null ? '' : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };

  return (
    <Field label={t.stepDuration}>
      <Input
        id={id}
        aria-label={t.stepDuration}
        inputMode="numeric"
        className="h-7 font-mono text-[11px]"
        placeholder={t.stepDurationPlaceholder}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value === null ? '' : String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </Field>
  );
}

function StepScrubber() {
  const { inspector: t } = useLocale();
  const { revealed, aggregate } = useStepPreview();
  const count = aggregate.stepCount;
  const previewing = revealed !== null;

  if (count === 0 && !previewing) {
    return <p className="text-[11px] text-muted-foreground">{t.stepPreviewEmpty}</p>;
  }
  const shown = previewing ? Math.min(revealed, count) : count;
  return (
    <Field label={t.stepPreview}>
      <Toggle
        size="sm"
        variant="outline"
        pressed={previewing}
        onPressedChange={(pressed) => stepPreview.setRevealed(pressed ? count : null)}
        aria-label={t.stepPreview}
        data-step-preview-toggle
      >
        <Eye data-icon="inline-start" />
      </Toggle>
      <Slider
        aria-label={t.stepPreview}
        min={0}
        max={Math.max(count, 1)}
        step={1}
        value={[shown]}
        disabled={!previewing}
        onValueChange={(value) => {
          const next = Array.isArray(value) ? value[0] : value;
          if (typeof next === 'number') stepPreview.setRevealed(next);
        }}
      />
      <span
        className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground"
        data-step-preview-status
      >
        {format(t.stepPreviewStatus, { revealed: shown, count })}
      </span>
    </Field>
  );
}
