'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Headset } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useProfile } from './hooks/useProfile';
import { pulsanteAssistenzaVisibile, ruoloAssistenza } from '@/lib/assistenza/porta';
import { fondoDiChiGalleggia, tutteLeCorsie } from '@/lib/ui/barra-in-fondo';

/**
 * Il respiro fra il pulsante tondo e l'ultima cosa che gli sta sotto. Vale 24px
 * come prima: cambia solo COSA c'e' sotto, che ora si conta invece di
 * indovinarlo.
 */
const RESPIRO = '1.5rem';

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
        // 3/9/2026 — QUESTO PULSANTE COPRIVA «AGGIUNGI AL CARRELLO».
        //
        // Stava a `bottom-24`: 96 pixel scritti a mano, pensati per scavalcare
        // la sola barra a schede. Sulla scheda prodotto, pero', sopra la barra
        // a schede ce n'e' un'altra — quella con il prezzo e «Aggiungi al
        // carrello» — e nessuno spostava il pulsante tondo. Misurato in un
        // browser a 390px su un compratore che ha fatto l'accesso: 2.491 pixel
        // quadrati di sovrapposizione, il 23% del pulsante d'acquisto, e
        // toccando a 3/4 e a 9/10 della sua larghezza — dove arriva il pollice
        // destro — rispondeva l'assistenza. Chi non ha fatto l'accesso il
        // pulsante tondo non lo vede: il difetto colpiva i clienti registrati,
        // cioe' quelli che ricomprano.
        //
        // Ora il pulsante sta sopra TUTTE le corsie in fondo allo schermo,
        // sommate da lib/ui/barra-in-fondo.ts. Non c'e' piu' un numero da
        // indovinare, e la barra che qualcuno aggiungera' domani lo sposta da
        // sola. Sul computer le corsie valgono zero e restano i 24 pixel di
        // prima (era `md:bottom-6`); sul telefono, dove una barra non dichiara
        // ancora la sua corsia (la cassa, il fattorino), tiene il pavimento —
        // cioe' i 96 pixel che aveva gia'.
        style={{ bottom: fondoDiChiGalleggia(tutteLeCorsie(), RESPIRO) }}
        className="fixed right-4 z-overlay bg-primary-600 hover:bg-primary-700 text-white rounded-full w-14 h-14 shadow-warm-lg flex items-center justify-center ring-4 ring-primary-200/60 transition-colors"
      >
        <Headset size={22} strokeWidth={2.2} />
      </button>

      <SupportChatModal open={open} onClose={() => setOpen(false)} role={role} />
    </>
  );
}
