'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import caricatoreFotoRemote from '@/lib/image-loader';
import { friendlyError } from '@/lib/errors';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { avvisoPerGliScartati, mappaAccept, pesoMassimo, tipiScrittiPerUmani } from '@/lib/storage/casella-di-caricamento';
import { richiestaPerIlSito } from '@/lib/storage/foto-del-sito';
import { acceptSenzaHeic, avvisoFotoHeic, eFotoHeic, senzaHeic } from '@/lib/immagini/heic-in-jpeg';

/**
 * Vedi `lib/storage/casella-di-caricamento.ts`: l'elenco dei file che questa casella accetta lo
 * detta il magazzino. Prima erano tre tipi scritti qui a mano contro i sette del deposito, e una
 * foto scattata con l'iPhone spariva senza una parola.
 *
 * LE FOTO HEIC/HEIF DELL'IPHONE NON ENTRANO PIU' IN VETRINA COSI' COME SONO. Salvate com'erano, il
 * negoziante le vedeva bene dal suo iPhone e i clienti su Chrome, Firefox, Edge e Android vedevano
 * un riquadro rotto. La casella le lascia entrare (`ACCETTA`) perche' `senzaHeic`
 * (`lib/immagini/heic-in-jpeg.ts`) le converta in JPEG prima di partire, o le rifiuti con una frase
 * chiara dove il browser non le sa leggere. Il campo file invece non le chiede (`ACCEPT_DEL_CAMPO`):
 * cosi' l'iPhone, scegliendo dalla galleria, consegna gia' un JPEG. La stessa regola sta in
 * `GalleryFields.tsx`: ogni casella si regge da sola.
 */
const ACCETTA = mappaAccept();
const ACCEPT_DEL_CAMPO = acceptSenzaHeic(ACCETTA);
const PESO_MASSIMO = pesoMassimo();
const FORMATI_DA_DIRE = (() => {
  const formati = Object.entries(ACCETTA)
    .filter(([tipo]) => !eFotoHeic({ type: tipo }))
    .map(([, estensioni]) => estensioni[0].slice(1).toUpperCase());
  return `${formati.slice(0, -1).join(', ')} o ${formati[formati.length - 1]}`;
})();

/**
 * Per gli scartati parla il cervello comune; fra i formati da proporre non nomina HEIC/HEIF, che
 * entrano solo dove il browser li sa convertire.
 */
function avvisoDelSito(scartati: readonly FileRejection[], postiLiberi: number): string | null {
  const avviso = avvisoPerGliScartati(scartati, { postiLiberi });
  return avviso ? avviso.replace(tipiScrittiPerUmani(), FORMATI_DA_DIRE) : null;
}

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
  // Cosa chiediamo al deposito lo decide `lib/storage/foto-del-sito.ts`, dove una prova può
  // ESEGUIRLO: qui dentro — 'use client', React, sonner, il client Supabase — non si poteva.
  const { publicUrl } = await caricaImmagine(supabase, richiestaPerIlSito(file, user.id));
  return publicUrl;
}

/** Upload di una singola immagine con anteprima (banner). */
export function SingleImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCETTA,
    maxSize: PESO_MASSIMO,
    maxFiles: 1,
    /** Il file buttato fuori adesso ha una voce: prima spariva e basta. */
    onDropRejected: (scartati) => {
      const avviso = avvisoDelSito(scartati, 1);
      if (avviso) toast.error(avviso);
    },
    onDrop: async (files) => {
      const scelta = files[0];
      if (!scelta) return;
      setBusy(true);
      try {
        const f = await senzaHeic(scelta);
        if (!f) {
          toast.error(avvisoFotoHeic());
          return;
        }
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
          <Image src={sizedImage(value, 480, { quadrato: true })} alt="" fill sizes="480px" loader={caricatoreFotoRemote} className="object-cover" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-2 right-2 bg-white/90 text-ink-700 hover:text-red-600 rounded-md px-2 py-1 text-xs font-medium shadow-warm"
          >
            Rimuovi
          </button>
        </div>
      )}
      <div
        {...getRootProps({ role: 'button', 'aria-label': "Carica un'immagine: trascina il file o premi Invio" })}
        className={`border-2 border-dashed rounded-lg p-4 cursor-pointer text-sm text-center transition-colors ${
          isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
        } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input {...getInputProps({ accept: ACCEPT_DEL_CAMPO, 'aria-label': "Carica un'immagine" })} />
        {busy ? 'Caricamento…' : value ? 'Sostituisci immagine' : "Trascina o clicca per caricare un'immagine"}
      </div>
    </div>
  );
}
