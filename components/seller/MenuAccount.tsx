'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, ChevronsUpDown, ExternalLink, LogOut, Settings } from 'lucide-react';
import CambiaAccount from '@/components/account/CambiaAccount';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { CHIAVE_PREVENTIVO, leggiPreventivoAgenzia } from '@/components/seller/preventivo-agenzia';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { etichettaPiano, type TonoPiano } from '@/lib/agenzia/etichetta-piano';

/**
 * IL NEGOZIO E IL SUO PIANO, IN FONDO AL MENU — 24/11/2026 (lib/agenzia/etichetta-piano.ts).
 *
 * Nicola: «usa la tecnica di Claude». Su Claude il nome e il piano stanno in basso a sinistra,
 * sempre in vista; un clic apre il menu con le impostazioni. Qui è lo stesso: «Pane Quotidiano ·
 * Piano Business», e il menu porta all'abbonamento, al Profilo (che è la pagina delle impostazioni
 * del negozio), al marketplace e all'uscita. «Abbonamento» non è più una voce del gruppo Servizi.
 *
 * La lettura è la stessa del riquadro in dashboard e della pagina Abbonamento (`CHIAVE_PREVENTIVO`):
 * React Query la fa una volta sola per tutti e tre.
 */

/** Il piano del negozio, letto una volta: lo usano il menu, la barra in alto e il Profilo. */
export function usePianoDelNegozio() {
  const { data } = useQuery({ queryKey: CHIAVE_PREVENTIVO, queryFn: leggiPreventivoAgenzia, retry: false });
  return { attivo: data?.attivo ?? null, etichetta: etichettaPiano(data?.attivo, data != null) };
}

/** Il colore della riga del piano sul menu scuro. */
const COLORE_SU_SCURO: Record<TonoPiano, string> = {
  attivo: 'text-accent-300',
  da_sistemare: 'text-amber-300',
  nessuno: 'text-white/60',
  sconosciuto: 'text-white/60',
};

export default function MenuAccount({
  nome,
  iniziali,
  email,
  compatto,
  onEsci,
}: {
  nome: string;
  iniziali: string;
  email: string | null;
  compatto: boolean;
  onEsci: () => void;
}) {
  const pathname = usePathname() ?? '';
  const [aperto, setAperto] = useState(false);
  const contenitoreRef = useRef<HTMLDivElement>(null);
  const pannelloRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { etichetta } = usePianoDelNegozio();

  // Esc chiude, il fuoco entra nel menu e alla chiusura torna sul pulsante (regola della casa:
  // nessun pannello sovrapposto scritto a mano, vedi components/hooks/useBottomSheetA11y.ts).
  useBottomSheetA11y(aperto, pannelloRef, triggerRef, () => setAperto(false), { bloccaScorrimento: false });

  // Un clic fuori chiude il menu; cambiare pagina pure.
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: PointerEvent) => {
      if (!contenitoreRef.current?.contains(e.target as Node)) setAperto(false);
    };
    document.addEventListener('pointerdown', fuori);
    return () => document.removeEventListener('pointerdown', fuori);
  }, [aperto]);
  useEffect(() => { setAperto(false); }, [pathname]);

  const IconaPiano = etichetta.tono === 'da_sistemare' ? AlertTriangle : BadgeCheck;
  const titolo = `${nome} · ${etichetta.testo}${etichetta.avviso ? ` · ${etichetta.avviso}` : ''}`;
  const voce =
    'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-ink-800 hover:bg-cream-50';

  return (
    <div ref={contenitoreRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setAperto((a) => !a)}
        aria-haspopup="dialog"
        aria-expanded={aperto}
        aria-controls="menu-account-venditore"
        aria-label={`Il tuo account: ${titolo}`}
        title={titolo}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5 ${
          aperto ? 'bg-white/10' : ''
        } ${compatto ? 'lg:justify-center lg:px-1.5' : ''}`}
      >
        <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-700 text-sm font-bold text-white">
          {iniziali}
          {etichetta.tono === 'da_sistemare' && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 bg-amber-400" aria-hidden />
          )}
        </span>
        {!compatto && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-bold text-white">{nome}</span>
              <span className={`flex items-center gap-1 truncate text-xs font-semibold ${COLORE_SU_SCURO[etichetta.tono]}`}>
                {(etichetta.tono === 'attivo' || etichetta.tono === 'da_sistemare') && (
                  <IconaPiano size={12} strokeWidth={2.4} className="shrink-0" aria-hidden />
                )}
                <span className="truncate">{etichetta.testo}</span>
              </span>
            </span>
            <ChevronsUpDown size={16} className="shrink-0 text-white/50" aria-hidden />
          </>
        )}
      </button>

      {aperto && (
        <div
          ref={pannelloRef}
          id="menu-account-venditore"
          role="dialog"
          aria-label="Il tuo account"
          className="absolute bottom-full left-0 z-modal mb-2 w-[240px] overflow-hidden rounded-xl border border-cream-200 bg-surface-0 text-ink-900 shadow-warm-xl"
        >
          <div className="border-b border-cream-200 px-4 py-3">
            <p className="truncate text-sm font-bold">{nome}</p>
            {email && <p className="truncate text-xs text-ink-500">{email}</p>}
          </div>
          {/* R10-005 — Niente precarico: ogni precarico di /seller/… ripassa dal controllo d'accesso
              del middleware (getUser + profiles). La richiesta parte al clic, come nella barra. */}
          <Link href={PERCORSO_ABBONAMENTO} prefetch={false} className={voce}>
            <IconaPiano
              size={16}
              className={`shrink-0 ${etichetta.tono === 'da_sistemare' ? 'text-amber-600' : 'text-primary-700'}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block">{etichetta.voce}</span>
              {etichetta.tono !== 'sconosciuto' && (
                <span className={`block text-xs ${etichetta.tono === 'da_sistemare' ? 'font-semibold text-amber-700' : 'text-ink-500'}`}>
                  {etichetta.avviso ?? etichetta.testo}
                </span>
              )}
            </span>
          </Link>
          <Link href="/seller/profile" prefetch={false} className={voce}>
            <Settings size={16} className="shrink-0 text-ink-500" aria-hidden />
            Profilo e impostazioni
          </Link>
          {/* 25/11/2026 — Più account, senza uscire (Nicola). */}
          <div className="border-t border-cream-200">
            <CambiaAccount />
          </div>
          <div className="border-t border-cream-200">
            <Link href="/?shop=1" prefetch={false} className={voce}>
              <ExternalLink size={16} className="shrink-0 text-ink-500" aria-hidden />
              Vai al marketplace
            </Link>
            <button type="button" onClick={onEsci} className={voce}>
              <LogOut size={16} className="shrink-0 text-ink-500" aria-hidden />
              Esci
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
