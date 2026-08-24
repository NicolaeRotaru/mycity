/**
 * Cosa può promettere una scheda prodotto sulla consegna — e cosa non può promettere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Sulla scheda prodotto c'è un conto alla rovescia: «Ordina entro 02:14:31 e **arriva oggi** in
 * 30-60 min». Compariva ogni volta che il prodotto era disponibile e il negozio offriva la consegna
 * veloce. Nessuno guardava **se il negozio era aperto**.
 *
 * Quindi: negozio chiuso di mattina — giorno di chiusura, prima dell'apertura, domenica — e la
 * scheda del prodotto scrive «arriva oggi in 30-60 min», mentre la pagina di quello stesso negozio,
 * due clic più in là, dice «Chiuso ora». Il percorso prosegue: carrello, indirizzo, pagamento.
 * **Il muro arriva alla fine**, dal server, al clic di conferma: «Il negozio è chiuso in questo
 * momento» (`isStoreClosedForOrder`, che il checkout non chiama mai).
 *
 * Un muro all'ultimo passo è la forma più cara di «no»: la persona ha già scelto, già scritto
 * l'indirizzo, già deciso come pagare.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERCHÉ LE RISPOSTE SONO TRE E NON DUE
 * ─────────────────────────────────────────────────────────────────────────────
 * Il componente ne aveva due: consegna veloce, oppure «Consegna in 2-3 giorni». Mettere il negozio
 * chiuso nella seconda sarebbe stato sbagliato di un'altra maniera — un negozio chiuso stamattina
 * non è un prodotto che ci mette due giorni, riapre alle 16. Dire «2-3 giorni» a chi potrebbe
 * comprare fra due ore è una bugia che costa un ordine invece di salvarlo.
 *
 *   · `express`  → il negozio è aperto e il prodotto è pronto: si può promettere oggi.
 *   · `standard` → il prodotto non è pronto o il negozio non fa la consegna veloce.
 *   · `chiuso`   → il negozio adesso è chiuso. Si dice quello, e **quando riapre**.
 *
 * E dentro `chiuso` c'è una quarta risposta, che è la solita: `riapre` può essere `null`. Se gli
 * orari non bastano a dire quando riapre, non si inventa un'ora — si dice che è chiuso e basta.
 *
 * Prova: tests/unit/il-conto-alla-rovescia-col-negozio-chiuso.test.ts
 */
import { DAY_KEYS, isOpenNow, romeNow, type HoursInterval, type StoreHours } from '@/lib/store-hours';

export type PromessaConsegna =
  | { tipo: 'express' }
  | { tipo: 'standard' }
  | { tipo: 'chiuso'; riapre: string | null };

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

function inMinuti(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fasceDelGiorno(orari: StoreHours, indice: number): HoursInterval[] {
  const v = orari[DAY_KEYS[indice]];
  return Array.isArray(v) ? (v as HoursInterval[]) : [];
}

/** Il negozio ha degli orari scritti da qualche parte? Senza, non si può dire niente sugli orari. */
export function haOrari(orari: unknown): orari is StoreHours {
  if (!orari || typeof orari !== 'object') return false;
  const o = orari as StoreHours;
  return DAY_KEYS.some((k) => Array.isArray(o[k]) && (o[k] as HoursInterval[]).length > 0);
}

/**
 * Quando riapre, detto come lo direbbe una persona — o `null` se non si può sapere.
 *
 * Guarda il resto di oggi, poi i sei giorni dopo. Oltre non va: un negozio che non apre per una
 * settimana intera non ha un «riapre», ha un problema, e inventargli una data non aiuta nessuno.
 */
export function quandoRiapre(orari: unknown, adesso: Date = romeNow()): string | null {
  if (!haOrari(orari)) return null;
  const o = orari as StoreHours;
  const oggi = adesso.getDay();
  const minutiAdesso = adesso.getHours() * 60 + adesso.getMinutes();

  const piuTardiOggi = fasceDelGiorno(o, oggi)
    .map(([apre]) => apre)
    .filter((apre) => inMinuti(apre) > minutiAdesso)
    .sort((a, b) => inMinuti(a) - inMinuti(b))[0];
  if (piuTardiOggi) return `alle ${piuTardiOggi}`;

  for (let avanti = 1; avanti <= 6; avanti++) {
    const indice = (oggi + avanti) % 7;
    const prima = fasceDelGiorno(o, indice)
      .map(([apre]) => apre)
      .sort((a, b) => inMinuti(a) - inMinuti(b))[0];
    if (!prima) continue;
    return avanti === 1 ? `domani alle ${prima}` : `${GIORNI[indice]} alle ${prima}`;
  }
  return null;
}

/**
 * La promessa che questa scheda può fare adesso.
 *
 * ⚠️ L'ORDINE DELLE DOMANDE CONTA, e «il negozio è chiuso?» viene prima di tutto. Un negozio chiuso
 * non può consegnare in mezz'ora nemmeno se il prodotto è pronto e la consegna veloce è attiva:
 * è la condizione che vince su tutte, ed è esattamente quella che mancava.
 *
 * Un negozio **senza orari scritti** non è un negozio chiuso: è un negozio di cui non sappiamo gli
 * orari. Lì si torna a com'era prima — e non è una svista, è la stessa scelta che fa il server, che
 * senza orari lascia passare l'ordine.
 */
export function promessaDiConsegna(s: {
  idoneoExpress: boolean;
  disponibile: boolean;
  orari?: unknown;
  adesso?: Date;
}): PromessaConsegna {
  const adesso = s.adesso ?? romeNow();
  if (haOrari(s.orari)) {
    const o = s.orari as StoreHours;
    if (!isOpenNow(fasceDelGiorno(o, adesso.getDay()), adesso)) {
      return { tipo: 'chiuso', riapre: quandoRiapre(o, adesso) };
    }
  }
  if (s.disponibile && s.idoneoExpress) return { tipo: 'express' };
  return { tipo: 'standard' };
}

/** La riga da mostrare quando il negozio è chiuso. Senza orario non se ne inventa uno. */
export function rigaNegozioChiuso(riapre: string | null): string {
  return riapre ? `Il negozio è chiuso ora, riapre ${riapre}` : 'Il negozio è chiuso ora';
}
