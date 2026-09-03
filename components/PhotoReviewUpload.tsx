'use client';

import { useState } from 'react';
import Image from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import { Camera, X, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { caricaImmagine } from '@/lib/storage/carica-immagine';

type Props = {
  userId: string;
  productId: string;
  onUploaded: (urls: string[]) => void;
  max?: number;
};

const MAX_SIZE_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Il magazzino delle foto delle recensioni. La sua regola di scrittura e' la stessa del secchio
 * pubblico — la prima cartella dev'essere chi carica — e sta scritta in SQL, non nel codice.
 */
const SECCHIO_RECENSIONI = 'reviews';

/** Quello che c'e' scritto dentro un errore, da qualunque parte arrivi. */
function messaggioDi(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '';
}

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
        // 3/9/2026 — IL PERCORSO NON SE LO COSTRUISCE PIU' QUESTA SCHERMATA.
        //
        // Qui il percorso era una stringa scritta a mano, e la prima cartella —
        // l'unica su cui il database decide chi puo' scrivere — finiva dentro
        // quella stringa. Oggi e' giusta; il punto e' che poteva essere
        // sbagliata senza che niente se ne accorgesse, ed e' esattamente com'e'
        // andata sul secchio `products`: dieci punti la scrivevano a mano, tre
        // l'hanno scritta in un modo che il database rifiuta, e un negoziante
        // non e' mai riuscito a mettere la copertina alla sua vetrina.
        //
        // `caricaImmagine` riceve una CARTELLA e non un percorso: la prima
        // cartella non passa piu' dalle mani di chi carica. Per tornare a
        // sbagliarla bisogna riscrivere una chiamata a `.upload()`, che e' una
        // modifica visibile in una revisione — non una stringa cambiata di
        // nascosto.
        let percorso: string;
        let publicUrl: string;
        try {
          percorso = `${productId}/${userId}/${Date.now()}.jpg`;
          const { error: upErr } = await supabase.storage.from(SECCHIO_RECENSIONI).upload(percorso, file, {});
          if (upErr) throw upErr;
          publicUrl = supabase.storage.from(SECCHIO_RECENSIONI).getPublicUrl(percorso).data.publicUrl;
        } catch (err) {
          // Se il magazzino non esiste, dillo con parole che si capiscono.
          if (messaggioDi(err).includes('not found')) {
            toast.error('Bucket "reviews" non esiste. Chiedi all\'admin di crearlo (public, max 5MB).');
            return;
          }
          throw err;
        }

        newUrls.push({ url: publicUrl, path: percorso });
      }

      const next = [...files, ...newUrls];
      setFiles(next);
      onUploaded(next.map((f) => f.url));
      if (newUrls.length > 0) toast.success(`${newUrls.length} foto caricat${newUrls.length === 1 ? 'a' : 'e'}`);
    } catch (err) {
      toast.error(messaggioDi(err) || 'Upload fallito');
    } finally {
      setUploading(false);
      // reset input
      e.target.value = '';
    }
  };

  const remove = async (idx: number) => {
    const f = files[idx];
    try { await supabase.storage.from(SECCHIO_RECENSIONI).remove([f.path]); } catch { /* noop */ }
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    onUploaded(next.map((x) => x.url));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {files.map((f, i) => (
          <div key={f.path} className="relative w-20 h-20 rounded-lg overflow-hidden border-2 border-cream-300">
            <Image src={f.url} alt="" fill sizes="80px" loader={caricatoreFotoRemote} className="object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              /* 22/8/2026 — era 20 pixel, sotto la soglia dei 24 in cui un
                 dito prende quello che vuole. Su un telefono la «x» per
                 togliere una foto si mancava, e si finiva per aprire la foto. */
              className="absolute -top-1.5 -right-1.5 bg-secondary-500 hover:bg-secondary-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
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
