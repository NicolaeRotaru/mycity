'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Field';
import { sizedImage } from '@/lib/image-url';
import caricatoreFotoRemote from '@/lib/image-loader';
import { friendlyError } from '@/lib/errors';
import { MAX_GALLERY_ITEMS, type SiteSection } from '@/lib/store-site';
import {
  avvisoPerGliScartati,
  decidiCosaFareDelDrop,
  mappaAccept,
  pesoMassimo,
  tipiScrittiPerUmani,
} from '@/lib/storage/casella-di-caricamento';
import { uploadSiteImage } from './ImageUpload';
import { acceptSenzaHeic, avvisoFotoHeic, eFotoHeic, tutteSenzaHeic } from '@/lib/immagini/heic-in-jpeg';


/**
 * R09-003 R09-004 — Niente `maxLength` sui campi brevi: il browser tagliava in silenzio quello che si
 * incollava oltre il tetto. Il testo resta intero e, oltre il tetto che lo schema rifiuta al salvataggio
 * (`lib/store-site.ts`), l'errore lo dice sotto il campo. Si conta come lo schema
 * (`z.string().trim().max(n)`); stessa funzione di `BannerFields.tsx`.
 */
function sopraIlTetto(valore: string | undefined, max: number): string | undefined {
  const n = (valore ?? '').trim().length;
  return n > max
    ? `Troppo lungo: ${n.toLocaleString('it-IT')} caratteri su ${max.toLocaleString('it-IT')}. Accorcialo, così si salva.`
    : undefined;
}

type GallerySec = Extract<SiteSection, { type: 'gallery' }>;
type Cfg = GallerySec['config'];
type Item = Cfg['items'][number];

