'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/errors';

export type ExtractedProduct = {
  name: string;
  description: string;
  category_id: string | null;
  category_slug: string;
  suggested_price: number;
};

interface Props {
  onFilled: (data: ExtractedProduct) => void;
}

type State = 'idle' | 'analyzing';

const MAX_DIMENSION = 1024;

// Ridimensiona via canvas a max 1024x1024 mantenendo aspect ratio, ritorna base64 senza prefisso.
async function resizeImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Lettura file fallita'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Immagine non valida'));
    i.src = dataUrl;
  });

  const ratio = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non supportato');
  ctx.drawImage(img, 0, 0, w, h);

  // Forziamo JPEG: piu' piccolo del PNG e supportato da Claude.
  const outDataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const base64 = outDataUrl.split(',')[1] ?? '';
  return { base64, mediaType: 'image/jpeg' };
}

const PhotoFillButton = ({ onFilled }: Props) => {
  const [state, setState] = useState<State>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // reset cosi' lo stesso file puo' essere ri-selezionato
    if (e.target) e.target.value = '';
    if (!file) return;

    setState('analyzing');
    try {
      const { base64, mediaType } = await resizeImage(file);
      const res = await fetch('/api/vision/extract-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, media_type: mediaType }),
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Estrazione fallita. Riprova.');
    } finally {
      setState('idle');
    }
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
          Scatta una foto del prodotto e l&apos;AI compila nome, descrizione, categoria e prezzo per te.
        </p>
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="bg-white text-primary-800 hover:bg-primary-50 disabled:opacity-60 px-5 py-2.5 rounded-md font-semibold whitespace-nowrap shadow-md flex items-center gap-2"
      >
        {busy ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-indigo-700/30 border-t-indigo-700 rounded-full animate-spin" />
            <span>Analizzo...</span>
          </>
        ) : (
          <>
            <span>📸</span>
            <span>Scatta o carica</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
};

export default PhotoFillButton;
