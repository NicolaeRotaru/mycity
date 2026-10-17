/**
 * Dividere fra i negozi un rimborso fatto dal cruscotto Stripe su un carrello
 * di più negozi: le regole, senza toccare niente.
 *
 * 16/10/2026 — I BONIFICI FERMATI NON SI POTEVANO SBLOCCARE DAL PANNELLO.
 *
 * Su un pagamento di più negozi Stripe non dice a quale ordine appartiene un
 * rimborso fatto dal cruscotto: il webhook ferma i bonifici del carrello e
 * chiede a chi amministra di dividerlo. Ma nessuna pagina e nessuna rotta del
 * sito sapeva farlo: i due negozi restavano senza bonifico finché qualcuno non
 * scriveva a mano nel database tre campi per ordine. Un caso: carrello da Pane
 * Quotidiano e da un fioraio, Nicola rimborsa 3 € dal cruscotto, e tutti e due
 * i bonifici si fermano.
 *
 * Adesso si divide dal pannello (Ordini → «Rimborsi dal cruscotto da
 * dividere»). Qui sta il controllo di quello che chi amministra ha scritto:
 * ogni ordine fermo ha la sua parte (anche zero), nessuna parte supera quello
 * che resta da rimborsare su quell'ordine, e la somma è esattamente il
 * rimborso da dividere — né un centesimo in più, né uno in meno.
 *
 * 16/10/2026 (riesame del lotto) — LA PARTE SI PUÒ DARE ANCHE A UN ORDINE NON
 * FERMO. Il webhook ferma solo gli ordini pagabili: uno con un reclamo aperto,
 * o uno a cui la chiusura di un reclamo aveva tolto la pausa, restava fuori, e
 * i soldi da dividere si potevano dare solo agli altri. Un caso: carrello da
 * Pane Quotidiano e da un fioraio, 3 € di fiori resi dal cruscotto mentre sui
 * fiori c'è un reclamo; l'unica divisione accettata era «3 € al pane», e a
 * Pane Quotidiano si toglievano 2 € di quota per fiori che non aveva venduto.
 * Adesso fra gli ordini del pagamento c'è anche chi non è fermo ma ha ancora
 * qualcosa da rimborsare: la sua parte si può scrivere, e se non si scrive vale zero.
 */
import { formatPriceFromCents } from '@/lib/format';

/** Un ordine del carrello a cui si può dare una parte, per il poco che serve al controllo. */
export type OrdineDaDividere = {
  id: string;
  /** Il lordo pagato per questo ordine. */
  lordoCents: number;
  /** Quanto risulta già rimborsato su questo ordine. */
  giaRimborsatoCents: number;
  /**
   * Il suo bonifico è fermo per questo rimborso: la sua parte va scritta,
   * anche zero, perché è la divisione a riaprirlo. Senza il campo vale «fermo».
   */
  fermo?: boolean;
};

/** La parte del rimborso che chi amministra assegna a un ordine. */
export type ParteDelRimborso = { ordine: string; centesimi: number };

export type EsitoDellaDivisione =
  | { ok: true; parti: Map<string, number> }
  | { ok: false; errore: string };

// La casa dei formati (lib/format.ts): «3,00 €», come nel resto del pannello.
const euro = formatPriceFromCents;

const breve = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

export function controllaLaDivisione(
  ordini: ReadonlyArray<OrdineDaDividere>,
  parti: ReadonlyArray<ParteDelRimborso>,
  daDividereCents: number,
): EsitoDellaDivisione {
  const perOrdine = new Map(ordini.map((o) => [o.id, o]));
  const scelte = new Map<string, number>();
  for (const parte of parti) {
    const ordine = perOrdine.get(parte.ordine);
    if (!ordine) return { ok: false, errore: `L'ordine ${breve(parte.ordine)} non è fra gli ordini di questo pagamento a cui si può dare una parte.` };
    if (scelte.has(parte.ordine)) return { ok: false, errore: `L'ordine ${breve(parte.ordine)} ha due parti: ne serve una sola.` };
    if (!Number.isInteger(parte.centesimi) || parte.centesimi < 0) {
      return { ok: false, errore: `La parte dell'ordine ${breve(parte.ordine)} non è una cifra valida.` };
    }
    const resta = Math.max(0, ordine.lordoCents - ordine.giaRimborsatoCents);
    if (parte.centesimi > resta) {
      return {
        ok: false,
        errore: `All'ordine ${breve(parte.ordine)} restano da rimborsare ${euro(resta)}: la sua parte non può essere ${euro(parte.centesimi)}.`,
      };
    }
    scelte.set(parte.ordine, parte.centesimi);
  }
  // Solo chi è fermo deve avere la sua parte scritta: per gli altri vale zero.
  const senzaParte = ordini.filter((o) => o.fermo !== false && !scelte.has(o.id));
  if (senzaParte.length > 0) {
    return {
      ok: false,
      errore: `Manca la parte dell'ordine ${senzaParte.map((o) => breve(o.id)).join(', ')}: scrivi 0 se il rimborso non è suo.`,
    };
  }
  const somma = [...scelte.values()].reduce((a, b) => a + b, 0);
  if (somma !== daDividereCents) {
    return { ok: false, errore: `Le parti fanno ${euro(somma)}, ma il rimborso da dividere è ${euro(daDividereCents)}.` };
  }
  return { ok: true, parti: scelte };
}

/**
 * Una cifra in euro scritta da una persona («3», «3,5», «3,50», «3.50») in
 * centesimi. Vuoto vale zero. `null` se non è una cifra.
 */
export function centesimiDaEuro(testo: string): number | null {
  const pulito = testo.trim().replace(/\s|€/g, '');
  if (pulito === '') return 0;
  if (!/^\d+([.,]\d{1,2})?$/.test(pulito)) return null;
  const [interi, decimali = ''] = pulito.split(/[.,]/);
  return Number(interi) * 100 + Number(decimali.padEnd(2, '0'));
}

/** Cosa mostra il riquadro del pannello: niente, solo l'errore, o i carrelli (con l'errore sopra, se c'è). */
export type VistaDelRiquadro = 'niente' | 'solo-errore' | 'carrelli';

/**
 * 16/10/2026 (terzo riesame del lotto) — UNA RICARICA FALLITA NON CANCELLA LE CIFRE SCRITTE.
 *
 * Il riquadro si ricarica da solo ogni due minuti. Se una ricarica falliva, al
 * posto dei carrelli compariva solo il messaggio d'errore: i carrelli
 * sparivano e con loro le cifre che chi amministra stava scrivendo (stanno
 * dentro ogni carrello). Alla ricarica riuscita i campi tornavano vuoti.
 *
 * Adesso il solo errore compare quando non c'è un elenco da mostrare. Se
 * l'elenco letto prima c'è, i carrelli restano dove sono e l'errore si legge
 * sopra di loro: il server ricontrolla comunque la divisione sui numeri nuovi.
 */
export function vistaDelRiquadro(
  conErrore: boolean,
  elenco: { carrelli?: ReadonlyArray<unknown>; nonLetti?: ReadonlyArray<unknown> } | null | undefined,
): VistaDelRiquadro {
  const qualcosaDaMostrare = (elenco?.carrelli?.length ?? 0) > 0 || (elenco?.nonLetti?.length ?? 0) > 0;
  if (qualcosaDaMostrare) return 'carrelli';
  return conErrore ? 'solo-errore' : 'niente';
}
