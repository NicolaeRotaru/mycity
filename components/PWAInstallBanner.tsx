'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useLocalStorage } from '@/lib/hooks';

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
  const [show, setShow] = useState(false);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Already installed? hide
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (dismissed) return;

    const nextVisits = visits + 1;
    setVisits(nextVisits);
    if (nextVisits < MIN_VISITS) return;

    // Listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    setDismissed(true);
    setShow(false);
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      dismiss();
    }
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-20 sm:bottom-4 left-4 right-4 sm:left-auto sm:max-w-sm z-30 bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-4 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center flex-shrink-0">
          <Download size={20} strokeWidth={2.2} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-ink-900 text-sm">Installa MyCity</p>
          <p className="text-xs text-ink-600 mt-0.5">
            Accesso veloce + notifiche ordini. Niente app store.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={install}
              className="bg-primary-700 hover:bg-primary-800 text-white px-3 py-1.5 rounded-lg font-bold text-xs"
            >
              Installa
            </button>
            <button
              onClick={dismiss}
              className="text-ink-500 hover:text-ink-700 px-3 py-1.5 text-xs"
            >
              Più tardi
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
