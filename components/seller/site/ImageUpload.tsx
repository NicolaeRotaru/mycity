'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { friendlyError } from '@/lib/errors';

/**
 * Carica un'immagine nel bucket pubblico 'products' e ritorna l'URL pubblico https.
 *
 * Il path DEVE avere come primo segmento l'UID dell'utente: le policy RLS dello
 * Storage su `products` filtrano read/update/delete su
 * `(storage.foldername(name))[1] = auth.uid()`. Gli asset del sito vanno quindi in
 * `<uid>/site/...` (sottocartella per raggruppare). `upsert:false` + path unico =
 * nessun ON CONFLICT, così l'INSERT richiede solo il ruolo authenticated.
 * Stesso pattern di lib/products/uploadImages.ts.
 */
export async function uploadSiteImage(file: File): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${user.id}/site/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('products').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  return supabase.storage.from('products').getPublicUrl(path).data.publicUrl;
}

/** Upload di una singola immagine con anteprima (banner). */
export function SingleImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    maxFiles: 1,
    onDrop: async (files) => {
      const f = files[0];
      if (!f) return;
      setBusy(true);
      try {
        onChange(await uploadSiteImage(f));
      } catch (e) {
        toast.error(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <div>
      {value && (
        <div className="relative w-full h-40 rounded-lg overflow-hidden mb-2 border border-cream-200">
          <Image src={sizedImage(value, 'card')} alt="" fill sizes="480px" className="object-cover" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-2 right-2 bg-white/90 text-ink-700 hover:text-red-600 rounded-md px-2 py-1 text-xs font-medium shadow"
          >
            Rimuovi
          </button>
        </div>
      )}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-4 cursor-pointer text-sm text-center transition-colors ${
          isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
        } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input {...getInputProps()} />
        {busy ? 'Caricamento…' : value ? 'Sostituisci immagine' : "Trascina o clicca per caricare un'immagine"}
      </div>
    </div>
  );
}
