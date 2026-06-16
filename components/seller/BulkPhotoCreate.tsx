'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Images, Loader2, Trash2, X, AlertTriangle, PackagePlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { resizeImageToBase64 } from '@/lib/image-resize';
import { uploadProductImages } from '@/lib/products/uploadImages';
import { formatPrice } from '@/lib/format';

/**
 * Creazione MULTI-prodotto da foto.
 *
 * Il venditore carica le foto di più prodotti (di norma 2 a testa, fronte +
 * retro). L'AI le raggruppa per prodotto e propone una scheda per ognuno
 * (/api/vision/extract-products); il venditore rivede nome e prezzo, scarta ciò
 * che non va, poi "Crea bozze" carica le foto e inserisce tutto in un colpo come
 * BOZZE (/api/ai/catalog-create-bulk). Niente scrittura silenziosa: si rivede
 * sempre prima di creare, e le bozze non sono pubbliche finché non le pubblichi.
 */

type DetectedProduct = {
  image_indexes: number[];
  name: string;
  description: string;
  category_id: string | null;
  subcategory_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  suggested_price: number | null;
  attributes: Record<string, string>;
  tags: string[];
  alt_text: string | null;
  policy_ok: boolean;
  policy_reason: string | null;
};

type Phase = 'idle' | 'analyzing' | 'review' | 'creating';

type Props = {
  /** Chiamato dopo aver creato le bozze (es. redirect alla lista prodotti). */
  onCreated?: (count: number) => void;
};

const MAX_PHOTOS = 12;

