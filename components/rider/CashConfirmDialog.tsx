'use client';

import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { sizedImage } from '@/lib/image-url';
import { NOTA_SENZA_FOTO_MAX, corpoDellaConferma, serveUnaProva } from '@/lib/cassa/prova-incasso';
import { fraseDelCompenso } from '@/lib/rider/incasso-alla-consegna';
import { useTranslations } from 'next-intl';
import { Banknote, Camera } from 'lucide-react';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { attributoAccept } from '@/lib/storage/regole-secchi';

/** Il magazzino privato delle prove d'incasso. La sua regola sta in lib/storage/regole-secchi.ts. */
const SECCHIO_PROVE_INCASSO = 'cod-proof';

type Props = {
  orderId: string;
  /** Il contante da rimettere: il totale del cliente MENO il compenso trattenuto. */
  expectedCents: number;
  /** Quanto il fattorino si e' gia' tenuto: serve a spiegare perche il numero e piu basso. */
  compensoTenutoCents?: number;
  /** Il pezzo di compenso che il contante non copriva: gli arriva sull'IBAN (`cifreDellIncasso`). */
  residuoDovutoCents?: number;
  onConfirmed?: () => void;
  /**
   * 15/10/2026 (R33) — Aperto da fuori. Sulla pagina della consegna il
   * pulsante sta nella barra fissa in fondo, che e' spostata con una
   * trasformazione CSS: un pannello `fixed` disegnato li' dentro resterebbe
   * chiuso nella barra invece di coprire lo schermo. Con `aperto` il pannello
   * si disegna dove lo mette la pagina, e qui non compare nessun pulsante.
   */
  aperto?: boolean;
  onChiudi?: () => void;
};

/**
 * Dialog conferma cash on delivery:
 *  - Importo incassato (pre-popolato col contante da rimettere)
 *  - Foto contanti/scontrino: facoltativa sotto i 50 €; da 50 € in su serve,
 *    oppure una nota sul perche' non si e' potuta fare (lib/cassa/prova-incasso.ts)
 *  - Foto consegna pacco (opzionale)
 *
 * Alla conferma chiama /api/rider/cash-confirm che valida lato server
 * (rider proprietario, stato ordine, payment_method=cod, non duplicato).
 */
