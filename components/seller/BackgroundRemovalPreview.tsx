'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { resizeImageToBase64 } from '@/lib/image-resize';
import { Modal } from '@/components/ui/Modal';

/**
 * Anteprima prima/dopo della rimozione sfondo per una singola foto.
 *
 * Flusso: scarica l'immagine pubblica → ridimensiona → /api/image/remove-bg
 * (provider a pagamento, soggetto su BIANCO) → mostra il risultato → su conferma
 * carica la versione su bianco su Storage e sostituisce l'URL nell'array.
 *
 * ~2048px (non 1024) per non degradare la risoluzione della foto definitiva.
 */

const MAX_DIMENSION = 2048;

interface Props {
  open: boolean;
  url: string | null;
  onClose: () => void;
  onReplaced: (newUrl: string) => void;
}

type State = 'processing' | 'ready' | 'error';

export default function BackgroundRemovalPreview({ open, url, onClose, onReplaced }: Props) {
  const [state, setState] = useState<State>('processing');
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null);
  const [resultBase64, setResultBase64] = useState<string | null>(null);
  const [resultMime, setResultMime] = useState<string>('image/png');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    (async () => {
      setState('processing');
      setResultDataUrl(null);
      setResultBase64(null);
      try {
        // 1) Scarica l'immagine pubblica → blob → ridimensiona → base64.
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Impossibile leggere l’immagine.');
        const blob = await resp.blob();
        const { base64, mediaType } = await resizeImageToBase64(blob, MAX_DIMENSION);

        // 2) Chiama la route protetta (bearer token, come PhotoFillButton).
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/image/remove-bg', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ image_base64: base64, media_type: mediaType }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(apiErrorMessage(body, 'Rimozione sfondo non riuscita.'));
        if (cancelled) return;

        const outB64 = (body as { image_base64?: string }).image_base64 ?? '';
        const outMime = (body as { media_type?: string }).media_type || 'image/png';
        setResultBase64(outB64);
        setResultMime(outMime);
        setResultDataUrl(`data:${outMime};base64,${outB64}`);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        toast.error(err instanceof Error ? err.message : 'Rimozione sfondo non riuscita.');
      }
    })();
    return () => { cancelled = true; };
  }, [open, url]);

  const useResult = async () => {
    if (!resultBase64) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      // base64 → File (binario)
      const bytes = Uint8Array.from(atob(resultBase64), (c) => c.charCodeAt(0));
      const ext = resultMime === 'image/png' ? 'png' : resultMime === 'image/webp' ? 'webp' : 'jpg';
      const file = new File([bytes], `bg-white.${ext}`, { type: resultMime });

      // Stesso path pattern degli altri upload prodotto (cartella = user.id, richiesto da RLS).
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-bg-white.${ext}`;
      const { error } = await supabase.storage.from('products').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: resultMime,
      });
      if (error) throw error;
      const { data } = supabase.storage.from('products').getPublicUrl(path);
      onReplaced(data.publicUrl);
      toast.success('Sfondo rimosso');
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sfondo bianco"
      description="Confronta e conferma prima di sostituire la foto"
      size="lg"
      footer={
        state === 'ready' ? (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-cream-300 hover:bg-cream-50 disabled:opacity-50"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={useResult}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <Check size={16} strokeWidth={2.4} aria-hidden /> {saving ? 'Salvataggio…' : 'Usa questa'}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <figure className="space-y-1">
          <figcaption className="text-xs font-medium text-ink-500">Prima</figcaption>
          <div className="aspect-square overflow-hidden rounded-lg border border-cream-200 bg-cream-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {url && <img src={url} alt="Foto originale" className="h-full w-full object-cover" />}
          </div>
        </figure>
        <figure className="space-y-1">
          <figcaption className="text-xs font-medium text-ink-500">Dopo — sfondo bianco</figcaption>
          <div className="aspect-square overflow-hidden rounded-lg border border-cream-200 bg-white flex items-center justify-center">
            {state === 'processing' && (
              <span className="inline-flex items-center gap-2 text-sm text-ink-500">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-300 border-t-primary-600" />
                Rimuovo lo sfondo…
              </span>
            )}
            {state === 'ready' && resultDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resultDataUrl} alt="Prodotto su sfondo bianco" className="h-full w-full object-contain" />
            )}
            {state === 'error' && (
              <span className="px-3 text-center text-sm text-rose-600">Non riuscito. Chiudi e riprova.</span>
            )}
          </div>
        </figure>
      </div>
    </Modal>
  );
}
