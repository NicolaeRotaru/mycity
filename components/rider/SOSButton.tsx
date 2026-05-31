'use client';

import { useState } from 'react';
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

    // 3. Avvia chiamata 112
    window.location.href = 'tel:112';
    setSending(false);
    setOpen(false);
    if (alertSent) {
      toast.success('SOS inviato. Stiamo chiamando il 112 e abbiamo allertato MyCity.');
    } else {
      // Fallback esplicito: il rider NON deve credere che l'alert sia partito.
      toast.error('Chiamata al 112 in corso. Se non parte, chiama subito il 112 dal telefono.', { duration: 10_000 });
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="SOS emergenza"
        className="fixed bottom-24 right-4 z-40 bg-rose-600 hover:bg-rose-700 text-white rounded-full w-14 h-14 shadow-2xl flex items-center justify-center ring-4 ring-rose-200 animate-pulse-slow"
      >
        <AlertTriangle size={22} strokeWidth={2.4} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-warm-lg">
            <div className="bg-rose-600 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2">
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
