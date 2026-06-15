'use client';

import { useState } from 'react';
import { Wand2, Loader2, X, Check, TrendingUp, Tag, Camera, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import type { AttributeField } from '@/lib/category-attributes';
import type {
  ProductChatSnapshot,
  ProductEditPatch,
} from '@/components/seller/ProductChatAssistant';

/**
 * Motore "Migliora tutto" — lato venditore.
 *
 * Un bottone che, in una passata, manda la scheda corrente a
 * /api/ai/improve-product e mostra: punteggio qualità before→after, prezzo
 * consigliato col netto venditore, perché di ogni campo e cosa resta da fare
 * (es. foto). "Applica tutto" scrive nello STATO DEL FORM (non nel DB) via
 * onApplyPatch: il venditore rivede e salva (human-in-the-loop), esattamente
 * come l'assistente in chat.
 */

type QualityDimension = { key: string; label: string; score: number; max: number; note: string };

type ImproveResult = {
  summary: string;
  quality: { before: number; after: number; dimensions: QualityDimension[]; missing: string[] };
  pricing: { suggested: number | null; netToSeller: number | null; rationale: string } | null;
  fieldNotes: { field: string; note: string }[];
  patch: ProductEditPatch;
};

type Props = {
  product: ProductChatSnapshot;
  attributeSchema: AttributeField[];
  topCategories: { name: string; slug: string }[];
  imageUrls: string[];
  onApplyPatch: (patch: ProductEditPatch) => string[];
  disabled?: boolean;
};

/** Etichette italiane per i campi del patch (per le note). */
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  description: 'Descrizione',
  price: 'Prezzo',
  compare_at_price: 'Prezzo pieno',
  unit: 'Unità',
  condition: 'Condizione',
  category_slug: 'Categoria',
  subcategory_name: 'Sottocategoria',
  tags: 'Tag',
  attributes: 'Caratteristiche',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ');
}

/** Colore del punteggio: rosso < 50, ambra < 75, verde ≥ 75. */
function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-rose-600';
}
function scoreBar(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function ImproveAllPanel({
  product,
  attributeSchema,
  topCategories,
  imageUrls,
  onApplyPatch,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImproveResult | null>(null);
  const [applied, setApplied] = useState(false);

  const run = async () => {
    setOpen(true);
    setLoading(true);
    setResult(null);
    setApplied(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sessione scaduta');
        setOpen(false);
        return;
      }
      const res = await fetch('/api/ai/improve-product', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ product, attributeSchema, topCategories, imageUrls }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));
      setResult(json as ImproveResult);
    } catch (err) {
      toast.error(friendlyError(err));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!result) return;
    const changed = onApplyPatch(result.patch);
    setApplied(true);
    if (changed.length > 0) toast.success('Modifiche applicate al form — controlla e salva');
    else toast('Niente da cambiare: la scheda è già a posto');
  };

  const hasPatch = !!result && Object.keys(result.patch ?? {}).length > 0;
  const delta = result ? result.quality.after - result.quality.before : 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void run()}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-gradient-to-r from-primary-50 to-secondary-50 px-3 py-2 text-sm font-semibold text-primary-800 transition-colors hover:from-primary-100 hover:to-secondary-100 disabled:opacity-50"
      >
        <Wand2 size={16} strokeWidth={2.2} aria-hidden /> Migliora tutto con l&apos;AI
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-primary-200 bg-white shadow-warm">
      <div className="flex items-center justify-between border-b border-cream-200 px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-800">
          <Wand2 size={15} strokeWidth={2.4} aria-hidden /> Migliora tutto
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Chiudi"
          className="text-ink-400 hover:text-ink-700"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="max-h-[28rem] overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-500">
            <Loader2 size={18} className="animate-spin" strokeWidth={2.4} aria-hidden />
            Sto analizzando il prodotto, guardo le foto e cerco online…
          </div>
        )}

        {result && !loading && (
          <div className="space-y-4">
            {result.summary && <p className="text-sm text-ink-700">{result.summary}</p>}

            {/* Punteggio qualità before → after */}
            <div className="rounded-lg bg-cream-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Qualità scheda
                </span>
                <span className="inline-flex items-center gap-1 text-sm">
                  <span className="text-ink-400">{result.quality.before}</span>
                  <TrendingUp size={14} className="text-emerald-600" aria-hidden />
                  <span className={`font-bold ${scoreColor(result.quality.after)}`}>
                    {result.quality.after}
                  </span>
                  <span className="text-xs text-ink-400">/100</span>
                  {delta > 0 && (
                    <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
                      +{delta}
                    </span>
                  )}
                </span>
              </div>
              <div className="space-y-1.5">
                {result.quality.dimensions.map((d) => (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs capitalize text-ink-500">{d.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cream-200">
                      <div
                        className={`h-full rounded-full ${scoreBar(d.score)}`}
                        style={{ width: `${Math.min(100, (d.score / (d.max || 100)) * 100)}%` }}
                      />
                    </div>
                    {d.note && <span className="hidden text-xs text-ink-400 sm:inline">{d.note}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Prezzo consigliato + netto venditore */}
            {result.pricing && result.pricing.suggested != null && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <Tag size={15} strokeWidth={2.4} aria-hidden /> Prezzo consigliato:{' '}
                  {formatPrice(result.pricing.suggested)}
                </div>
                {result.pricing.netToSeller != null && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Incassi netti stimati dopo la commissione:{' '}
                    <strong>{formatPrice(result.pricing.netToSeller)}</strong>
                  </p>
                )}
                {result.pricing.rationale && (
                  <p className="mt-1 text-xs text-ink-600">{result.pricing.rationale}</p>
                )}
              </div>
            )}

            {/* Cosa miglioro (note per campo) */}
            {result.fieldNotes.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Cosa miglioro
                </p>
                <ul className="space-y-1">
                  {result.fieldNotes.map((n, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-700">
                      <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" strokeWidth={2.6} aria-hidden />
                      <span>
                        <strong className="font-semibold">{fieldLabel(n.field)}:</strong> {n.note}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Cosa puoi fare tu (missing) */}
            {result.quality.missing.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                  <Camera size={13} strokeWidth={2.6} aria-hidden /> Cosa puoi fare tu
                </p>
                <ul className="space-y-1">
                  {result.quality.missing.map((m, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-700">
                      <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {result && !loading && (
        <div className="flex items-center justify-end gap-2 border-t border-cream-200 p-3">
          {applied ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <Check size={16} strokeWidth={2.6} aria-hidden /> Applicato al form — controlla e salva
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-500 hover:text-ink-700"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!hasPatch}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-40"
              >
                <Wand2 size={15} strokeWidth={2.4} aria-hidden />
                {hasPatch ? 'Applica tutto' : 'Già a posto'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
