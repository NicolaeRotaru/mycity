'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Headset } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useProfile } from './hooks/useProfile';

// 100 — L'import statico portava nel pacchetto iniziale il modale e con lui
// l'assistente prodotto (oltre seicento righe), per OGNI visitatore — compresi
// i compratori e gli anonimi, che questo pulsante non lo vedono mai. Caricarlo
// quando serve non cambia niente per chi lo usa e alleggerisce tutti gli altri.
const SupportChatModal = dynamic(() => import('./SupportChatModal'), { ssr: false });

/**
 * Pulsante "Assistenza" flottante. Disponibile a seller e rider loggati.
 * Per il buyer l'assistenza vive ora nella barra in basso (MobileTabBar), e per
 * l'admin non è prevista: in entrambi i casi il pulsante flottante è nascosto.
 * Apre lo stesso SupportChatModal usato dalla barra.
 */
export default function SupportChatButton() {
  const pathname = usePathname() ?? '';
  const { isAuthenticated, isSeller, isRider, isAdmin, isBuyer } = useProfile();
  const [open, setOpen] = useState(false);

  // Niente pulsante in auth flow, dentro un thread chat, per admin/buyer.
  const hidden =
    !isAuthenticated ||
    isAdmin ||
    isBuyer ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/') ||
    /^\/messages\/[^/]+/.test(pathname);
  if (hidden) return null;

  const role = isSeller ? 'seller' : isRider ? 'rider' : 'buyer';

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
