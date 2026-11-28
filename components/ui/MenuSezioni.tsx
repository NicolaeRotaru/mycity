'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, LayoutGrid, Lock, X, type LucideIcon } from 'lucide-react';
import { useCloseOnBack } from '@/components/hooks/useCloseOnBack';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';

/**
 * IL MENU DELLE SEZIONI SUL TELEFONO — 28/11/2026.
 *
 * Nicola, dal telefono, alle 15:45, sulla pagina Profilo: le voci «Profilo, Ordini, Resi, Indirizzi…»
 * stavano in una riga di pillole che scorreva di lato, e se ne vedevano tre e mezza; «mettile in forma
 * di menu… molto più bella, perché l'estetica in questo modo qua è veramente molto brutta». La stessa
 * riga c'era nel pannello demo del preventivo (components/preventivo/DemoShell.tsx).
 *
 * Ora in cima c'è un riquadro solo, che dice dove sei («Il tuo account · Profilo») e porta il pulsante
 * «Menu». Al tocco sale dal basso un pannello con tutte le voci, divise in gruppi come nella barra
 * laterale del computer: ogni gruppo è una scheda bianca, ogni voce ha la sua icona, il numero dei da
 * leggere e la freccia. La voce dove sei è accesa. Le voci che non si possono ancora aprire (la demo)
 * si vedono col lucchetto.
 *
 * Il pannello segue le regole della casa per gli overlay: `useBottomSheetA11y` (Esc, fuoco dentro e
 * ritorno al pulsante) e `useCloseOnBack` (il tasto Indietro del telefono chiude solo il pannello),
 * con la stessa navigazione di MobileAccountSheet, che è già collaudata.
 *
 * Armonia (skill di ad-mycity): spazi di Fibonacci (f1-f3); i passaggi di colore e d'ombra del riquadro e
 * delle voci durano 222 ms (2 × 111) sulla curva aurea. L'apertura del pannello usa invece `animate-slide-up`
 * della casa (260 ms), la stessa degli altri pannelli dal basso. Niente trama: è un menu, si legge e basta.
 */

export type VoceDelMenu = {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Quanti da leggere: 0 o niente, nessun numero. */
  conto?: number;
  /** Se c'è, la voce si vede ma non si apre: è il perché, per chi non vede il lucchetto. */
  chiusa?: string;
};
export type GruppoDelMenu = { titolo: string; voci: VoceDelMenu[] };

const NUMERO = 'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-secondary-600 px-1.5 text-[11px] font-bold leading-none text-white';

