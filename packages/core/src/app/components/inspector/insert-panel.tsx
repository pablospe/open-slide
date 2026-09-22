import {
  type CSSProperties,
  createElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Section } from '@/components/panel/panel-fields';
import { type DesignSystem, defaultDesign, designToCssVars } from '@/lib/design';
import { format, useLocale } from '@/lib/use-locale';
import {
  SNIPPETS,
  type Snippet,
  type SnippetId,
  type SnippetNode,
} from '../../../editing/snippets';
import type { Locale } from '../../../locale/types';
import { AssetPickerDialog } from './asset-picker-dialog';
import { useInspector } from './inspector-provider';

const PREVIEW_W = 960;
const PREVIEW_H = 540;

const PREVIEW_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#9ca3af"/><path d="M0 9l5-5 4 4 2-2 5 3z" fill="#6b7280"/><circle cx="12" cy="3" r="1.2" fill="#e5e7eb"/></svg>',
)}`;

const LABEL_KEYS: Record<SnippetId, keyof Locale['inspector']['insertSnippets']> = {
  heading: 'heading',
  paragraph: 'paragraph',
  'bullet-list': 'bulletList',
  box: 'box',
  image: 'image',
  'two-column': 'twoColumn',
};

function renderPreviewNode(node: SnippetNode, key?: number): ReactNode {
  const props: Record<string, unknown> = { key, style: node.style as CSSProperties };
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    props[name] = typeof value === 'string' ? value : PREVIEW_IMAGE;
  }
  const children = (node.children ?? []).map((child, i) =>
    typeof child === 'string' ? child : renderPreviewNode(child, i),
  );
  return createElement(node.tag, props, ...children);
}

function SnippetPreview({ snippet, scale }: { snippet: Snippet; scale: number }) {
  return (
    <div
      aria-hidden
      inert
      className="pointer-events-none absolute left-0 top-0 flex origin-top-left flex-col justify-center overflow-hidden p-16 text-left"
      style={{
        width: PREVIEW_W,
        height: PREVIEW_H,
        transform: `scale(${scale})`,
        background: 'var(--osd-bg)',
        color: 'var(--osd-text)',
        fontFamily: 'var(--osd-font-body)',
      }}
    >
      {renderPreviewNode(snippet.root)}
    </div>
  );
}

function useTileScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.15);
  useEffect(() => {
    const tile = ref.current?.querySelector('[data-insert-snippet]');
    if (!tile) return;
    const observer = new ResizeObserver(() => {
      const width = tile.getBoundingClientRect().width;
      if (width > 0) setScale(width / PREVIEW_W);
    });
    observer.observe(tile);
    return () => observer.disconnect();
  }, []);
  return { ref, scale };
}

export function InsertSection({ design }: { design?: DesignSystem }) {
  const { insert, structure, committing, slideId } = useInspector();
  const { inspector: t } = useLocale();
  const [pickingImage, setPickingImage] = useState(false);
  const { ref, scale } = useTileScale();
  const disabled = committing || insert.busy || structure.busy || !!insert.blockedReason;
  const vars = designToCssVars(design ?? defaultDesign) as CSSProperties;

  return (
    <Section title={t.insertSection}>
      <p className="text-[11px] leading-relaxed text-muted-foreground" data-insert-placement>
        {insert.blockedReason ??
          (insert.placement === 'after-selection' ? t.insertAfterSelection : t.insertAtPageEnd)}
      </p>
      <div ref={ref} className="grid grid-cols-2 gap-2" style={vars}>
        {SNIPPETS.map((snippet) => {
          const label = t.insertSnippets[LABEL_KEYS[snippet.id]];
          return (
            <div key={snippet.id} className="group relative flex flex-col gap-1">
              <span
                data-insert-snippet={snippet.id}
                className="relative block aspect-video w-full overflow-hidden rounded-md border border-border transition-colors group-hover:border-foreground/30 group-has-focus-visible:ring-2 group-has-focus-visible:ring-ring/40 group-has-disabled:opacity-50"
              >
                <SnippetPreview snippet={snippet} scale={scale} />
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={format(t.insertSnippet, { name: label })}
                title={format(t.insertSnippet, { name: label })}
                onClick={() =>
                  snippet.needsAsset ? setPickingImage(true) : void insert.insert(snippet.id)
                }
                className="px-0.5 text-left text-[11px] font-medium text-muted-foreground outline-none after:absolute after:inset-0 after:content-[''] hover:text-foreground group-hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {label}
              </button>
            </div>
          );
        })}
      </div>
      {pickingImage && (
        <AssetPickerDialog
          slideId={slideId}
          onClose={() => setPickingImage(false)}
          onPick={(asset, scope) => {
            setPickingImage(false);
            const assetPath =
              scope === 'global' ? `@assets/${asset.name}` : `./assets/${asset.name}`;
            void insert.insert('image', assetPath);
          }}
        />
      )}
    </Section>
  );
}
