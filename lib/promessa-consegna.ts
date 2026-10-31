/**
 * Cosa può promettere una scheda prodotto sulla consegna — e cosa non può promettere.
 *
 * 29/10/2026 — LE FRASI DI QUANDO ARRIVA LA SPESA (regola di Nicola, registro dei fatti
 * `consegna.promessa`): la consegna normale arriva nella fascia oraria che il cliente sceglie in
 * cassa; la veloce arriva in mezz'ora-un'ora dalla conferma del negozio, e si può solo dalle 8 alle
 * 21, a negozi aperti, con un fattorino in servizio (`veloceSiPuo`, lib/ordini/consegna-veloce.ts).
 * Le frasi sotto sono la casa unica di queste parole per testata, piede, contatti del negozio,
 * scheda prodotto e pagina Spedizioni: nessuna frase fissa promette i minuti come cosa certa.
 * Prova: tests/unit/la-consegna-si-promette-all-ora-che-scegli.test.tsx
 *
 * 30/10/2026 (ondata 18) — Le tre condizioni della veloce erano riscritte a mano in altri cinque
 * posti, e tre ne dicevano una sola («con un fattorino in servizio»): la descrizione Google dei
 * negozi (`fraseComeArriva`), il piede del sito e «Come funziona» (`CONSEGNA_FRASE_INTERA`), le
 * promesse della home (`VALUE_PROPS`); la spiegazione del carrello scriveva l'ora a mano. Adesso
 * tutti prendono `QUANDO_SI_PUO_LA_VELOCE`, e la spiegazione del carrello `ORE_DELLA_VELOCE`.
 * Prova: tests/unit/le-condizioni-della-veloce-hanno-una-casa-sola.test.tsx
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Sulla scheda prodotto c'è un conto alla rovescia: «Ordina entro 02:14:31 e **arriva oggi**» coi
 * minuti della veloce. Compariva ogni volta che il prodotto era disponibile e il negozio offriva la consegna
 * veloce. Nessuno guardava **se il negozio era aperto**.
 *
 * Quindi: negozio chiuso di mattina — giorno di chiusura, prima dell'apertura, domenica — e la
 * scheda del prodotto scrive «arriva oggi», mentre la pagina di quello stesso negozio,
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
import { EXPRESS_ETA_MAX, EXPRESS_ETA_MIN } from '@/lib/delivery';
import {
  APERTURA_EXPRESS,
  CHIUSURA_EXPRESS,
  expressSiPuo,
  fasceAncoraPossibili,
  fasceDiDomaniPossibili,
} from '@/lib/quando-arriva';

/** La consegna normale: arriva nella fascia che il cliente sceglie in cassa. Frase corta. */
export const CONSEGNA_ALL_ORA_CHE_SCEGLI = "Consegna a casa, all'ora che scegli";
/** I minuti della veloce, detti per esteso. Si scrivono solo accanto alla sua condizione. */
export const VELOCE_IN_MINUTI = `veloce in ${EXPRESS_ETA_MIN}-${EXPRESS_ETA_MAX} minuti`;
/** Le ore della veloce («dalle 8 alle 21»), dalle costanti di lib/quando-arriva. */
export const ORE_DELLA_VELOCE = `dalle ${APERTURA_EXPRESS} alle ${CHIUSURA_EXPRESS}`;
/** Quando si può la veloce: le tre condizioni di `veloceSiPuo`, dette al cliente. */
export const QUANDO_SI_PUO_LA_VELOCE = `${ORE_DELLA_VELOCE}, a negozi aperti, con un fattorino in servizio`;
/** Quando la cassa ha appena detto che la veloce si può (risposta di /api/consegna/veloce). */
export const CONSEGNA_O_VELOCE_ADESSO = `Consegna a casa all'ora che scegli, oppure ${VELOCE_IN_MINUTI}`;
/**
 * La frase intera, dove c'è spazio e non si può chiedere al server: la veloce con le sue tre
 * condizioni. 30/10/2026 — Diceva solo «quando c'è un fattorino in servizio»: alle 15, col forno
 * chiuso dall'una e Nicola in servizio, la veloce non c'è.
 */
