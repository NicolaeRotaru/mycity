'use client';

import { useRef, useState } from 'react';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { AlertTriangle, Phone, MapPin, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { captureError } from '@/lib/analytics/sentry';

/**
 * SOS button per rider in difficoltà.
 *
 * Esperti consultati:
 * - Trust & Safety: "Rider donna, notte, zona isolata = SOS deve esistere
 *   o sei a rischio legale + reputazionale. Glovo ce l'ha dal 2019."
 * - Operations: "Chiamata 112 + alert admin + share posizione = 3 azioni
 *   parallele. Niente form, niente delay."
 * - Accessibility: "Bottone rosso, label esplicita, conferma di 2 step
 *   (evita falsi positivi)."
 *
 * Flusso:
 *   1. Click SOS → dialog di conferma
 *   2. Conferma → parte la richiesta della posizione (non si aspetta), poi subito il tastierino
 *      col 112 (tel:), sincrono, senza attese
 *   3. Poi, con un tempo massimo: insert in rider_sos_events con posizione GPS
 *      → il trigger del database crea una notifica nel pannello per gli admin
 *      e /api/rider/sos/avvisa manda subito un push agli admin (R01-004)
 */

type Props = {
  orderId?: string;
};

/** Quanto aspettiamo la rete per l'avviso a MyCity, dopo che il 112 e' gia' aperto. */
const TEMPO_MASSIMO_AVVISO_MS = 15_000;
/** Quanto aspettiamo il GPS: la posizione e' utile, ma non vale un avviso in ritardo. */
const TEMPO_MASSIMO_GPS_MS = 5_000;

function conTempoMassimo<T>(lavoro: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SOS: nessuna risposta entro ${ms} ms`)), ms);
    lavoro.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Posizione GPS best effort: null se non arriva in tempo (anche se il browser ignora il suo timeout). */
async function leggiPosizione(): Promise<{ lat: number; lng: number } | null> {
  try {
    const pos = await conTempoMassimo(
      new Promise<GeolocationPosition>((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('No geo'));
        // 5/11/2026 — maximumAge: col 112 aperto la pagina va in secondo piano e un fix nuovo può non
        // arrivare mai; una posizione di un minuto fa (quella che il telefono ha già) vale più di niente.
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: TEMPO_MASSIMO_GPS_MS, enableHighAccuracy: true, maximumAge: 60_000 });
      }),
      TEMPO_MASSIMO_GPS_MS + 500,
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Scrive l'evento in rider_sos_events (il trigger del database crea la notifica agli admin).
 * L'utente si legge dalla sessione salvata sul telefono (getSession), senza chiamata di rete:
 * chi puo' scrivere lo decide comunque la regola del database (rider_id = auth.uid()).
 */
async function inviaAvvisoSOS(
  orderId: string | undefined,
  posizioneRichiesta: Promise<{ lat: number; lng: number } | null>,
): Promise<boolean> {
  const [{ data: { session } }, posizione] = await Promise.all([supabase.auth.getSession(), posizioneRichiesta]);
  const user = session?.user;
  if (!user) return false;
  const riga = {
    rider_id: user.id,
    order_id: orderId ?? null,
    lat: posizione?.lat ?? null,
    lng: posizione?.lng ?? null,
    // R01-004 — `triggered_at` lo scrive il database (DEFAULT now()), non l'orologio del telefono:
    // con un telefono indietro di dieci minuti la rotta dell'avviso immediato non ritrovava l'SOS.
  };
  let { error } = await supabase.from('rider_sos_events').insert(riga);
  // R01-004 — L'ordine e' un'informazione in piu', mai una condizione: se la riga con l'ordine viene
  // rifiutata (id non valido, ordine cancellato), l'SOS si scrive comunque, senza ordine.
  if (error && riga.order_id) {
    captureError(error, { context: 'SOSButton.ordine-rifiutato' });
    ({ error } = await supabase.from('rider_sos_events').insert({ ...riga, order_id: null }));
  }
  if (error) throw error;
  // R01-004 — Il trigger crea solo la notifica nel pannello, e il push periodico parte ogni cinque
  // minuti. Questa chiamata fa suonare SUBITO il telefono degli amministratori. Non si aspetta:
  // l'evento e' gia' scritto, e se la chiamata cade restano il pannello e il giro periodico.
  void fetch('/api/rider/sos/avvisa', { method: 'POST' }).catch((e) => captureError(e, { context: 'SOSButton.avvisa' }));
  return true;
}

export default function SOSButton({ orderId }: Props) {
  const [open, setOpen] = useState(false);
  const pannelloRef = useRef<HTMLDivElement>(null);
  const pulsanteRef = useRef<HTMLButtonElement>(null);
  useBottomSheetA11y(open, pannelloRef, pulsanteRef, () => setOpen(false));
  const [sending, setSending] = useState(false);

  const triggerSOS = async () => {
    // 1/11/2026 — PRIMA IL 112, POI TUTTO IL RESTO.
    // Prima il tastierino si apriva solo dopo tre attese in fila: GPS (fino a 8 secondi),
    // una chiamata di rete per sapere chi e' l'utente, la scrittura nel database. Le due
    // chiamate di rete non avevano un tempo massimo: con poco segnale restavano appese e il
    // 112 non si apriva mai. Chiamare il 112 non ha bisogno di internet: va per primo, in
    // modo sincrono, dentro il gesto del fattorino (cosi' il browser non lo blocca).
    //
    // 1. APRE IL TASTIERINO COL 112 GIA' COMPOSTO — non chiama.
    //
    // `tel:` apre il compositore del telefono col numero scritto. La chiamata parte SOLO se
    // il fattorino preme il tasto verde. I due messaggi qui sotto dicevano «Stiamo chiamando
    // il 112» e «Chiamata al 112 in corso», tutti e due al presente, come se stesse gia'
    // squillando. Un fattorino che ha appena premuto SOS puo' restare ad aspettare una
    // chiamata che nessuno ha fatto partire, nel momento in cui conta di piu'.
    //
    // Venti righe piu' in basso il dialogo di conferma lo diceva gia' giusto: «Verra' avviata
    // la chiamata al 112». Il testo esatto era li' dentro, e questi due non l'avevano preso.
    //
    // R16-009 (13/11/2026) — La posizione si chiede PRIMA del tastierino, e non si aspetta.
    // Prima si chiedeva dopo: col 112 aperto la pagina va in secondo piano, e il telefono puo' non
    // dare piu' la posizione, cosi' l'avviso a MyCity partiva senza coordinate. Adesso la richiesta
    // parte qui, con la pagina ancora davanti (getCurrentPosition si chiama subito, in modo
    // sincrono); il tastierino si apre nella riga dopo, senza nessuna attesa e dentro il gesto del
    // fattorino. L'avviso aspetta la posizione al massimo TEMPO_MASSIMO_GPS_MS, poi parte comunque.
    const posizioneRichiesta = leggiPosizione();
    window.location.href = 'tel:112';
    setSending(true);

    // 2. L'avviso a MyCity parte DOPO, e ha un tempo massimo: se la rete non risponde in
    //    tempo il fattorino lo legge, invece di restare su «Invio…» per sempre.
    let alertSent = false;
    // 5/11/2026 — Il tempo massimo ferma solo l'attesa, non la scrittura: se l'avviso arriva dopo i 15
    // secondi l'evento c'è. Si distingue «non è partito» (errore) da «non lo so ancora» (tempo scaduto).
    let tempoScaduto = false;
    try {
      alertSent = await conTempoMassimo(inviaAvvisoSOS(orderId, posizioneRichiesta), TEMPO_MASSIMO_AVVISO_MS);
    } catch (e) {
      tempoScaduto = e instanceof Error && e.message.startsWith('SOS: nessuna risposta');
      captureError(e, { context: 'SOSButton' });
    }

    setSending(false);
    setOpen(false);
    if (alertSent) {
      toast.success('MyCity è stata avvisata. Ora premi CHIAMA sul telefono: il 112 è già composto.', {
        duration: 12_000,
      });
    } else if (tempoScaduto) {
      toast.error('Non sappiamo ancora se MyCity è stata avvisata: la rete è lenta. Premi subito CHIAMA sul telefono per parlare col 112.', {
        duration: 15_000,
      });
    } else {
      // Qui l'avviso a MyCity NON e' partito, e il fattorino deve saperlo: e' solo davanti a
      // un tastierino aperto. Prima diceva «Chiamata al 112 in corso», che era la cosa meno
      // vera possibile proprio nel ramo peggiore.
      toast.error('MyCity NON è stata avvisata. Premi subito CHIAMA sul telefono per parlare col 112.', {
        duration: 15_000,
      });
    }
  };

  return (
    <>
      {/*
        21/8/2026 — IL PULSANTE DI EMERGENZA ERA COPERTO, E SUL TELEFONO NON SI
        POTEVA PREMERE.
        Stava a `bottom-24 right-4 z-40`, cioe' la scatola identica al pulsante
        Assistenza: stessa misura, stesso angolo, stesso piano. Quando due cose
        stanno sullo stesso piano vince quella disegnata dopo, e l'Assistenza e'
        montata dopo nella pagina. Sotto i 768px la copriva al cento per cento.
        Il fattorino lavora dal telefono, e questo e' il pulsante che si preme
        quando qualcuno e' in difficolta' per strada.
        Adesso ha un posto suo (piu' in alto) e un piano suo (`emergenza`, sopra
        `overlay`): anche se domani nasce un altro pulsante flottante, il SOS
        resta sopra.
      */}
      <button
        ref={pulsanteRef}
        onClick={() => setOpen(true)}
        aria-label="SOS emergenza"
        className="fixed bottom-44 right-4 z-emergenza bg-rose-600 hover:bg-rose-700 text-white rounded-full w-14 h-14 shadow-warm-xl flex items-center justify-center ring-4 ring-rose-200 animate-pulse-slow"
      >
        <AlertTriangle size={22} strokeWidth={2.4} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          {/* 22/8/2026 — QUESTO NON ERA UN DIALOGO, ERA UN PEZZO DI PAGINA.
              Non si chiudeva con Esc, il fuoco non ci entrava e non ci restava,
              e nessuno diceva a un lettore di schermo che il resto della pagina
              era coperto. È il pannello che si apre quando un fattorino è in
              difficoltà per strada: il momento peggiore per doversi arrangiare.
              L'aggancio esisteva già, a un file di distanza. */}
          <div
            ref={pannelloRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sos-titolo"
            className="bg-white rounded-2xl w-full max-w-sm shadow-warm-lg"
          >
            <div className="bg-rose-600 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
              <h2 id="sos-titolo" className="font-bold flex items-center gap-2">
                <AlertTriangle size={20} strokeWidth={2.4} /> Emergenza SOS
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Chiudi"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-ink-800">
                Stai per attivare il <strong>SOS di emergenza</strong>. Verranno fatte queste cose:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <Phone size={16} className="text-rose-600 mt-0.5 flex-shrink-0" strokeWidth={2.4} />
                  <span>Verrà avviata la chiamata al <strong>112 (numero unico emergenze)</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <MapPin size={16} className="text-rose-600 mt-0.5 flex-shrink-0" strokeWidth={2.4} />
                  <span>La tua posizione GPS verrà condivisa con MyCity</span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-rose-600 mt-0.5 flex-shrink-0" strokeWidth={2.4} />
                  <span>Gli amministratori MyCity ricevono subito un avviso nel pannello e, se hanno le notifiche attive, sul telefono, se il tuo telefono è connesso. Non aspettare loro: per l&apos;aiuto subito c&apos;è il 112</span>
                </li>
              </ul>
              <p className="text-xs text-ink-500">
                Usa solo in caso di pericolo reale. Falsi allarmi possono causare sospensione account.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-cream-200 flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-3 rounded-lg border border-cream-300 text-ink-700 font-semibold"
              >
                Annulla
              </button>
              <button
                onClick={triggerSOS}
                disabled={sending}
                className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-3 rounded-lg font-bold inline-flex items-center justify-center gap-1.5"
              >
                {sending ? 'Invio…' : (<><Phone size={16} strokeWidth={2.4} /> Conferma SOS</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
