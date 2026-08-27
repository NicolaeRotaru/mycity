'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Headset } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useProfile } from './hooks/useProfile';
import { pulsanteAssistenzaVisibile, ruoloAssistenza } from '@/lib/assistenza/porta';

// 100 — L'import statico portava nel pacchetto iniziale il modale e con lui
// l'assistente prodotto (oltre seicento righe), per OGNI visitatore — compresi
// i compratori e gli anonimi, che questo pulsante non lo vedono mai. Caricarlo
// quando serve non cambia niente per chi lo usa e alleggerisce tutti gli altri.
const SupportChatModal = dynamic(() => import('./SupportChatModal'), { ssr: false });

/**
 * Pulsante "Assistenza" flottante. Disponibile a chi ha fatto l'accesso — compratori compresi.
 *
 * Qui c'era scritto che «per il buyer l'assistenza vive ora nella barra in basso (MobileTabBar)»:
 * non era vero. Quella scheda non è mai esistita — `isSupport` è disegnato nella barra e nessun
 * elenco di schede lo imposta — quindi chi comprava non aveva NESSUNA porta per scrivere.
 * Chi decide chi la vede è `lib/assistenza/porta.ts`, dove una prova può eseguirlo.
 */
export default function SupportChatButton() {
  const pathname = usePathname() ?? '';
  const { isAuthenticated, isSeller, isRider, isAdmin, isBuyer } = useProfile();
  const [open, setOpen] = useState(false);

  const chi = { isAuthenticated, isAdmin, isSeller, isRider, isBuyer };
  if (!pulsanteAssistenzaVisibile(chi, pathname)) return null;

  const role = ruoloAssistenza(chi);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Assistenza"
        className="fixed bottom-24 md:bottom-6 right-4 z-40 bg-primary-600 hover:bg-primary-700 text-white rounded-full w-14 h-14 shadow-warm-lg flex items-center justify-center ring-4 ring-primary-200/60 transition-colors"
      >
        <Headset size={22} strokeWidth={2.2} />
      </button>

      <SupportChatModal open={open} onClose={() => setOpen(false)} role={role} />
    </>
  );
}
