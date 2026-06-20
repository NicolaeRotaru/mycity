'use client';

import { useId, useState } from 'react';
import { ChevronDown, Leaf } from 'lucide-react';
import { formatAttributeValue } from '@/lib/category-attributes';

/**
 * Accordion "Ingredienti e allergeni" della PDP.
 *
 * DATI REALI: legge esclusivamente da `product.attributes` (JSONB compilato dal
 * venditore in fase di pubblicazione) le chiavi `allergeni`, `ingredienti`,
 * `conservazione`, `valori_nutrizionali`. NIENTE valori inventati: se nessuna di
 * queste chiavi è valorizzata, il componente non renderizza nulla.
 *
 * Accessibile: il trigger è un <button> con aria-expanded + aria-controls;
 * gli allergeni sono comma-separated in una lista di pill.
 */

const KEYS = ['allergeni', 'ingredienti', 'conservazione', 'valori_nutrizionali'] as const;

function asText(value: unknown): string | null {
  if (value == null) return null;
  const s = formatAttributeValue(value).trim();
  return s && s !== '—' ? s : null;
}

export function AllergensAccordion({ attributes }: { attributes: unknown }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const attrs =
    attributes && typeof attributes === 'object' && !Array.isArray(attributes)
      ? (attributes as Record<string, unknown>)
      : {};

  const allergeni = asText(attrs['allergeni']);
  const ingredienti = asText(attrs['ingredienti']);
  const conservazione = asText(attrs['conservazione']);
  const valori = asText(attrs['valori_nutrizionali']);

  // Niente dati reali → niente accordion (graceful: non inventiamo nulla).
  if (!allergeni && !ingredienti && !conservazione && !valori) return null;

  // Allergeni come elenco di pill (split su virgola / punto e virgola).
  const allergenList = allergeni
    ? allergeni.split(/[,;]/).map((a) => a.trim()).filter(Boolean)
    : [];

  return (
    <div className="overflow-hidden rounded-lg border border-cream-300">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-sm font-bold text-ink-900 hover:bg-cream-50"
      >
        <Leaf size={16} className="text-olive-600" aria-hidden />
        Ingredienti e allergeni
        <ChevronDown
          size={16}
          className={`ml-auto text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3 px-4 pb-4 pt-0">
          {allergenList.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-label text-ink-400">Allergeni</p>
              <div className="flex flex-wrap gap-1.5">
                {allergenList.map((a) => (
                  <span
                    key={a}
                    className="rounded-full border border-secondary-200 bg-secondary-50 px-2.5 py-0.5 text-xs font-semibold text-secondary-700"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {ingredienti && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-label text-ink-400">Ingredienti</p>
              <p className="text-[13px] leading-relaxed text-ink-700">{ingredienti}</p>
            </div>
          )}
          {valori && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-label text-ink-400">Valori nutrizionali</p>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-700">{valori}</p>
            </div>
          )}
          {conservazione && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-label text-ink-400">Conservazione</p>
              <p className="text-[13px] leading-relaxed text-ink-700">{conservazione}</p>
            </div>
          )}
          <p className="text-[11px] italic text-ink-400">
            Verifica sempre l&apos;etichetta sul prodotto: gli allergeni sono indicati dal produttore.
          </p>
        </div>
      )}
    </div>
  );
}
