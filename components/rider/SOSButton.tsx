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
 *   2. Conferma → 3 azioni parallele:
 *      a) chiamata 112 (tel:)
 *      b) insert in rider_sos_events con posizione GPS
 *      c) push notification a tutti gli admin
 */

type Props = {
  orderId?: string;
};

export default function SOSButton({ orderId }: Props) {
  const [open, setOpen] = useState(false);
  const pannelloRef = useRef<HTMLDivElement>(null);
  const pulsanteRef = useRef<HTMLButtonElement>(null);
  useBottomSheetA11y(open, pannelloRef, pulsanteRef, () => setOpen(false));
  const [sending, setSending] = useState(false);

  const triggerSOS = async () => {
    setSending(true);
    // 1. Posizione GPS (best effort, alta accuratezza)
    let lat: number | null = null, lng: number | null = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('No geo'));
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8_000, enableHighAccuracy: true });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch {}

    // 2. Scrivi su DB (rider_sos_events) → trigger notifica admin
    let alertSent = false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase.from('rider_sos_events').insert({
          rider_id: user.id,
          order_id: orderId ?? null,
          lat, lng,
          triggered_at: new Date().toISOString(),
        });
        if (error) throw error;
        alertSent = true;
      }
    } catch (e) {
      captureError(e, { context: 'SOSButton' });
    }

    // 3. APRE IL TASTIERINO COL 112 GIA' COMPOSTO — non chiama.
    //
    // `tel:` apre il compositore del telefono col numero scritto. La chiamata parte SOLO se
    // il fattorino preme il tasto verde. I due messaggi qui sotto dicevano «Stiamo chiamando
    // il 112» e «Chiamata al 112 in corso», tutti e due al presente, come se stesse gia'
    // squillando. Un fattorino che ha appena premuto SOS puo' restare ad aspettare una
    // chiamata che nessuno ha fatto partire, nel momento in cui conta di piu'.
    //
    // Venti righe piu' in basso il dialogo di conferma lo diceva gia' giusto: «Verra' avviata
    // la chiamata al 112». Il testo esatto era li' dentro, e questi due non l'avevano preso.
    window.location.href = 'tel:112';
    setSending(false);
    setOpen(false);
    if (alertSent) {
      toast.success('MyCity è stata avvisata. Ora premi CHIAMA sul telefono: il 112 è già composto.', {
        duration: 12_000,
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
        className="fixed bottom-44 right-4 z-emergenza bg-rose-600 hover:bg-rose-700 text-white rounded-full w-14 h-14 shadow-2xl flex items-center justify-center ring-4 ring-rose-200 animate-pulse-slow"
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
                  <span>Gli amministratori MyCity riceveranno un alert immediato</span>
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