/**
 * QUELLO CHE LA CASELLA ACCETTA LO DECIDE IL MAGAZZINO, NON QUESTO FILE.
 *
 * Fino all'8/9/2026 qui c'erano tre tipi scritti a mano — JPG, PNG, WEBP — mentre il deposito ne
 * accetta sette. I quattro che mancavano comprendono HEIC e HEIF, cioe' le foto dell'iPhone: il
 * negoziante le trascinava e non succedeva niente. Calcolati una volta sola fuori dal componente
 * perche' l'oggetto non cambi identita' a ogni ridisegno.
 *
 * LE FOTO HEIC/HEIF NON ENTRANO PIU' NELLA GALLERIA COSI' COME SONO. Salvate com'erano, il
 * negoziante le vedeva bene dal suo iPhone e i clienti su Chrome, Firefox, Edge e Android vedevano
 * un riquadro rotto. La casella le lascia entrare (`ACCETTA`) perche' `tutteSenzaHeic`
 * (`lib/immagini/heic-in-jpeg.ts`) le converta in JPEG prima di partire, o le rifiuti con una frase
 * chiara dove il browser non le sa leggere. Il campo file invece non le chiede (`ACCEPT_DEL_CAMPO`):
 * cosi' l'iPhone, scegliendo dalla galleria, consegna gia' un JPEG. La stessa regola sta in
 * `ImageUpload.tsx`: ogni casella si regge da sola.
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

/** Config del blocco "galleria": upload multiplo di immagini con testo alternativo. */
export default function GalleryFields({ section, onChange }: { section: GallerySec; onChange: (s: SiteSection) => void }) {
  const c = section.config;
  const items = c.items ?? [];
  const set = (patch: Partial<Cfg>) => onChange({ ...section, config: { ...c, ...patch } });
  const [busy, setBusy] = useState(false);
  // 342 — A caricamento finito si parte dalla sezione e dal `onChange` dell'ULTIMO
  // disegno: quelli del momento del drop ricostruivano sezione, pagina e sito dalla
  // copia vecchia, e cancellavano quello che il negoziante aveva scritto intanto.
  const ultimaSezione = useRef(section);
  ultimaSezione.current = section;
  const ultimoOnChange = useRef(onChange);
  ultimoOnChange.current = onChange;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCETTA,
    maxSize: PESO_MASSIMO,
    disabled: busy || items.length >= MAX_GALLERY_ITEMS,
    /** Il file che la casella butta fuori — formato, peso, quantità — adesso ha una voce. */
    onDropRejected: (scartati) => {
      const avviso = avvisoDelSito(scartati, MAX_GALLERY_ITEMS - items.length);
      if (avviso) toast.error(avviso);
    },
    /**
     * E ANCHE I FILE BUONI TAGLIATI HANNO UNA VOCE, che è la metà che nessuno vedeva.
     *
     * `react-dropzone` non li scarta: sono a posto. Li tagliava questo `slice`, in silenzio, non
     * appena si superavano i dodici. Chi ne trascinava venti ne vedeva comparire dodici e non
     * sapeva se le altre otto stessero ancora caricando. Adesso decide una funzione pura
     * (`decidiCosaFareDelDrop`), che una prova può eseguire: cosa parte, e cosa si dice.
     */
    onDrop: async (files) => {
      const { daCaricare, avviso } = decidiCosaFareDelDrop(files, [], {
        postiLiberi: MAX_GALLERY_ITEMS - items.length,
      });
      if (avviso) toast.error(avviso);
      if (daCaricare.length === 0) return;
      setBusy(true);
      try {
        const { pronte: toUpload, rifiutate } = await tutteSenzaHeic(daCaricare);
        if (rifiutate.length > 0) toast.error(avvisoFotoHeic(rifiutate.length));
        if (toUpload.length === 0) return;
        const urls = await Promise.all(toUpload.map(uploadSiteImage));
        const ora = ultimaSezione.current;
        ultimoOnChange.current({
          ...ora,
          config: { ...ora.config, items: [...(ora.config.items ?? []), ...urls.map((url) => ({ url, alt: '' }) as Item)] },
        });
      } catch (e) {
        toast.error(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
  });

  const setItem = (i: number, patch: Partial<Item>) =>
    set({ items: items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const remove = (i: number) => set({ items: items.filter((_, k) => k !== i) });

  return (
    <div className="space-y-3">
      <Input
        label="Titolo (opzionale)"
        value={c.heading ?? ''}
        error={sopraIlTetto(c.heading, 120)}
        onChange={(e) => set({ heading: e.target.value })}
      />
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((it, i) => (
            <div key={i} className="space-y-1">
              <div className="relative aspect-square rounded-lg overflow-hidden border border-cream-200">
                <Image src={sizedImage(it.url, 160, { quadrato: true })} alt="" fill sizes="160px" loader={caricatoreFotoRemote} className="object-cover" />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Rimuovi immagine"
                  className="absolute top-1 right-1 bg-white/90 text-ink-600 hover:text-red-600 rounded p-1 shadow-warm"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <input
                value={it.alt ?? ''}
                onChange={(e) => setItem(i, { alt: e.target.value })}
                placeholder="Descrizione"
                aria-label={`Descrizione dell'immagine ${i + 1}`}
                aria-invalid={sopraIlTetto(it.alt, 120) ? true : undefined}
                aria-describedby={sopraIlTetto(it.alt, 120) ? `galleria-alt-${i}-error` : undefined}
                className="w-full border border-cream-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-700"
              />
              {sopraIlTetto(it.alt, 120) && (
                <p id={`galleria-alt-${i}-error`} role="alert" className="text-xs font-medium text-secondary-600">{sopraIlTetto(it.alt, 120)}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {items.length < MAX_GALLERY_ITEMS && (
        <div
          {...getRootProps({ role: 'button', 'aria-label': 'Aggiungi immagini alla galleria: trascina i file o premi Invio' })}
          className={`border-2 border-dashed rounded-lg p-4 cursor-pointer text-sm text-center transition-colors ${
            isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
          } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input {...getInputProps({ accept: ACCEPT_DEL_CAMPO, 'aria-label': 'Aggiungi immagini alla galleria' })} />
          {busy ? 'Caricamento…' : `Aggiungi immagini (max ${MAX_GALLERY_ITEMS})`}
        </div>
      )}
    </div>
  );
}