export default function BulkPhotoCreate({ onCreated }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [products, setProducts] = useState<DetectedProduct[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URL delle anteprime: vanno revocati per non perdere memoria.
  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  const reset = () => {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles([]);
    setPreviews([]);
    setProducts([]);
    setPhase('idle');
  };

  const analyzeFiles = async (picked: File[]) => {
    const list = picked.slice(0, MAX_PHOTOS);
    if (list.length < 2) {
      toast('Carica almeno 2 foto (di solito fronte + retro per ogni prodotto).');
      return;
    }
    // Nuove anteprime: revoca le vecchie prima.
    previews.forEach((u) => URL.revokeObjectURL(u));
    setFiles(list);
    setPreviews(list.map((f) => URL.createObjectURL(f)));
    setPhase('analyzing');
    try {
      const images = await Promise.all(
        list.map(async (f) => {
          const { base64, mediaType } = await resizeImageToBase64(f);
          return { image_base64: base64, media_type: mediaType };
        }),
      );
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/vision/extract-products', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Estrazione fallita'));
      const detected = (data.products ?? []) as DetectedProduct[];
      if (detected.length === 0) {
        toast('Non ho riconosciuto prodotti distinti. Riprova con foto più nitide.');
        reset();
        return;
      }
      setProducts(detected);
      setPhase('review');
    } catch (err) {
      toast.error(friendlyError(err));
      reset();
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    void analyzeFiles(picked).finally(() => {
      if (inputRef.current) inputRef.current.value = '';
    });
  };

  const updateProduct = (idx: number, patch: Partial<DetectedProduct>) =>
    setProducts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const removeProduct = (idx: number) =>
    setProducts((prev) => prev.filter((_, i) => i !== idx));

  const creatable = products.filter((p) => p.policy_ok && p.name.trim());

  const createAll = async () => {
    if (creatable.length === 0) {
      toast('Niente da creare: controlla i prodotti.');
      return;
    }
    setPhase('creating');
    try {
      // Carica TUTTE le foto una volta: urls[i] allineato a files[i].
      const urls = await uploadProductImages(files);
      const items = creatable
        .map((p) => ({
          imageUrls: p.image_indexes.map((i) => urls[i]).filter((u): u is string => !!u),
          draft: {
            name: p.name,
            description: p.description,
            category_id: p.category_id,
            subcategory_id: p.subcategory_id,
            category_slug: p.category_slug ?? undefined,
            suggested_price: p.suggested_price,
            attributes: p.attributes,
            tags: p.tags,
            alt_text: p.alt_text,
          },
        }))
        .filter((it) => it.imageUrls.length > 0);

      if (items.length === 0) {
        toast.error('Foto non disponibili per la creazione. Riprova.');
        setPhase('review');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai/catalog-create-bulk', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Creazione fallita'));
      const count = Number(data.count ?? items.length);
      toast.success(`${count} ${count === 1 ? 'bozza creata' : 'bozze create'}! Le trovi tra i tuoi prodotti.`);
      reset();
      onCreated?.(count);
    } catch (err) {
      toast.error(friendlyError(err));
      setPhase('review');
    }
  };

  // ---- Schermata iniziale ----------------------------------------------------
  if (phase === 'idle' || phase === 'analyzing') {
    const busy = phase === 'analyzing';
    return (
      <div className="rounded-lg border border-secondary-200 bg-secondary-50 p-4 sm:p-5">
        <p className="flex items-center gap-2 font-bold text-secondary-900">
          <PackagePlus size={18} strokeWidth={2.2} aria-hidden /> Hai più prodotti? Creali tutti dalle foto
        </p>
        <p className="mt-1 text-sm text-ink-600">
          Carica le foto di più prodotti — di solito 2 a testa (fronte + retro). L&apos;AI le raggruppa,
          riconosce ogni prodotto e prepara le bozze: tu controlli e confermi.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-secondary-700 px-4 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-secondary-800 disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 size={18} className="animate-spin" strokeWidth={2.4} aria-hidden />
              Analizzo le foto…
            </>
          ) : (
            <>
              <Images size={18} strokeWidth={2.2} aria-hidden /> Carica le foto
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFile}
          className="hidden"
        />
      </div>
    );
  }

  // ---- Revisione + creazione -------------------------------------------------
  const creating = phase === 'creating';
  return (
    <div className="rounded-lg border border-secondary-200 bg-white shadow-warm">
      <div className="flex items-center justify-between border-b border-cream-200 px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-900">
          <PackagePlus size={16} strokeWidth={2.4} aria-hidden /> {products.length}{' '}
          {products.length === 1 ? 'prodotto riconosciuto' : 'prodotti riconosciuti'}
        </span>
        <button
          type="button"
          onClick={reset}
          disabled={creating}
          aria-label="Annulla"
          className="text-ink-400 hover:text-ink-700 disabled:opacity-50"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="max-h-[26rem] space-y-3 overflow-y-auto p-3">
        {products.map((p, idx) => {
          const blocked = !p.policy_ok;
          return (
            <div
              key={idx}
              className={`flex gap-3 rounded-lg border p-2.5 ${
                blocked ? 'border-rose-200 bg-rose-50' : 'border-cream-200 bg-cream-50'
              }`}
            >
              {/* Miniature delle foto del prodotto */}
              <div className="flex shrink-0 gap-1">
                {p.image_indexes.slice(0, 2).map((i) => (
                  previews[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={previews[i]}
                      alt=""
                      className="h-16 w-16 rounded-md object-cover"
                    />
                  ) : null
                ))}
              </div>

              <div className="min-w-0 flex-1">
                {blocked ? (
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-700">
                    <AlertTriangle size={14} aria-hidden /> Non pubblicabile
                  </p>
                ) : (
                  <input
                    value={p.name}
                    onChange={(e) => updateProduct(idx, { name: e.target.value })}
                    disabled={creating}
                    placeholder="Nome prodotto"
                    className="w-full rounded border border-cream-300 bg-white px-2 py-1 text-sm font-semibold focus:border-primary-300 focus:outline-none"
                  />
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
                  <span className="rounded bg-cream-200 px-1.5 py-0.5">{p.category_name ?? 'Senza categoria'}</span>
                  {p.tags.length > 0 && <span>{p.tags.length} tag</span>}
                </div>
                {blocked && p.policy_reason && (
                  <p className="mt-1 text-xs text-rose-600">{p.policy_reason}</p>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                {!blocked && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={p.suggested_price ?? ''}
                      onChange={(e) =>
                        updateProduct(idx, {
                          suggested_price: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      disabled={creating}
                      className="w-20 rounded border border-cream-300 bg-white px-2 py-1 text-right text-sm focus:border-primary-300 focus:outline-none"
                    />
                    <span className="text-xs text-ink-400">€</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeProduct(idx)}
                  disabled={creating}
                  aria-label="Rimuovi prodotto"
                  className="text-ink-400 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-cream-200 p-3">
        <span className="text-xs text-ink-500">
          {creatable.length > 0
            ? `Pronte ${creatable.length} ${creatable.length === 1 ? 'bozza' : 'bozze'}`
            : 'Nessun prodotto valido'}
        </span>
        <button
          type="button"
          onClick={() => void createAll()}
          disabled={creating || creatable.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-secondary-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-secondary-800 disabled:opacity-40"
        >
          {creating ? (
            <>
              <Loader2 size={16} className="animate-spin" strokeWidth={2.4} aria-hidden /> Creo le bozze…
            </>
          ) : (
            <>
              <PackagePlus size={16} strokeWidth={2.4} aria-hidden /> Crea{' '}
              {creatable.length > 0 ? creatable.length : ''} {creatable.length === 1 ? 'bozza' : 'bozze'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
