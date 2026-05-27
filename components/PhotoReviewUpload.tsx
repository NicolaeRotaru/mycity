'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Camera, X, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';

type Props = {
  userId: string;
  productId: string;
  onUploaded: (urls: string[]) => void;
  max?: number;
};

const MAX_SIZE_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Upload foto recensione: max N foto (default 4), max 5MB ciascuna.
 * Salva su Supabase Storage bucket "reviews" (pubblico read).
 * Notifica al parent gli URL pubblici.
 */
export default function PhotoReviewUpload({ userId, productId, onUploaded, max = 4 }: Props) {
  const [files, setFiles] = useState<{ url: string; path: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.files;
    if (!input || input.length === 0) return;

    const remaining = max - files.length;
    const toUpload = Array.from(input).slice(0, remaining);

    setUploading(true);
    const newUrls: { url: string; path: string }[] = [];
    try {
      for (const file of toUpload) {
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          toast.error(`${file.name} supera ${MAX_SIZE_MB}MB`);
          continue;
        }
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const path = `${userId}/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        const { error: upErr } = await supabase.storage.from('reviews').upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        });
        if (upErr) {
          // Se bucket non esiste, mostra errore chiaro
          if (upErr.message.includes('not found')) {
            toast.error('Bucket "reviews" non esiste. Chiedi all\'admin di crearlo (public, max 5MB).');
            return;
          }
          throw upErr;
        }

        const { data } = supabase.storage.from('reviews').getPublicUrl(path);
        newUrls.push({ url: data.publicUrl, path });
      }

      const next = [...files, ...newUrls];
      setFiles(next);
      onUploaded(next.map((f) => f.url));
      if (newUrls.length > 0) toast.success(`${newUrls.length} foto caricat${newUrls.length === 1 ? 'a' : 'e'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload fallito');
    } finally {
      setUploading(false);
      // reset input
      e.target.value = '';
    }
  };

  const remove = async (idx: number) => {
    const f = files[idx];
    try { await supabase.storage.from('reviews').remove([f.path]); } catch { /* noop */ }
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    onUploaded(next.map((x) => x.url));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {files.map((f, i) => (
          <div key={f.path} className="relative w-20 h-20 rounded-lg overflow-hidden border-2 border-cream-300">
            <Image src={f.url} alt="" fill sizes="80px" unoptimized className="object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute -top-1 -right-1 bg-secondary-500 hover:bg-secondary-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow"
              aria-label="Rimuovi"
            >
              <X size={12} strokeWidth={2.4} />
            </button>
          </div>
        ))}
        {files.length < max && (
          <label className="inline-flex flex-col items-center justify-center w-20 h-20 rounded-lg border-2 border-dashed border-cream-300 hover:border-primary-300 cursor-pointer transition-colors">
            <input type="file" accept={ACCEPT} multiple onChange={handleChange} className="hidden" disabled={uploading} />
            {uploading ? (
              <Upload size={20} className="text-ink-400 animate-pulse" />
            ) : (
              <>
                <Camera size={20} className="text-ink-400" />
                <span className="text-[10px] text-ink-500 mt-0.5">{files.length}/{max}</span>
              </>
            )}
          </label>
        )}
      </div>
      <p className="text-xs text-ink-400">
        Aggiungi foto della tua esperienza ({max} max, 5MB ciascuna). Le recensioni con foto guadagnano +20 punti loyalty.
      </p>
    </div>
  );
}