export const CONSEGNA_FRASE_INTERA = `${CONSEGNA_O_VELOCE_ADESSO}, ${QUANDO_SI_PUO_LA_VELOCE}`;

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

/**
 * 29/10/2026 — LA RIGA DELLA CONSEGNA SULLA SCHEDA PRODOTTO, CON LE REGOLE DELLA CASSA.
 *
 * Prima la scheda contava fino alle 18 per ogni negozio («Ordina entro 05:30:00 e arriva oggi» al
 * forno che chiude alle 13), prometteva «domani» la sera del sabato a un negozio chiuso la domenica,
 * e sui prodotti esauriti o senza l'interruttore Express scriveva «Consegna in 2-3 giorni»: una
 * consegna che la cassa non ha. La cassa offre la fascia oraria che sceglie il cliente, e la veloce
 * solo quando `veloceSiPuo` dice sì. Qui la scheda dice la stessa cosa:
 *   · esaurito → nessun tempo di consegna (`null`);
 *   · importato da un altro marketplace → il suo tempo;
 *   · negozio chiuso adesso → quando riapre, e che l'ora si sceglie in cassa se la cassa ne ha una;
 *   · la cassa senza fasce né oggi né domani → che le consegne di oggi sono finite, e quando riapre;
 *   · altrimenti → all'ora che scegli, e la veloce solo se la cassa ha risposto sì.
 * Niente conto alla rovescia: la scheda non si fa un calendario suo. `adesso: null` vuol dire «prima
 * dell'idratazione»: senza orologio non si giudica l'apertura e non si promette niente di più.
 */
export function rigaConsegnaDellaScheda(s: {
  esaurito: boolean;
  orari?: unknown;
  adesso: Date | null;
  /** Risposta di /api/consegna/veloce: `true` solo con `possibile: true`; `null` se manca o è caduta. */
  veloce: boolean | null;
  consegnaEsterna?: string | null;
}): string | null {
  if (s.esaurito) return null;
  if (s.consegnaEsterna) return `Consegna in ${s.consegnaEsterna}`;
  if (s.adesso) {
    const p = promessaDiConsegna({ idoneoExpress: true, disponibile: true, orari: s.orari, adesso: s.adesso });
    // 31/10/2026 (ondata 3) — La cassa propone solo le fasce di oggi e di domani. Sabato alle 21:30,
    // forno lun-sab 08-13, non ne ha nessuna (oggi finito, domenica chiuso), e la scheda diceva
    // «riapre lunedì alle 08:00: in cassa scegli l'ora». Lo stesso alle 12:59, a forno ancora
    // aperto: «all'ora che scegli» e una cassa vuota. L'ora in cassa si promette solo se c'è.
    const cassaSenzaFasce =
      haOrari(s.orari) &&
      fasceAncoraPossibili(s.adesso, [s.orari]).length === 0 &&
      fasceDiDomaniPossibili(s.adesso, [s.orari]).length === 0;
    if (p.tipo === 'chiuso') {
      return cassaSenzaFasce
        ? rigaNegozioChiuso(p.riapre)
        : `${rigaNegozioChiuso(p.riapre)}: in cassa scegli l'ora della consegna`;
    }
    if (cassaSenzaFasce) {
      if (s.veloce === true) return `Consegna ${VELOCE_IN_MINUTI}`;
      const riapre = quandoRiapre(s.orari, s.adesso);
      return riapre ? `Le consegne di oggi sono finite, il negozio riapre ${riapre}` : 'Le consegne di oggi sono finite';
    }
  }
  return s.veloce === true ? CONSEGNA_O_VELOCE_ADESSO : CONSEGNA_ALL_ORA_CHE_SCEGLI;
}

