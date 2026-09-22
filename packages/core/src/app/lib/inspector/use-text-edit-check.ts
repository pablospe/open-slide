import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectedTarget } from '@/components/inspector/inspector-provider';
import { isEditableTextContainer } from './pick-target';

export type TextEditRefusal = { code: string; callSites: number };

// Resolves to the server's refusal, or null when the text can be edited.
type Verdict = Promise<TextEditRefusal | null>;

type Options = {
  active: boolean;
  slideId: string;
  target: SelectedTarget | null;
  readText: (anchor: HTMLElement) => string;
};

function verdictKey(target: SelectedTarget, text: string): string {
  return `${target.line}:${target.column}:${text}`;
}

// Asks the edit route, without writing, whether the rendered text of a target
// can be written back to source. It runs on selection so the answer is usually
// cached before a double-click asks for it.
export function useTextEditCheck({ active, slideId, target, readText }: Options) {
  const cacheRef = useRef(new Map<string, Verdict>());
  const [revision, setRevision] = useState(0);
  const [refusal, setRefusal] = useState<{ key: string; refusal: TextEditRefusal } | null>(null);

  useEffect(() => {
    void slideId;
    cacheRef.current.clear();
  }, [slideId]);

  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const reset = () => {
      cacheRef.current.clear();
      setRevision((n) => n + 1);
    };
    hot.on('open-slide:slide-changed', reset);
    hot.on('vite:afterUpdate', reset);
    return () => {
      hot.off('open-slide:slide-changed', reset);
      hot.off('vite:afterUpdate', reset);
    };
  }, []);

  const check = useCallback(
    (target: SelectedTarget): Verdict => {
      const text = readText(target.anchor);
      const key = verdictKey(target, text);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      const verdict = fetch('/__edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slideId,
          line: target.line,
          column: target.column,
          dryRun: true,
          ops: [{ kind: 'set-text', value: text, prevText: text }],
        }),
      })
        .then((res) =>
          res.ok
            ? (res.json() as Promise<{ ok?: boolean; code?: unknown; callSites?: unknown }>)
            : null,
        )
        .then((body) =>
          body?.ok === false && typeof body.code === 'string'
            ? {
                code: body.code,
                callSites: typeof body.callSites === 'number' ? body.callSites : 1,
              }
            : null,
        )
        .catch(() => null);
      cacheRef.current.set(key, verdict);
      return verdict;
    },
    [slideId, readText],
  );

  const key = target ? verdictKey(target, readText(target.anchor)) : null;

  useEffect(() => {
    void revision;
    if (!active || !target || !isEditableTextContainer(target.anchor)) return;
    let live = true;
    check(target).then((next) => {
      if (!live) return;
      setRefusal(next ? { key: verdictKey(target, readText(target.anchor)), refusal: next } : null);
    });
    return () => {
      live = false;
    };
  }, [active, target, check, readText, revision]);

  return { refusal: refusal && refusal.key === key ? refusal.refusal : null, check };
}