function numero(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export default function MenuSezioni({
  etichetta,
  sopratitolo,
  gruppi,
  attiva,
  testa,
  piede,
  className = '',
}: {
  /** Il nome del menu per chi non vede: «Menu account». */
  etichetta: string;
  /** La riga piccola sopra la sezione: «Il tuo account». */
  sopratitolo: string;
  gruppi: GruppoDelMenu[];
  /** Vero se la voce con quell'indirizzo è la pagina dove sei. */
  attiva: (href: string) => boolean;
  /** In cima al pannello: chi sei (foto e nome). Senza, il sopratitolo. */
  testa?: ReactNode;
  /** In fondo al pannello, dopo i gruppi (per esempio «Esci»). Riceve la funzione che chiude il pannello. */
  piede?: (chiudi: () => void) => ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const pulsanteRef = useRef<HTMLButtonElement>(null);
  const pannelloRef = useRef<HTMLDivElement>(null);
  const idPannello = useId();
  const chiudi = () => setAperto(false);
  const navigazioneRef = useCloseOnBack(aperto, chiudi);
  useBottomSheetA11y(aperto, pannelloRef, pulsanteRef, chiudi);

  const voci = gruppi.flatMap((g) => g.voci);
  // Fra le voci accese vince la più precisa (l'indirizzo più lungo): /seller/products non resta accesa
  // su /seller/products/new, se quella ha la sua voce.
  const hrefAttivo = voci.reduce<string | null>(
    (meglio, v) => (!v.chiusa && attiva(v.href) && (!meglio || v.href.length > meglio.length) ? v.href : meglio),
    null,
  );
  const attuale = voci.find((v) => v.href === hrefAttivo) ?? null;
  const IconaAttuale = attuale?.icon ?? LayoutGrid;
  const daLeggere = voci.reduce((somma, v) => somma + (v.conto && v.conto > 0 ? v.conto : 0), 0);

  // Chi naviga lo dice prima, così la chiusura non torna indietro nella cronologia (annullerebbe il link
  // appena premuto). Ctrl/cmd-clic apre in un'altra scheda, come sempre.
  // 28/11/2026 (collaudo) — Con `router.push` la voce che `useCloseOnBack` aggiunge all'apertura restava
  // sotto la pagina nuova: da /about, tre voci scelte dal menu, e per tornare a /about servivano 7 Indietro
  // invece di 4 (un Indietro su due non faceva niente). `replace` mette la pagina nuova al posto di quella
  // voce: la cronologia resta quella che si avrebbe senza menu.
  const vai = (e: React.MouseEvent, href: string, eQui: boolean) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (eQui) { chiudi(); return; }
    navigazioneRef.current = true;
    chiudi();
    router.replace(href);
  };

  return (
    <div className={className}>
      <button
        ref={pulsanteRef}
        type="button"
        onClick={() => setAperto(true)}
        aria-haspopup="dialog"
        aria-expanded={aperto}
        aria-controls={aperto ? idPannello : undefined}
        className="group flex w-full items-center gap-f2 rounded-2xl border border-cream-300 bg-surface-0 p-f2 text-left shadow-warm-sm transition-[border-color,box-shadow] duration-[222ms] ease-armonia hover:border-primary-200 hover:shadow-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
      >
        <span
          aria-hidden
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-50 to-primary-100 text-primary-700 ring-1 ring-primary-100"
        >
          <IconaAttuale size={20} strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-2xs font-bold uppercase tracking-label text-ink-400">{sopratitolo}</span>
          <span className="block truncate font-serif text-[17px] font-bold leading-tight text-ink-900">
            {attuale?.label ?? 'Scegli una sezione'}
          </span>
        </span>
        <span className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cream-100 px-3 py-1.5 text-[13px] font-semibold text-ink-700 transition-colors duration-[222ms] ease-armonia group-hover:bg-primary-50 group-hover:text-primary-800">
          <LayoutGrid size={15} strokeWidth={2.2} aria-hidden />
          Menu
          {daLeggere > 0 && (
            <span aria-hidden className={`absolute -right-1.5 -top-1.5 ${NUMERO}`}>{numero(daLeggere)}</span>
          )}
        </span>
        {daLeggere > 0 && <span className="sr-only">, {numero(daLeggere)} da leggere</span>}
      </button>

      {aperto && (
        <div id={idPannello} role="dialog" aria-modal="true" aria-label={etichetta} className="fixed inset-0 z-modal">
          <div aria-hidden onClick={chiudi} className="absolute inset-0 bg-ink-900/40 motion-safe:animate-fade-in" />
          <div
            ref={pannelloRef}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-cream-50 pb-safe shadow-warm-xl motion-safe:animate-slide-up"
          >
            <div className="sticky top-0 z-10 bg-cream-50/95 px-f3 pb-f2 pt-f1 backdrop-blur">
              <span aria-hidden className="mx-auto mb-f2 block h-1 w-10 rounded-full bg-cream-300" />
              <div className="flex items-center gap-f2">
                <div className="min-w-0 flex-1">
                  {testa ?? <p className="font-serif text-lg font-bold text-ink-900">{sopratitolo}</p>}
                </div>
                <button
                  type="button"
                  onClick={chiudi}
                  aria-label="Chiudi il menu"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-0 text-ink-500 ring-1 ring-cream-200 transition-colors hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>
            </div>

            <nav aria-label={etichetta} className="flex flex-col gap-f3 px-f3 pb-f3 pt-f1">
              {gruppi.map((g) => (
                <div key={g.titolo}>
                  <p className="mb-f1 px-1 text-2xs font-bold uppercase tracking-label text-ink-400">{g.titolo}</p>
                  <ul className="divide-y divide-cream-100 overflow-hidden rounded-2xl bg-surface-0 shadow-warm-sm ring-1 ring-cream-200">
                    {g.voci.map((v) => {
                      const eQui = v.href === hrefAttivo;
                      const Icona = v.icon;
                      const conto = v.conto && v.conto > 0 ? v.conto : 0;
                      const dentro = (
                        <>
                          <span
                            aria-hidden
                            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              eQui ? 'bg-primary-600 text-white' : 'bg-cream-100 text-ink-600'
                            }`}
                          >
                            <Icona size={18} strokeWidth={2.2} />
                          </span>
                          <span className={`min-w-0 flex-1 truncate text-[15px] ${eQui ? 'font-bold text-primary-800' : 'font-medium text-ink-800'}`}>
                            {v.label}
                          </span>
                          {conto > 0 && <span aria-hidden className={NUMERO}>{numero(conto)}</span>}
                          {v.chiusa
                            ? <Lock size={14} className="shrink-0 text-ink-300" aria-hidden />
                            : <ChevronRight size={16} className={`shrink-0 ${eQui ? 'text-primary-600' : 'text-ink-300'}`} aria-hidden />}
                        </>
                      );
                      return (
                        <li key={v.href + v.label}>
                          {v.chiusa ? (
                            <span className="flex cursor-not-allowed items-center gap-f2 px-f2 py-[11px] opacity-60" title={v.chiusa}>
                              {dentro}
                              <span className="sr-only">: {v.chiusa}</span>
                            </span>
                          ) : (
                            <Link
                              href={v.href}
                              aria-current={eQui ? 'page' : undefined}
                              onClick={(e) => vai(e, v.href, eQui)}
                              className={`flex items-center gap-f2 px-f2 py-[11px] transition-colors duration-[222ms] ease-armonia focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-700 ${
                                eQui ? 'bg-primary-50' : 'hover:bg-cream-50 active:bg-cream-100'
                              }`}
                            >
                              {dentro}
                              {conto > 0 && <span className="sr-only">, {numero(conto)} da leggere</span>}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {piede?.(chiudi)}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