/**
 * 30/10/2026 — IL BOLLINO DELLA CONSEGNA NELLA VETRINA DEL NEGOZIO, CON LE REGOLE DELLA CASSA.
 *
 * Giovedì 29/10 alle 20:15 la vetrina di Pane Quotidiano diceva insieme «Chiuso ora» e «Consegna
 * oggi»: il forno aveva chiuso alle 13. Il bollino guardava solo se oggi c'era un orario. Qui la
 * domanda è quella delle rotte che creano l'ordine:
 *   · «oggi» se una fascia di oggi non è ancora finita e il negozio è aperto nella parte che resta
 *     (`fasceAncoraPossibili`, la regola unica della cassa e delle rotte, coi minuti e gli orari),
 *     oppure se la cassa ha detto sì alla veloce;
 *   · altrimenti «domani» se domani c'è una fascia in cui il negozio è aperto: è quello che la
 *     cassa offrirà;
 *   · altrimenti niente. Niente anche senza orari scritti (non si sa) e prima dell'idratazione
 *     (`adesso: null`): l'ora la legge il browser, non il server.
 *   · niente anche mentre la risposta della veloce manca e solo lei potrebbe dire «oggi».
 * La usano tutte le schede che parlano della consegna di un negozio: la vetrina (HeroSection), la
 * riga dell'elenco (StoreListRow), la scheda in home (StorePreviewCard) e il negozio in evidenza
 * (HeroStoreCard). Ognuna chiede la veloce con `vetrinaChiedeLaVeloce`.
 */
export type ConsegnaDellaVetrina = 'oggi' | 'domani' | null;

export function consegnaDellaVetrina(s: {
  orari?: unknown;
  /** L'ora di Piacenza letta nel browser (`romeNow()`); `null` prima dell'idratazione. */
  adesso: Date | null;
  /** Risposta di /api/consegna/veloce: `true` solo con `possibile: true`; `null` se non chiesta o caduta. */
  veloce: boolean | null;
}): ConsegnaDellaVetrina {
  const adesso = s.adesso;
  if (!adesso || !haOrari(s.orari)) return null;
  // Il sì della cassa vale solo finché il negozio è aperto e la veloce è nelle sue ore: una
  // risposta letta alle 12:58 non deve tenere acceso «oggi» al forno che ha chiuso alle 13.
  const veloceInGioco =
    expressSiPuo(adesso.getHours()) && isOpenNow(fasceDelGiorno(s.orari, adesso.getDay()), adesso);
  if (s.veloce === true && veloceInGioco) return 'oggi';
  // 30/10/2026 (ondata 22) — La stessa funzione della cassa, con la Date intera: prima qui contava
  // solo l'ora, e lunedì dalle 19:01 alle 19:29 la vetrina diceva «oggi» mentre la cassa non aveva
  // più fasce per oggi.
  const oggiSiPuo = fasceAncoraPossibili(adesso, [s.orari]).length > 0;
  if (oggiSiPuo) return 'oggi';
  // 30/10/2026 — Le fasce non bastano e la veloce si potrebbe, ma la risposta della cassa non c'è
  // (in viaggio o caduta): non si sa se oggi si può. Prima qui usciva «domani», e un attimo dopo
  // «oggi»: un giorno sbagliato scritto mentre si aspetta. Finché non si sa, niente.
  if (s.veloce === null && veloceInGioco) return null;
  const domaniSiPuo = fasceDiDomaniPossibili(adesso, [s.orari]).length > 0;
  return domaniSiPuo ? 'domani' : null;
}

/**
 * Serve chiedere alla cassa della veloce? Solo se le fasce non bastano già a dire «oggi» e se un sì
 * è possibile: negozio aperto adesso e dentro le ore della veloce. A forno chiuso non si chiede.
 */
export function vetrinaChiedeLaVeloce(orari: unknown, adesso: Date | null): boolean {
  if (!adesso || !haOrari(orari)) return false;
  if (consegnaDellaVetrina({ orari, adesso, veloce: null }) === 'oggi') return false;
  return expressSiPuo(adesso.getHours()) && isOpenNow(fasceDelGiorno(orari, adesso.getDay()), adesso);
}
