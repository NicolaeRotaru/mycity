'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, ImagePlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage } from '@/lib/errors';
import { resizeImageToBase64 } from '@/lib/image-resize';
import CameraCapture from '@/components/seller/CameraCapture';

export type ExtractedProduct = {
  name: string;
  description: string;
  category_id: string | null;
  category_slug: string;
  suggested_price: number;
  attributes?: Record<string, string>;
  image_quality?: { score: number; issues: string[] } | null;
  alt_text?: string | null;
};

interface Props {
  onFilled: (data: ExtractedProduct) => void;
}

type State = 'idle' | 'analyzing';

const PhotoFillButton = ({ onFilled }: Props) => {
  const [state, setState] = useState<State>('idle');
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Analisi condivisa: usata sia dallo scatto in-app sia dal caricamento galleria.
  // Max 4 foto (es. fronte + etichetta/retro). Riusa resizeImageToBase64 (1024px JPEG).
  const analyzeFiles = async (files: File[]) => {
    const list = files.slice(0, 4);
    if (list.length === 0) return;

    setState('analyzing');
    try {
      const images = await Promise.all(
        list.map(async (f) => {
          const { base64, mediaType } = await resizeImageToBase64(f);
          return { image_base64: base64, media_type: mediaType };
        }),
      );
      // La route /api/vision/extract-product è protetta (withSellerAuth): inviare
      // il bearer token come gli altri pulsanti sensibili (vedi AIDescriptionButton).
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/vision/extract-product', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, 'Errore sconosciuto'));
      }
      onFilled(data as ExtractedProduct);
      if (!data.category_id) {
        toast.success('Campi compilati. Seleziona manualmente la categoria.');
      } else {
        toast.success('Campi compilati. Controlla e modifica se serve.');
      }
      // Gate qualità foto (non bloccante): suggerisci di rifarla se è scadente.
      const q = (data as ExtractedProduct).image_quality;
      if (q && typeof q.score === 'number' && q.score < 0.5) {
        const why = q.issues?.length ? ` (${q.issues.slice(0, 2).join(', ')})` : '';
        toast(`Foto poco chiara${why}: valuta di rifarla con più luce e sfondo pulito.`, { icon: '📷' });
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Estrazione fallita. Riprova.';
      toast.error(msg);
    } finally {
      setState('idle');
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    // e.target.files è un FileList "live": copiarlo SUBITO in un array, poi
    // azzerare input.value nel finally (così resta possibile ri-selezionare).
    const files = Array.from(input.files ?? []);
    void analyzeFiles(files).finally(() => { input.value = ''; });
  };

  const busy = state === 'analyzing';

  return (
    <div className="bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
      <div className="flex-1">
        <p className="font-bold text-base sm:text-lg flex items-center gap-2">
          <span>📷</span>
          <span>Compila con una foto</span>
        </p>
        <p className="text-sm text-primary-100">
          Scatta o carica 2–4 foto (fronte + etichetta) e l&apos;AI compila nome, descrizione, categoria, prezzo e caratteristiche per te.
        </p>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto">
        {/* Scatto diretto: fotocamera in-app (fallback a fotocamera nativa). */}
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={busy}
          className="flex-1 sm:flex-none bg-white text-primary-800 hover:bg-primary-50 disabled:opacity-60 px-4 py-2.5 rounded-md font-semibold whitespace-nowrap shadow-md flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-indigo-700/30 border-t-indigo-700 rounded-full animate-spin" />
              <span>Analizzo...</span>
            </>
          ) : (
            <>
              <Camera size={18} strokeWidth={2.2} aria-hidden />
              <span>Scatta foto</span>
            </>
          )}
        </button>

        {/* Caricamento dalla galleria (come prima, anche multi-foto). */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="bg-white/15 hover:bg-white/25 text-white disabled:opacity-60 px-4 py-2.5 rounded-md font-semibold whitespace-nowrap flex items-center justify-center gap-2 ring-1 ring-white/40"
        >
          <ImagePlus size={18} strokeWidth={2.2} aria-hidden />
          <span>Galleria</span>
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFile}
        className="hidden"
      />

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { void analyzeFiles([file]); }}
      />
    </div>
  );
};

export default PhotoFillButton;
