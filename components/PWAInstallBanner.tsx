'use client';

import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useLocalStorage } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { comeSiInstalla, eApple, type ComeSiInstalla } from '@/lib/installabile';

/**
 * PWA install banner — appare dopo 3 visite per buyer non-installati.
 *
 * Esperti consultati:
 * - Senior PM: "Install rate PWA: solo 2-5% senza banner, 8-15% con prompt.
 *   Aspetta 3 visite per non spammare al primo accesso."
 * - Mobile UX: "Bottom banner non bloccante, dismissable, mai più visualizzato
 *   se rifiutato."
 * - Content Designer: "Tono pragmatico: cosa guadagni a installare (icona home,
 *   accesso più veloce, notifiche)."
 */

const DISMISS_KEY = 'mc_pwa_install_dismissed';
const VISITS_KEY = 'mc_pwa_visits';
const MIN_VISITS = 3;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export default function PWAInstallBanner() {
  const [dismissed, setDismissed] = useLocalStorage<boolean>(DISMISS_KEY, false);
  const [visits, setVisits] = useLocalStorage<number>(VISITS_KEY, 0);
  const [modo, setModo] = useState<ComeSiInstalla>('niente');
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [apple, setApple] = useState(false);
  const [giaInstallata, setGiaInstallata] = useState(false);

  /**
   * 22/8/2026 — L'ASCOLTO SI APRIVA TROPPO TARDI, E COSÌ NON SI APRIVA MAI.
   *
   * Il browser emette `beforeinstallprompt` una volta sola, presto, subito dopo
   * il caricamento. Qui l'ascolto veniva registrato SOLO dalla terza visita in
   * poi — e alla terza visita, quando finalmente si registrava, l'evento era
   * già passato. Il banner non compariva mai: non alla prima visita per
   * scelta, e non alla terza per un errore di sequenza.
   *
   * Adesso l'ascolto si apre sempre, e l'evento si mette da parte. È il
   * momento di MOSTRARE il banner che dipende dal numero di visite, non il
   * momento di ascoltare.
   */
  /**
   * 24/8/2026 — SU iPHONE IL BANNER NON COMPARIVA MAI, E NON C'ERA NESSUN ALTRO MODO.
   *
   * Tutto qui dentro aspettava `beforeinstallprompt`, che Safari su iOS non emette: nessun evento,
   * nessun banner, e nessun ramo alternativo nel file. Chi compra dal telefono non aveva modo di
   * scoprire che l'app si può mettere in schermata Home — e per un marketplace di quartiere
   * l'icona in Home è la differenza fra tornare e non tornare.
   *
   * Su iOS un pulsante che installa NON è possibile: il sistema non lo permette. Quindi le
   * risposte sono tre e non due — pulsante, istruzioni, niente — e il perché sta in
   * lib/installabile.ts.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setApple(eApple(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    setGiaInstallata(window.matchMedia('(display-mode: standalone)').matches);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Il conteggio delle visite: una volta per montaggio, separato dall'ascolto.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (dismissed) return;
    setVisits(visits + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Una decisione sola, presa da una funzione pura che si può provare senza browser.
  useEffect(() => {
    setModo(
      comeSiInstalla({
        offertaDalBrowser: !!promptEvent,
        eApple: apple,
        giaInstallata,
        giaRifiutata: !!dismissed,
        visite: visits,
        visiteMinime: MIN_VISITS,
      }),
    );
  }, [promptEvent, apple, giaInstallata, dismissed, visits]);

  const dismiss = () => {
    setDismissed(true);
    setModo('niente');
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      dismiss();
    }
  };

  if (modo === 'niente') return null;

  return (
    <div className="fixed bottom-20 sm:bottom-4 left-4 right-4 sm:left-auto sm:max-w-sm z-30 bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-4 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center flex-shrink-0">
          <Download size={20} strokeWidth={2.2} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-ink-900 text-sm">Metti MyCity in schermata Home</p>
          <p className="text-xs text-ink-600 mt-0.5">
            Accesso veloce + notifiche ordini. Niente app store.
          </p>
          {modo === 'istruzioni' ? (
            // Su iPhone non esiste un pulsante che installa: si dicono i due gesti, e basta.
            <ol className="mt-2 space-y-1.5 text-xs text-ink-700">
              <li className="flex items-center gap-1.5">
                <Share size={14} className="shrink-0 text-primary-700" aria-hidden />
                Tocca <strong>Condividi</strong>, in fondo allo schermo
              </li>
              <li className="flex items-center gap-1.5">
                <SquarePlus size={14} className="shrink-0 text-primary-700" aria-hidden />
                Poi <strong>Aggiungi a Home</strong>
              </li>
            </ol>
          ) : null}
          <div className="flex gap-2 mt-3">
            {modo === 'pulsante' ? <Button onClick={install} size="sm">Installa</Button> : null}
            <button
              onClick={dismiss}
              className="text-ink-500 hover:text-ink-700 px-3 py-1.5 text-xs"
            >
              {modo === 'istruzioni' ? 'Ho capito' : 'Più tardi'}
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Chiudi"
          className="text-ink-400 hover:text-ink-700 p-1 -mt-1 -mr-1"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
