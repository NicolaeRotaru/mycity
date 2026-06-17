import { Award, Leaf, Rabbit, WheatOff, MilkOff, Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { QualityMark } from '@/lib/products/qualityMarks';

/**
 * Marchi di qualità — pillole per DOP/DOC/IGP/Bio/Vegano/Senza glutine…
 *
 * Stesso linguaggio visivo di Badge (sfondo tinto + testo scuro + ring, icone
 * Lucide stroke 2.4). I marchi si ottengono con deriveQualityMarks()
 * (lib/products/qualityMarks): questo componente è solo presentazione.
 */

type Size = 'sm' | 'md';

const TONE_CLASS: Record<QualityMark['tone'], string> = {
  origin:  'bg-olive-100 text-olive-800 ring-1 ring-olive-300',
  natural: 'bg-olive-50 text-olive-700 ring-1 ring-olive-200',
  diet:    'bg-cream-100 text-ink-700 ring-1 ring-cream-300',
};

const SIZES: Record<Size, string> = {
  sm: 'text-[11px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1',
};

/** Icona dedicata per marchio, con fallback per tono. */
function iconFor(mark: QualityMark): LucideIcon {
  switch (mark.key) {
    case 'cruelty_free':  return Rabbit;
    case 'senza_glutine': return WheatOff;
    case 'senza_lattosio':return MilkOff;
    default:
      if (mark.tone === 'origin') return Award;
      if (mark.tone === 'diet')   return Check;
      return Leaf;
  }
}

export function QualityMarks({
  marks,
  size = 'md',
  max,
  className,
}: {
  marks: QualityMark[];
  size?: Size;
  /** Mostra al massimo N marchi, gli altri in un chip "+N". */
  max?: number;
  className?: string;
}) {
  if (!marks || marks.length === 0) return null;
  const shown = typeof max === 'number' ? marks.slice(0, max) : marks;
  const hidden = marks.length - shown.length;
  const iconSize = size === 'sm' ? 11 : 13;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {shown.map((m) => {
        const Icon = iconFor(m);
        return (
          <span
            key={m.key}
            title={m.title ?? m.label}
            className={cn(
              'inline-flex items-center rounded-full font-semibold',
              m.tone === 'origin' && 'uppercase tracking-wide',
              TONE_CLASS[m.tone],
              SIZES[size],
            )}
          >
            <Icon size={iconSize} strokeWidth={2.4} aria-hidden />
            {m.label}
          </span>
        );
      })}
      {hidden > 0 && (
        <span
          className={cn(
            'inline-flex items-center rounded-full font-semibold bg-cream-100 text-ink-500 ring-1 ring-cream-300',
            SIZES[size],
          )}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}
