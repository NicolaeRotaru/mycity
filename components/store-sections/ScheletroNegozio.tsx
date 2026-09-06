import { SkeletonGrid } from '@/components/SkeletonCard';
import { ALTEZZA_COPERTINA, CONTENITORE_PAGINA_NEGOZIO } from './misure-vetrina';

/**
 * L'UNICA COSA CHE SI VEDE MENTRE IL NEGOZIO ARRIVA.
 *
 * Prima ce n'erano due, e diverse fra loro: il guscio del server disegnava una
 * banda e otto quadrati, poi il codice del browser buttava via tutto e metteva
 * un cerchietto che gira in mezzo a una pagina alta poche righe. Adesso ne
 * esiste una sola, e ha la forma di quello che sta arrivando: stesso
 * contenitore, copertina della stessa altezza, la griglia dei prodotti presa
 * dallo stesso posto della griglia vera.
 *
 * Non ha `'use client'` apposta: la usa il guscio del server durante il primo
 * viaggio e la usa la pagina nel browser se i dati non sono ancora arrivati.
 * Non ha stato e non ha eventi.
 *
 * 6/9/2026 — DUE PERSONE NON SI ACCORGEVANO PIU' CHE IL SITO STAVA LAVORANDO.
 *
 * ① Chi ascolta la pagina. Da quando le tre porte del negozio aspettano con
 *    questo scheletro invece che col cerchietto, qui dentro non c'e' piu'
 *    nessuna parola: solo riquadri grigi. Una regione `aria-live` senza testo
 *    non annuncia niente, e `aria-busy="true"` chiedeva all'ausilio di tacere
 *    fino a che non fosse tornato falso — cosa che non succedeva mai, perche'
 *    il componente viene sostituito dal negozio vero. Prima si sentiva
 *    «Caricamento…»; poi piu' niente. Adesso la regione ha un nome
 *    (`aria-label`), come lo scheletro della cassa, e non chiede piu' silenzio.
 * ② Chi ha chiesto meno animazioni. `animate-pulse` non e' nell'elenco che
 *    `app/globals.css` tiene vivo dentro `prefers-reduced-motion` (li' ci sono
 *    la rotellina dei pulsanti e `.skeleton`): con quell'impostazione il battito si
 *    fermava al primo giro e restavano rettangoli immobili, cioe' una pagina
 *    che sembra rotta. I riquadri usano ora lo stesso `.skeleton` del resto del
 *    sito, che sotto quell'impostazione rallenta invece di spegnersi.
 */
export default function ScheletroNegozio() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Sto aprendo il negozio"
      className={CONTENITORE_PAGINA_NEGOZIO}
    >
      {/* Briciole di pane */}
      <div className="h-4 w-56 max-w-full rounded skeleton" />

      {/* Menu del negozio */}
      <div className="flex gap-1.5">
        <div className="h-7 w-24 rounded-full skeleton" />
        <div className="h-7 w-20 rounded-full skeleton" />
        <div className="h-7 w-28 rounded-full skeleton" />
      </div>

      {/* La copertina: stessa cornice e stessa altezza di quella vera */}
      <div className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-warm">
        <div className="h-1.5 skeleton" />
        <div className={`${ALTEZZA_COPERTINA} w-full skeleton`} />
        <div className="space-y-2.5 px-6 py-5">
          <div className="h-4 w-2/3 rounded skeleton" />
          <div className="h-3 w-1/2 rounded skeleton" />
        </div>
      </div>

      {/* I prodotti del negozio */}
      <div className="h-6 w-48 max-w-full rounded skeleton" />
      <SkeletonGrid count={8} />
    </div>
  );
}
