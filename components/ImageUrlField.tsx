'use client';

import { useId, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Image from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import { Upload, X, Link as LinkIcon, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { fileColTipoGiusto, mappaAccept, tipiScrittiPerUmani } from '@/lib/storage/casella-di-caricamento';
import {
  controllaIndirizzoImmagine,
  MESSAGGIO_IMMAGINE_NON_ARRIVATA,
} from '@/lib/indirizzo-immagine-ammesso';
import { acceptSenzaHeic, avvisoFotoHeic, senzaHeic } from '@/lib/immagini/heic-in-jpeg';

/**
 * Campo immagine riutilizzabile: accetta SIA un URL incollato a mano SIA il
 * caricamento di un file dal dispositivo (dropzone → Supabase Storage).
 * In entrambi i casi scrive la URL pubblica risultante in `value`.
 *
 * Riusa lo stesso pattern di upload di components/VendorForm.tsx
 * (supabase.storage.from(bucket).upload + getPublicUrl).
 */
type Props = {
  value: string;
  onChange: (url: string) => void;
  /** Bucket Storage pubblico in cui caricare i file. Default: 'products'. */
  bucket?: string;
  /** Prefisso del path nel bucket (es. 'events', 'shop'). */
  pathPrefix: string;
  label: string;
  hint?: string;
};

export function ImageUrlField({ value, onChange, bucket = 'products', pathPrefix, label, hint }: Props) {
  const [uploading, setUploading] = useState(false);
  const idAvviso = useId();

  // Il campo invita a incollare un indirizzo qualsiasi, ma il sito le immagini le sa mostrare solo
  // da quattro domini (`lib/indirizzo-immagine-ammesso.ts`, che tiene la lista insieme a
  // `next.config.js` e alla politica di sicurezza). Prima si accettava tutto in silenzio: si
  // salvava, e la copertina restava un buco bianco sulla home e sulla pagina eventi, senza che
  // nessuno dicesse il perche'. Adesso il giudizio si legge a ogni carattere, e l'avviso compare
  // PRIMA di salvare — non dopo, guardando un riquadro vuoto.
  const esito = controllaIndirizzoImmagine(value);

  // Il controllo sul dominio non puo' sapere se il file esiste davvero: quello lo scopre solo il
  // browser, provando. Teniamo da parte l'INDIRIZZO che ha fallito, non un si'/no: cosi' appena
  // l'admin ne scrive un altro l'avviso sparisce da solo, senza nessun effetto che lo riazzeri.
  const [urlFallita, setUrlFallita] = useState<string | null>(null);
  const nonArriva = value !== '' && urlFallita === value;

  const messaggio = esito.messaggio ?? (nonArriva ? MESSAGGIO_IMMAGINE_NON_ARRIVATA : null);
  const nonMostrabile = messaggio !== null;
  const mostraAnteprima = esito.stato === 'ammesso' && !nonArriva;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    // R16-013 — I tipi li detta il magazzino (`mappaAccept`, da lib/storage/regole-secchi.ts): erano
    // tre scritti qui a mano contro i sette che porta e deposito accettano, e una foto HEIC
    // dell'iPhone restava fuori.
    accept: mappaAccept(bucket),
    maxFiles: 1,
    multiple: false,
    disabled: uploading,
    // Il filtro qui sopra scarta, ma scartava in silenzio: il file finito nel cestino non lasciava
    // traccia a schermo. Stesse parole di StoreMediaManager: il sito dice no in un modo solo.
    onDropRejected: (rifiutati) => {
      const troppi = rifiutati.some((r) => r.errors.some((e) => e.code === 'too-many-files'));
      toast.error(
        troppi
          ? 'Una foto alla volta: trascinane una sola.'
          : `Formato non accettato: servono foto in ${tipiScrittiPerUmani(bucket)}.`,
      );
    },
    onDrop: async (files) => {
      const scelta = files[0];
      if (!scelta) return;
      setUploading(true);
      try {
        // Un HEIC salvato com'e' su Chrome e Android resta un riquadro rotto: qui diventa JPEG, o
        // non parte (`lib/immagini/heic-in-jpeg.ts`).
        const file = await senzaHeic(scelta);
        if (!file) {
          toast.error(avvisoFotoHeic());
          return;
        }
        // Il percorso partiva col solo `pathPrefix`, cioe' `events` o `shop`: due nomi che il
        // database rifiuta, perche' accetta come prima cartella solo l'identificativo di chi carica
        // o `home` per lo staff. Questo campo lo usano tre schermate, tutte di amministrazione,
        // quindi la strada giusta e' l'eccezione dello staff.
        const { publicUrl } = await caricaImmagine(supabase, {
          // Un HEIC trascinato da Windows arriva col tipo vuoto: senza il tipo giusto il deposito lo rifiuta.
          file: fileColTipoGiusto(file, bucket),
          cartella: pathPrefix,
          staff: true,
          secchio: bucket,
          upsert: true,
        });
        onChange(publicUrl);
        toast.success('Immagine caricata');
      } catch (err) {
        toast.error(friendlyError(err));
      } finally {
        setUploading(false);
      }
    },
  });

  return (
    <div>
      <label className="block text-sm font-semibold text-ink-700 mb-1">{label}</label>

      {/* Anteprima + rimozione */}
      {value ? (
        <div className="mb-2 flex items-center gap-3">
          <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-cream-100 border border-cream-300 shrink-0">
            {mostraAnteprima ? (
              <Image
                src={value}
                alt="Anteprima"
                fill
                sizes="80px"
                loader={caricatoreFotoRemote}
                onError={() => setUrlFallita(value)}
                className="object-cover"
              />
            ) : (
              // Disegnare qui l'immagine di un indirizzo che il browser blocchera' non mostra
              // niente: mostra il buco che il difetto produceva. Meglio un riquadro che ammette
              // di non avere un'anteprima — il perche' sta scritto sotto il campo.
              <span className="absolute inset-0 flex items-center justify-center text-2xs leading-tight text-center text-ink-400 px-1">
                Nessuna anteprima
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800"
          >
            <X size={14} strokeWidth={2.4} /> Rimuovi
          </button>
        </div>
      ) : null}

      {/* Dropzone "carica da dispositivo" */}
      <div
        {...getRootProps({ role: 'button', 'aria-label': 'Carica immagine: trascina un file o premi Invio per sceglierlo' })}
        className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg px-3 py-3 text-sm cursor-pointer transition-colors mb-2 ${
          isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 bg-cream-50 hover:border-primary-300'
        } ${uploading ? 'opacity-60 cursor-wait' : ''}`}
      >
        {/* Il campo file di react-dropzone non e' nascosto: e' rimpicciolito a un pixel, quindi
            chi usa un lettore di schermo ci arriva e sente «campo», senza sapere cosa sia. */}
        {/* Senza HEIC nel campo l'iPhone, scegliendo dalla galleria, consegna gia' un JPEG. */}
        <input {...getInputProps({ accept: acceptSenzaHeic(mappaAccept(bucket)), 'aria-label': 'Carica immagine' })} />
        <Upload size={16} strokeWidth={2.2} className="text-ink-500" aria-hidden />
        <span className="text-ink-600">
          {uploading ? 'Caricamento…' : isDragActive ? 'Rilascia qui…' : 'Carica da dispositivo'}
        </span>
      </div>

      {/* Oppure incolla un URL */}
      <div className="relative">
        <LinkIcon size={14} strokeWidth={2.2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="oppure incolla un URL https://…"
          aria-label={label ? `${label}: indirizzo web dell'immagine` : "Indirizzo web dell'immagine"}
          aria-invalid={nonMostrabile || undefined}
          aria-describedby={nonMostrabile ? idAvviso : undefined}
          className={`w-full bg-cream-50 border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            nonMostrabile
              ? 'border-rose-400 focus:ring-rose-600'
              : 'border-cream-300 focus:ring-primary-700'
          }`}
        />
      </div>

      {/* L'avviso che prima non c'era: l'admin salvava e scopriva il buco solo guardando la home.
          `aria-live` gentile e non `role="alert"`: il giudizio cambia a ogni carattere, e un
          annuncio che interrompe a ogni lettera si impara a ignorare. */}
      {messaggio ? (
        <p
          id={idAvviso}
          aria-live="polite"
          className="mt-1 flex items-start gap-1.5 text-xs font-semibold text-rose-700"
        >
          <AlertTriangle size={14} strokeWidth={2.4} className="shrink-0 mt-px" aria-hidden />
          <span>{messaggio}</span>
        </p>
      ) : null}

      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}
