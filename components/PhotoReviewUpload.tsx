'use client';

import { useState } from 'react';
import Image from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import { Camera, X, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { ANNO_IN_SECONDI, caricaImmagine } from '@/lib/storage/carica-immagine';
import { attributoAccept, regolaDelSecchio, tettoInMB } from '@/lib/storage/regole-secchi';

type Props = {
  userId: string;
  productId: string;
  onUploaded: (urls: string[]) => void;
  max?: number;
};

/**
 * Il magazzino delle foto delle recensioni. La sua regola di scrittura e' la stessa del secchio
 * pubblico — la prima cartella dev'essere chi carica — e sta scritta in SQL, non nel codice.
 */
const SECCHIO_RECENSIONI = 'reviews';

/**
 * 8/9/2026 — QUESTE DUE RIGHE ERANO DUE NUMERI SCRITTI A MANO, E DICEVANO IL FALSO.
 *
 * C'era scritto `MAX_SIZE_MB = 5` e `ACCEPT = 'image/jpeg,image/png,image/webp'`. Il deposito
 * delle recensioni, in SQL, ne accetta 10 MiB e sette tipi
 * (`migrations/070_storage_and_rls_hardening.sql`). Due conseguenze vere, in negozio:
 *
 *   · una foto da 7 MB veniva rifiutata QUI con la frase «supera 5MB», mentre il deposito
 *     l'avrebbe presa senza fiatare;
 *   · una foto scattata con un iPhone (HEIC) non compariva nemmeno nella finestra «scegli un
 *     file», perche' il campo la nascondeva.
 *
 * Non e' che il numero fosse sbagliato: e' che era una COPIA, e le copie invecchiano. Adesso la
 * lista e il tetto arrivano dalla regola del magazzino, che e' anche quella che poi rifiuta il
 * file: il campo e la porta non possono piu' dire due cose diverse.
 */
const ACCEPT = attributoAccept(SECCHIO_RECENSIONI);
const MAX_SIZE_MB = tettoInMB(SECCHIO_RECENSIONI);
const MAX_BYTE = regolaDelSecchio(SECCHIO_RECENSIONI).maxByte;

/** Quello che c'e' scritto dentro un errore, da qualunque parte arrivi. */
function messaggioDi(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '';
}

/**
 * 6/9/2026 — QUI DAVANTI C'E' UN CLIENTE CHE ALLEGA LA FOTO DEL PANE, NON UN PROGRAMMATORE.
 *
 * ── Cosa gli arrivava sullo schermo ──────────────────────────────────────────────────────────
 * Quattro frasi, tali e quali: «Bucket "reviews" non esiste. Chiedi all'admin di crearlo
 * (public, max 5MB)», «caricaImmagine senza file», «percorso non ammesso (la prima cartella e'
 * «xyz»: il database accetta solo l'identificativo di chi carica…)» e il ripiego «Upload
 * fallito», che non e' nemmeno italiano. Nessuna gli dice cosa fare. Tre su quattro sono guasti
 * NOSTRI, su cui lui non puo' fare niente: leggerne il motivo tecnico non lo aiuta, gli fa solo
 * pensare di aver sbagliato qualcosa e lasciare la recensione a meta'.
 *
 * ── Perche' una LISTA CHIUSA e non una traduzione caso per caso ──────────────────────────────
 * Il ripiego di prima era «mostra il messaggio che ti arriva, qualunque sia»: una rete di
 * sicurezza che si comportava da porta aperta, perche' ogni errore nuovo — dello storage, della
 * porta dei caricamenti, di una libreria — usciva in inglese senza che nessuno lo decidesse.
 * `friendlyError` non basta da solo: il suo ultimo ramo lascia passare qualunque frase corta che
 * cominci per lettera, e «caricaImmagine senza file» passa quel filtro.
 * Qui sotto ci sono le UNICHE tre cose su cui chi carica puo' agire davvero. Tutto il resto —
 * conosciuto o no, oggi o fra sei mesi — esce come «non riusciamo a salvare la foto», che e' la
 * verita' e dice anche come uscirne: la recensione si puo' lasciare comunque.
 */
const NON_RIUSCIAMO_A_SALVARE =
  'Non riusciamo a salvare la foto in questo momento. Riprova fra poco: la recensione puoi lasciarla anche senza foto.';
const FORMATO_NON_ACCETTATO = 'Questa foto è in un formato che non accettiamo: usa un JPG, un PNG o un WEBP.';
const FOTO_TROPPO_PESANTE = `La foto è troppo pesante: tieniti sotto i ${MAX_SIZE_MB} MB, o scattane una più leggera.`;
const RETE_CADUTA = 'Connessione persa mentre caricavamo la foto. Controlla la rete e riprova.';

/**
 * Le uniche frasi grezze su cui chi carica puo' fare qualcosa. Fuori da questa lista: guasto
 * nostro, e si dice cosi'. L'ordine conta: si ferma alla prima che riconosce.
 */
const FRASI_DI_CARICAMENTO: Array<[RegExp, string]> = [
  [/formato non accettato|mime type|not supported/i, FORMATO_NON_ACCETTATO],
  [/troppo pesante|exceeded the maximum allowed size|payload too large/i, FOTO_TROPPO_PESANTE],
  [/network|fetch|timeout|aborted|connessione/i, RETE_CADUTA],
];

/** L'unica cosa che puo' finire davanti a chi carica: una delle quattro frasi qui sopra. */
function frasePerChiCarica(err: unknown): string {
  const grezzo = messaggioDi(err);
  for (const [quando, dire] of FRASI_DI_CARICAMENTO) {
    if (quando.test(grezzo)) return dire;
  }
  return NON_RIUSCIAMO_A_SALVARE;
}

/**
 * Upload foto recensione: max N foto (default 4). Il peso e i tipi ammessi li dice la regola
 * del magazzino `reviews` (lib/storage/regole-secchi.ts), non questa schermata.
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
        // Il tetto lo conosce la regola del magazzino, non questa schermata: qui si guarda solo
        // PRIMA, per saltare il file troppo pesante e caricare comunque gli altri. Se lo lasciassimo
        // arrivare alla porta, il primo file grosso farebbe cadere tutto il giro e chi carica
        // perderebbe anche le foto buone che aveva scelto insieme.
        if (file.size > MAX_BYTE) {
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
        const { percorso, publicUrl } = await caricaImmagine(supabase, {
          file,
          userId,
          cartella: productId,
          secchio: SECCHIO_RECENSIONI,
          cacheControl: ANNO_IN_SECONDI,
        });

        newUrls.push({ url: publicUrl, path: percorso });
      }

      const next = [...files, ...newUrls];
      setFiles(next);
      onUploaded(next.map((f) => f.url));
      if (newUrls.length > 0) toast.success(`${newUrls.length} foto caricat${newUrls.length === 1 ? 'a' : 'e'}`);
    } catch (err) {
      toast.error(frasePerChiCarica(err));
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
        Aggiungi foto della tua esperienza ({max} max, {MAX_SIZE_MB}MB ciascuna). Le recensioni con foto guadagnano +20 punti loyalty.
      </p>
    </div>
  );
}
