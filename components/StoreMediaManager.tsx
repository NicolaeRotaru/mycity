'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { Image as ImageIcon, Video, ArrowUp, ArrowDown, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { StoreMediaItem } from './StoreMediaCarousel';
import { friendlyError } from '@/lib/errors';
import { sizedImage } from '@/lib/image-url';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { useTranslations } from 'next-intl';

interface Props {
  value: StoreMediaItem[];
  onChange: (next: StoreMediaItem[]) => void;
}

const MAX_IMAGES = 3;
const MAX_VIDEOS = 1;

const StoreMediaManager = ({ value, onChange }: Props) => {
  const tStates = useTranslations('states');
  const [uploading, setUploading] = useState(false);

  const imageCount = value.filter((m) => m.type === 'image').length;
  const videoCount = value.filter((m) => m.type === 'video').length;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    /**
     * 6/9/2026 — IL VIDEO DELLA VETRINA NON POTEVA FUNZIONARE PER NESSUNO.
     *
     * Qui c'era anche `'video/*': []`, e la scritta sotto prometteva «fino a 3 immagini e 1
     * video». Ma il file finisce nel deposito pubblico `products`, e quel deposito — dalla
     * migrazione 070 — accetta soltanto sette tipi di immagine, con un tetto di 10 MB. Nessun
     * video e' mai entrato: il fornaio che voleva far vedere il forno acceso trascinava il
     * filmato, aspettava, e si prendeva un errore. E anche se il tipo passasse, quindici secondi
     * fatti col telefono pesano 30-60 MB, cioe' tre volte il tetto.
     *
     * Fra il riaprire il video (deposito nuovo, tetto piu' alto, compressione nel browser: un
     * lavoro vero, con una migrazione, che non e' di questo lotto) e il non prometterlo piu', si
     * toglie la promessa. Adesso il riquadro chiede foto e basta, e chi ci trascina un filmato lo
     * scopre subito invece che dopo aver aspettato il caricamento.
     *
     * I video gia' caricati restano visibili e rimovibili qui sotto: si smette di accettarne di
     * nuovi, non si butta via quello che c'e'.
     */
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    multiple: true,
    // Senza questa riga il file rifiutato spariva in silenzio, che e' il modo peggiore di dire di no.
    onDropRejected: (rifiutati) => {
      const video = rifiutati.some((r) => r.file.type.startsWith('video/'));
      toast.error(
        video
          ? 'Qui vanno solo foto: il video della vetrina per ora non si puo\' caricare.'
          : 'Formato non accettato: servono foto in JPG, PNG o WEBP.',
      );
    },
    onDrop: async (files) => {
      setUploading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');

        const next = [...value];
        for (const file of files) {
          const isVideo = file.type.startsWith('video/');
          const isImage = file.type.startsWith('image/');
          if (!isVideo && !isImage) continue;

          const currentImages = next.filter((m) => m.type === 'image').length;
          const currentVideos = next.filter((m) => m.type === 'video').length;
          if (isVideo && currentVideos >= MAX_VIDEOS) {
            toast.error('Max 1 video per negozio');
            continue;
          }
          if (isImage && currentImages >= MAX_IMAGES) {
            toast.error('Max 3 immagini per negozio');
            continue;
          }

          // Qui il percorso partiva con la parola fissa `store-media`, e il database rifiuta ogni
          // percorso la cui prima cartella non sia l'identificativo di chi carica: nessun negoziante
          // e' mai riuscito a mettere la copertina alla propria vetrina. Adesso il percorso non lo
          // costruisce piu' questo file: lo fa l'unica porta, che riceve una cartella e non un
          // percorso.
          let publicUrl: string;
          try {
            ({ publicUrl } = await caricaImmagine(supabase, {
              file,
              userId: user.id,
              cartella: 'store-media',
            }));
          } catch (e) {
            toast.error(friendlyError(e));
            continue;
          }
          next.push({ type: isVideo ? 'video' : 'image', url: publicUrl });
        }
        onChange(next);
        toast.success('Media caricato');
      } catch (err) {
      toast.error(friendlyError(err));
    } finally {
        setUploading(false);
      }
    },
  });

  const move = (i: number, dir: -1 | 1) => {
    const next = [...value];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  // Solo le foto: il posto per il video non si conta piu', perche' un video non si puo' caricare.
  const canAddMore = imageCount < MAX_IMAGES;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Copertina negozio</label>
        <p className="text-xs text-ink-500">
          Aggiungi fino a {MAX_IMAGES} foto (JPG, PNG o WEBP). Trascina per riordinare.
          Attualmente: {imageCount}/{MAX_IMAGES} foto
          {videoCount > 0 && ' · ' + videoCount + ' video caricato in passato'}.
        </p>
      </div>

      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((m, i) => (
            <li key={i} className="flex items-center gap-3 border rounded-lg p-2 bg-cream-50">
              <div className="w-20 h-16 rounded overflow-hidden bg-black shrink-0">
                {m.type === 'image' ? (
                  // 6/9/2026 — La foto arrivava alla misura con cui era stata caricata (fino a 10 MB, il tetto
                  // del deposito) per stare in un francobollo. Adesso si chiede al server la copia della misura
                  // del riquadro, il doppio in pixel perche' i telefoni ne hanno due per ognuno.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sizedImage(m.url, 160)} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-700 inline-flex items-center gap-1">
                  {m.type === 'image' ? (
                    <ImageIcon size={16} aria-hidden className="text-ink-500" />
                  ) : (
                    <Video size={16} aria-hidden className="text-ink-500" />
                  )}
                  {m.type === 'image' ? 'Immagine' : 'Video'} · posizione {i + 1}
                </p>
                <p className="text-xs text-ink-400 truncate">{m.url.split('/').pop()}</p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-xs bg-white border px-2 py-1 rounded disabled:opacity-30 inline-flex items-center justify-center"
                  aria-label="Sposta su"
                >
                  <ArrowUp size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                  className="text-xs bg-white border px-2 py-1 rounded disabled:opacity-30 inline-flex items-center justify-center"
                  aria-label="Sposta giù"
                >
                  <ArrowDown size={16} aria-hidden />
                </button>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded shrink-0 inline-flex items-center gap-1"
              >
                <X size={16} aria-hidden />
                Rimuovi
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAddMore && (
        <div
          {...getRootProps({ role: 'button', 'aria-label': 'Carica le foto del negozio: trascina i file o premi Invio' })}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input {...getInputProps({ 'aria-label': 'Carica le foto del negozio' })} />
          <p className="text-sm text-ink-600">
            {uploading
              ? tStates('loading')
              : 'Trascina le foto qui, oppure clicca per sceglierle'}
          </p>
        </div>
      )}
    </div>
  );
};

export default StoreMediaManager;
