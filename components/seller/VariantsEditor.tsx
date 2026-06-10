'use client';

import { useState } from 'react';
import { Plus, X, Layers } from 'lucide-react';
import { Checkbox } from '@/components/ui/Field';
import {
  type ProductVariant,
  type VariantOptionType,
  reconcileVariants,
  deriveOptionGroups,
  totalVariantStock,
  suggestedOptionNames,
  MAX_OPTION_TYPES,
} from '@/lib/products/variants';

/**
 * Editor varianti: il venditore definisce 1-3 tipi di opzione (es. Taglia,
 * Colore) con i rispettivi valori; viene generata la matrice delle combinazioni,
 * ognuna con la propria disponibilità. Stesso prezzo per tutte le varianti.
 */

type Props = {
  value: ProductVariant[];
  onChange: (variants: ProductVariant[]) => void;
  /** Slug categoria per i suggerimenti dei nomi opzione. */
  categorySlug?: string | null;
};

export default function VariantsEditor({ value, onChange, categorySlug }: Props) {
  const [enabled, setEnabled] = useState(value.length > 0);
  const [types, setTypes] = useState<VariantOptionType[]>(() =>
    value.length > 0 ? deriveOptionGroups(value) : [],
  );
  const [variants, setVariants] = useState<ProductVariant[]>(value);
  const [valueDrafts, setValueDrafts] = useState<Record<number, string>>({});

  const suggestions = suggestedOptionNames(categorySlug);

  const commitTypes = (next: VariantOptionType[]) => {
    setTypes(next);
    const regenerated = reconcileVariants(next, variants);
    setVariants(regenerated);
    onChange(regenerated);
  };

  const toggle = (on: boolean) => {
    setEnabled(on);
    if (!on) {
      onChange([]);
      return;
    }
    // Accendendo senza tipi: semina il primo tipo suggerito.
    if (types.length === 0) {
      commitTypes([{ name: suggestions[0] ?? 'Variante', values: [] }]);
    } else {
      onChange(variants);
    }
  };

  const addType = (name: string) => {
    if (types.length >= MAX_OPTION_TYPES) return;
    if (types.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    commitTypes([...types, { name, values: [] }]);
  };

  const removeType = (i: number) => commitTypes(types.filter((_, idx) => idx !== i));

  const renameType = (i: number, name: string) =>
    commitTypes(types.map((t, idx) => (idx === i ? { ...t, name } : t)));

  const addValue = (i: number, raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const t = types[i];
    if (t.values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setValueDrafts((d) => ({ ...d, [i]: '' }));
      return;
    }
    commitTypes(types.map((x, idx) => (idx === i ? { ...x, values: [...x.values, v] } : x)));
    setValueDrafts((d) => ({ ...d, [i]: '' }));
  };

  const removeValue = (i: number, val: string) =>
    commitTypes(
      types.map((x, idx) => (idx === i ? { ...x, values: x.values.filter((v) => v !== val) } : x)),
    );

  const setStock = (variantIdx: number, stock: number) => {
    const next = variants.map((v, idx) =>
      idx === variantIdx ? { ...v, stock: Number.isFinite(stock) ? Math.max(0, Math.trunc(stock)) : 0 } : v,
    );
    setVariants(next);
    onChange(next);
  };

  return (
    <div className="border-t pt-4 space-y-3">
      <Checkbox
        label={
          <span className="inline-flex items-center gap-1.5 font-medium text-ink-700">
            <Layers size={15} strokeWidth={2.2} aria-hidden /> Più varianti (taglie, colori…)
          </span>
        }
        checked={enabled}
        onChange={(e) => toggle(e.target.checked)}
      />
      {enabled && (
        <p className="text-xs text-ink-400 -mt-1">
          Definisci le opzioni (es. Taglia, Colore): per ogni combinazione imposti la disponibilità.
          La disponibilità totale del prodotto è la somma delle varianti.
        </p>
      )}

      {enabled && (
        <div className="space-y-4">
          {/* Tipi di opzione */}
          <div className="space-y-3">
            {types.map((t, i) => (
              <div key={i} className="rounded-lg border border-cream-300 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={t.name}
                    onChange={(e) => renameType(i, e.target.value)}
                    placeholder="Nome opzione (es. Taglia)"
                    className="flex-1 rounded-lg border border-cream-300 px-2.5 py-1.5 text-sm font-semibold focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
                  />
                  <button
                    type="button"
                    onClick={() => removeType(i)}
                    aria-label="Rimuovi opzione"
                    className="text-ink-400 hover:text-rose-600"
                  >
                    <X size={18} aria-hidden />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {t.values.map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-700"
                    >
                      {v}
                      <button
                        type="button"
                        onClick={() => removeValue(i, v)}
                        aria-label={`Rimuovi ${v}`}
                        className="text-primary-500 hover:text-primary-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={valueDrafts[i] ?? ''}
                    onChange={(e) => setValueDrafts((d) => ({ ...d, [i]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addValue(i, valueDrafts[i] ?? '');
                      }
                    }}
                    onBlur={() => addValue(i, valueDrafts[i] ?? '')}
                    placeholder={t.values.length === 0 ? 'Aggiungi valore (es. S, M, L)…' : 'Aggiungi…'}
                    className="min-w-[8rem] flex-1 border-0 p-1 text-sm focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
            ))}

            {types.length < MAX_OPTION_TYPES && (
              <div className="flex flex-wrap items-center gap-2">
                {suggestions
                  .filter((s) => !types.some((t) => t.name.toLowerCase() === s.toLowerCase()))
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addType(s)}
                      className="inline-flex items-center gap-1 rounded-lg border border-cream-300 bg-white px-2.5 py-1 text-xs font-semibold text-ink-700 hover:border-primary-300 hover:bg-primary-50"
                    >
                      <Plus size={13} strokeWidth={2.4} aria-hidden /> {s}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => addType('Variante')}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-cream-300 px-2.5 py-1 text-xs font-semibold text-ink-500 hover:border-primary-300 hover:text-primary-700"
                >
                  <Plus size={13} strokeWidth={2.4} aria-hidden /> Altra opzione
                </button>
              </div>
            )}
          </div>

          {/* Matrice varianti con stock */}
          {variants.length > 0 && (
            <div className="rounded-lg border border-cream-300 overflow-hidden">
              <div className="flex items-center justify-between bg-cream-50 px-3 py-2 text-xs font-semibold text-ink-600">
                <span>Variante</span>
                <span>Disponibilità</span>
              </div>
              <div className="divide-y divide-cream-200">
                {variants.map((v, idx) => (
                  <div key={v.label || idx} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm font-medium text-ink-800">{v.label || '—'}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={v.stock}
                      onChange={(e) => setStock(idx, Number(e.target.value))}
                      className="w-24 rounded-lg border border-cream-300 px-2 py-1 text-sm text-right focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between bg-cream-50 px-3 py-2 text-sm font-semibold text-ink-700">
                <span>Totale</span>
                <span>{totalVariantStock(variants)} pezzi</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
