// lib/products/avvisoDellaDettatura.ts
import { avvisoDopoIlPatch, type AvvisoDopoIlPatch, type EsitoPatchModulo } from '@/lib/products/aiPatch';

/**
 * 16/10/2026 — GLI ALLERGENI DETTATI A VOCE SPARIVANO SENZA UNA PAROLA.
 *
 * Il fornaio apre la Focaccia, che ha gia' gli allergeni «glutine», e detta:
 * «focaccia genovese, tre euro e cinquanta, allergeni glutine e sesamo». Il
 * modello segue la regola di tutte le strade dell'assistente — le dichiarazioni
 * di un alimento non le scrive lui — e nomina gli allergeni solo nella sua
 * risposta. Il pulsante della voce quella risposta la buttava via, e l'avviso
 * verde diceva soltanto «Compilato dalla tua descrizione». Il campo restava
 * «glutine», e il sesamo detto a voce non compariva da nessuna parte.
 *
 * Qui non si legge il dettato: si decide cosa mostrare dopo. Il negoziante vede
 * sempre cosa e' successo nella scheda, quello che ha detto e la risposta
 * dell'assistente; e se la categoria del prodotto ha dichiarazioni (allergeni,
 * ingredienti...), una frase fissa gli ricorda che quelle le scrive lui. Chi
 * mostra l'avviso lo tiene a video finche' il negoziante non lo chiude, e mette
 * la frase fissa PRIMA di tutto il resto.
 *
 * Le parole del modello si riportano come sue («L'assistente dice: …»), mai
 * come una conferma: un modello che scrive «Fatto! Ho aggiunto gli allergeni»
 * mentre nella scheda non sono entrati chiudeva l'avviso con quella frase,
 * presentata come «Risposta dell'assistente» sotto un riquadro verde.
 */

/**
 * Le due frasi della dettatura per «ho scritto» e «non c'era niente».
 *
 * «Non c'era niente» diceva «riprova con più dettagli». Ma chi detta solo gli
 * allergeni della focaccia riceve sempre una proposta vuota — le dichiarazioni
 * l'assistente non le scrive mai — e riprovare non serve: ogni tentativo e' una
 * chiamata al modello pagata, e il negoziante lo rifaceva due o tre volte
 * prima di capire. Adesso la frase dice solo cosa e' successo nella scheda.
 */
export const TESTI_DELLA_DETTATURA = {
  applicato: 'Compilato dalla tua descrizione — controlla e salva',
  niente: 'Nella scheda non ho scritto niente',
} as const;

/** Quanto testo si mostra al massimo: il dettato lo taglia gia' cosi' la rotta. */
const MAX_DETTATO = 2000;
const MAX_RISPOSTA = 1000;

export type AvvisoDellaDettatura = {
  tono: AvvisoDopoIlPatch['tono'];
  /** Cosa e' successo nella scheda (la stessa frase degli altri pulsanti). */
  esito: string;
  /** La frase fissa sulle dichiarazioni; null se la categoria non ne ha. */
  dichiarazioni: string | null;
  /** «Hai detto: «…»». */
  dettato: string;
  /** «L'assistente dice: «…»» — le sue parole, riportate come sue; null se non ha scritto niente. */
  risposta: string | null;
};

/**
 * La frase fissa, coi nomi dei campi che la scheda ha davvero: «Allergeni,
 * ingredienti e le altre dichiarazioni» per un alimento, «Vegano e scadenza»
 * per una crema. Null se la categoria non ha dichiarazioni.
 */
export function fraseSulleDichiarazioni(etichette: readonly string[]): string | null {
  // «Valori nutrizionali (per 100g)»: fra parentesi c'e' l'unita', non il nome.
  const nomi = etichette.map((e) => e.replace(/\s*\(.*?\)/g, '').trim()).filter(Boolean);
  if (nomi.length === 0) return null;
  const minuscolo = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const elenco =
    nomi.length === 1
      ? nomi[0]
      : nomi.length === 2
        ? `${nomi[0]} e ${minuscolo(nomi[1])}`
        : `${nomi[0]}, ${minuscolo(nomi[1])} e le altre dichiarazioni`;
  return `${elenco} non li scrive l'assistente: se li hai detti, scrivili tu nella scheda prima di salvare.`;
}

export function avvisoDopoLaDettatura(opts: {
  esito: Pick<EsitoPatchModulo, 'cambiati' | 'inSospeso' | 'dichiarazioniDellaCategoria'>;
  dettato: string;
  risposta: unknown;
}): AvvisoDellaDettatura {
  const { tono, testo } = avvisoDopoIlPatch(opts.esito, TESTI_DELLA_DETTATURA);
  const risposta = typeof opts.risposta === 'string' ? opts.risposta.trim().slice(0, MAX_RISPOSTA) : '';
  return {
    tono,
    esito: testo,
    dichiarazioni: fraseSulleDichiarazioni(opts.esito.dichiarazioniDellaCategoria),
    dettato: `Hai detto: «${opts.dettato.trim().slice(0, MAX_DETTATO)}»`,
    risposta: risposta ? `L'assistente dice: «${risposta}»` : null,
  };
}
