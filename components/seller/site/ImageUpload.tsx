'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import caricatoreFotoRemote from '@/lib/image-loader';
import { friendlyError } from '@/lib/errors';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import {
  avvisoPerGliScartati,
  mappaAccept,
  pesoMassimo,
  tipiScrittiPerUmani,
  type OpzioniDelDrop,
  type ScartoDellaCasella,
} from '@/lib/storage/casella-di-caricamento';
import { richiestaPerIlSito } from '@/lib/storage/foto-del-sito';

/**
 * R21-002 — LE FOTO HEIC/HEIF DELL'IPHONE NON ENTRANO PIU' IN VETRINA COSI' COME SONO.
 *
 * Il magazzino le accetta, ma nessuno le converte: il file si salvava tale e quale, il negoziante
 * lo vedeva bene dal suo iPhone e i clienti su Chrome, Firefox, Edge e Android vedevano un
 * riquadro rotto. Come per le foto prodotto (`lib/products/uploadImages.ts`) si tolgono
 * dall'elenco della casella: senza HEIC nell'`accept` l'iPhone le converte da solo in JPEG, e un
 * .heic trascinato da un PC la casella lo scarta e `avvisoPerGliScartatiDelSito` dice perche' e
 * cosa fare.
 * Riconosce il tipo («…/heic»), l'estensione («.heif») e il nome del file («IMG_0421.HEIC»).
 */
const FORMATO_DELL_IPHONE = /[./]hei[cf]$/i;

const FOTO_HEIC =
  "Le foto HEIC (il formato dell'iPhone) non le carichiamo: su Chrome e sui telefoni Android si vedrebbero come un riquadro vuoto. Sceglile direttamente dall'iPhone, che le trasforma da solo in JPG, oppure salvale in JPG e riprova.";

/** La foto e' un HEIC/HEIF? Dal tipo o, se il PC non lo sa dire, dal nome. */
function fotoHeic(file: { name?: string; type?: string } | null | undefined): boolean {
  return FORMATO_DELL_IPHONE.test(String(file?.type ?? '')) || FORMATO_DELL_IPHONE.test(String(file?.name ?? ''));
}

/** L'elenco del magazzino, senza i formati che i browser dei clienti non sanno mostrare. */
export function soloFotoMostrate(mappa: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(mappa).filter(([tipo]) => !FORMATO_DELL_IPHONE.test(tipo)));
}

/**
 * Vedi `lib/storage/casella-di-caricamento.ts`: l'elenco dei file che questa casella accetta lo
 * detta il magazzino. Prima erano tre tipi scritti qui a mano contro i sette del deposito, e una
 * foto scattata con l'iPhone spariva senza una parola.
 */
const ACCETTA = soloFotoMostrate(mappaAccept());
const PESO_MASSIMO = pesoMassimo();

/** «JPG, PNG, WEBP, GIF o AVIF»: i formati che la casella prende davvero, detti a parole. */
const nomiMostrati = Object.values(ACCETTA).map((estensioni) => estensioni[0].replace('.', '').toUpperCase());
const FORMATI_MOSTRATI = `${nomiMostrati.slice(0, -1).join(', ')} o ${nomiMostrati[nomiMostrati.length - 1]}`;

/**
 * L'avviso per i file scartati dalle caselle della vetrina. Gli HEIC hanno la loro frase; per il
 * resto parla il cervello comune, con l'elenco dei formati senza HEIC/HEIF (la sua frase li
 * nomina, perche' il magazzino li accetta).
 */
export function avvisoPerGliScartatiDelSito(scartati: readonly ScartoDellaCasella[], opzioni: OpzioniDelDrop): string | null {
  const heic = scartati.filter((s) => fotoHeic(s?.file));
  const resto = avvisoPerGliScartati(scartati.filter((s) => !heic.includes(s)), opzioni);
  const frasi: string[] = [];
  if (heic.length > 0) frasi.push(FOTO_HEIC);
  if (resto) frasi.push(resto.replace(tipiScrittiPerUmani(), FORMATI_MOSTRATI));
  return frasi.length > 0 ? frasi.join(' ') : null;
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
      const avviso = avvisoPerGliScartatiDelSito(scartati, { postiLiberi: 1 });
      if (avviso) toast.error(avviso);
    },
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
          <Image src={sizedImage(value, 480, { quadrato: true })} alt="" fill sizes="480px" loader={caricatoreFotoRemote} className="object-cover" />
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
        {...getRootProps({ role: 'button', 'aria-label': "Carica un'immagine: trascina il file o premi Invio" })}
        className={`border-2 border-dashed rounded-lg p-4 cursor-pointer text-sm text-center transition-colors ${
          isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
        } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input {...getInputProps({ 'aria-label': "Carica un'immagine" })} />
        {busy ? 'Caricamento…' : value ? 'Sostituisci immagine' : "Trascina o clicca per caricare un'immagine"}
      </div>
    </div>
  );
}