export default function CashConfirmDialog({
  orderId, expectedCents, compensoTenutoCents = 0, residuoDovutoCents = 0, onConfirmed, aperto, onChiudi,
}: Props) {
  const tStates = useTranslations('states');
  const tActions = useTranslations('actions');
  const controllato = aperto !== undefined;
  const [apertoQui, setApertoQui] = useState(false);
  const open = controllato ? aperto : apertoQui;
  const setOpen = (valore: boolean) => {
    if (!controllato) setApertoQui(valore);
    else if (!valore) onChiudi?.();
  };
  // 6/9/2026 — QUESTO `toFixed(2)` RESTA, ED E' VOLUTO.
  // Non e' una cifra da leggere: e' il valore dentro `<input type="number">`,
  // che il browser accetta solo col punto decimale e che qui sotto rileggiamo
  // con `parseFloat`. Scriverlo «35,00 €» svuoterebbe il campo e il fattorino
  // si troverebbe la casella vuota al momento di dichiarare i contanti.
  // Le cifre da LEGGERE, qui sotto, passano invece da `fraseDelCompenso` (`formatPriceFromCents`).
  const [amount, setAmount] = useState((expectedCents / 100).toFixed(2));
  const [cashPhoto, setCashPhoto] = useState<string | null>(null);
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  // Da 50 € in su, per chi non riesce a fare la foto: il perche', che arriva agli amministratori.
  const [nota, setNota] = useState('');
  const serveLaFoto = serveUnaProva(expectedCents);
  const [uploading, setUploading] = useState<'cash' | 'delivery' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pannelloRef = useRef<HTMLDivElement>(null);
  const bottoneApri = useRef<HTMLButtonElement | null>(null);
  // Aperto da fuori: il fuoco, alla chiusura, torna al pulsante che l'ha aperto.
  // Sta PRIMA del gancio qui sotto, cosi' lui lo trova gia' al suo posto.
  useEffect(() => {
    if (controllato && open && document.activeElement instanceof HTMLButtonElement) {
      bottoneApri.current = document.activeElement;
    }
  }, [controllato, open]);
  useBottomSheetA11y(open, pannelloRef, bottoneApri, () => setOpen(false));

  // Le prove d'incasso vanno nel secchio privato `cod-proof`, nella cartella del
  // fattorino che le carica. Prima finivano nel secchio pubblico `products` sotto
  // `cod-proof/<ordine>/`: chi indovinava l'indirizzo vedeva la foto dei
  // contanti e quella della porta di casa del cliente. Qui si salva il PERCORSO,
  // non un indirizzo pubblico: chi ha diritto di vederla ottiene un link a
  // scadenza.
  //
  // 8/9/2026 — E IL PERCORSO NON SE LO SCRIVE PIU' QUESTA SCHERMATA.
  //
  // C'erano due cose sbagliate nella riga che se n'e' andata. La prima: il percorso era una
  // stringa scritta a mano, con dentro la prima cartella — l'unica su cui il database decide chi
  // puo' scrivere. Oggi era giusta, ma per caso, com'era giusta in sette punti su dieci sul
  // secchio `products`, dove i tre sbagliati hanno impedito a ogni negoziante di mettere la
  // copertina alla vetrina. La seconda, piu' grave: qui non si guardava ne' il tipo ne' il peso
  // del file, e `cod-proof` e' l'UNICO dei quattro magazzini che nemmeno nel deposito ha un tetto
  // (la 114 lo crea nudo). Fra il telefono del fattorino e il nostro archivio non c'era niente:
  // un file qualunque, di qualunque peso, con l'estensione `.jpg` messa d'ufficio anche se dentro
  // c'era altro.
  //
  // Adesso si passa da `caricaImmagine`, che legge la regola del magazzino da
  // `lib/storage/regole-secchi.ts`: sette tipi immagine, 10 MB, prima cartella = chi carica.
  async function upload(file: File, kind: 'cash' | 'delivery'): Promise<string | null> {
    setUploading(kind);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sessione scaduta');
      const { percorso } = await caricaImmagine(supabase, {
        file,
        userId: user.id,
        cartella: orderId,
        secchio: SECCHIO_PROVE_INCASSO,
        etichetta: kind,
      });
      return percorso;
    } catch (e) {
      // `friendlyError` tiene la frase in italiano che arriva dalla porta («La foto è troppo
      // pesante: il limite è 10 MB…») e mette la frase di casa su tutto il resto, invece del
      // «Upload fallito» di prima, che non e' nemmeno italiano.
      toast.error(friendlyError(e));
      return null;
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    // 16/10/2026 — Il corpo lo scrive `corpoDellaConferma`: senza foto qui partiva
    // `"photoUrl": null`, la rotta rispondeva «Dati non validi» e — con l'incasso
    // prima del codice — la consegna non si chiudeva piu'.
    const pronto = corpoDellaConferma({
      orderId,
      importo: amount,
      contanteDaRimettereCents: expectedCents,
      fotoContanti: cashPhoto,
      fotoConsegna: deliveryPhoto,
      nota,
    });
    if (!pronto.ok) {
      toast.error(pronto.messaggio);
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/rider/cash-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pronto.corpo),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(apiErrorMessage(data));
      toast.success('Incasso confermato');
      setOpen(false);
      onConfirmed?.();
    } catch (e) {
      // 6/9/2026 — L'AVVISO DICEVA SOLTANTO «ERRORE».
      // Quando quello che viene lanciato non e' un Error — capita con un
      // reject nudo o con una stringa — restava la parola secca «Errore»: non
      // dice cosa e' successo ne' cosa fare, e chi la legge puo' solo
      // riprovare a caso. `friendlyError` tiene il messaggio del server
      // quando c'e' ed e' leggibile, e altrimenti mette la frase che il sito
      // usa gia' dappertutto: «Qualcosa non ha funzionato. Riprova fra un
      // momento.»
      toast.error(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    if (controllato) return null;
    return (
      <button
        type="button"
        ref={bottoneApri}
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-accent-500 px-4 py-3 text-sm font-semibold text-ink-900 hover:bg-accent-600 flex items-center justify-center gap-1.5"
      >
        <Banknote size={16} strokeWidth={2.2} aria-hidden /> Conferma incasso contanti
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
      {/* 22/8/2026 — QUESTO PANNELLO NON DICEVA DI ESSERE UN PANNELLO.
          Copre lo schermo, ma per uno screen reader era un pezzo di pagina come
          un altro: nessun annuncio all'apertura, nessuna uscita con Esc, e da
          tastiera si finiva dietro il velo senza modo di tornare indietro. E'
          la schermata in cui il fattorino dichiara quanti contanti ha in mano:
          bloccarcelo dentro e' il modo piu' veloce per far sbagliare la cassa.
          `useBottomSheetA11y` fa le tre cose (fuoco dentro, Esc, ritorno al
          pulsante) ed esisteva gia' da un file di distanza. */}
      <div
        ref={pannelloRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titolo-conferma-contanti"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="titolo-conferma-contanti" className="text-lg font-semibold text-ink-900">Conferma incasso contanti</h2>
        <p className="mt-1 text-xs text-ink-500">
          {serveLaFoto
            ? 'Inserisci l’importo ricevuto. Da 50 € in su serve la foto dei contanti: se non riesci a farla, scrivi il perché nella nota.'
            : 'Inserisci l’importo ricevuto. Le foto (contanti/scontrino e consegna) sono facoltative.'}
        </p>

        <label className="mt-4 block text-sm font-medium text-ink-700" htmlFor="contante-da-rimettere">
          Contante da rimettere (€)
        </label>
        <input
          id="contante-da-rimettere"
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-lg font-mono"
        />
        <p className="mt-1 text-xs text-ink-500">
          {fraseDelCompenso({ expectedCents, compensoTenutoCents, residuoDovutoCents })}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <PhotoSlot
            label="Foto contanti / scontrino"
            required={serveLaFoto}
            url={cashPhoto}
            uploading={uploading === 'cash'}
            onChange={async (f) => setCashPhoto(await upload(f, 'cash'))}
          />
          <PhotoSlot
            label="Foto consegna pacco"
            required={false}
            url={deliveryPhoto}
            uploading={uploading === 'delivery'}
            onChange={async (f) => setDeliveryPhoto(await upload(f, 'delivery'))}
          />
        </div>

        {serveLaFoto && !cashPhoto && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-ink-700" htmlFor="nota-senza-foto">
              Non riesci a fare la foto? Scrivi il perché
            </label>
            <textarea
              id="nota-senza-foto"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={NOTA_SENZA_FOTO_MAX}
              rows={2}
              placeholder="Es. fotocamera rotta, pagato con tre banconote da 20"
              className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-ink-500">La nota arriva agli amministratori insieme all&apos;incasso.</p>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-cream-300 hover:bg-cream-50"
          >
            {tActions('cancel')}
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-accent-600 disabled:opacity-50"
          >
            {submitting ? tStates('sending') : tActions('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoSlot({
  label, required, url, uploading, onChange,
}: {
  label: string;
  required: boolean;
  url: string | null;
  uploading: boolean;
  onChange: (f: File) => void;
}) {
  return (
    <label className="cursor-pointer">
      <div className="text-xs font-medium text-ink-700">
        {label} {required && <span className="text-rose-600">*</span>}
      </div>
      <div className="mt-1 flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-cream-300 bg-cream-50">
        {url ? (
          <img src={sizedImage(url, 400)} alt="" loading="lazy" className="h-full w-full rounded-lg object-cover" />
        ) : uploading ? (
          <span className="text-xl text-ink-400">…</span>
        ) : (
          <Camera size={24} strokeWidth={2.2} className="text-ink-400" aria-hidden />
        )}
      </div>
      <input
        type="file"
        /* 8/9/2026 — era `image/*`, cioe' «qualunque immagine», e il deposito di questo magazzino
           non ha nessuna lista: il fattorino poteva mandare un TIFF da 80 MB e non se ne accorgeva
           nessuno. La lista arriva dalla stessa regola che poi rifiuta il file, quindi il campo e
           la porta non possono dire due cose diverse. */
        accept={attributoAccept(SECCHIO_PROVE_INCASSO)}
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onChange(f);
        }}
      />
    </label>
  );
}
