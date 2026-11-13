/**
 * Cosa si porta dietro chi va a fare l'accesso a metà cassa — e cosa non si riporta mai indietro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE
 * ─────────────────────────────────────────────────────────────────────────────
 * L'indirizzo si compila da ospiti; l'accesso viene chiesto **solo alla fine**, quando si conferma.
 * È una scelta giusta — si chiama «rimanda il muro» — e per non far perdere il lavoro fatto la
 * pagina salvava una bozza prima di mandare al login.
 *
 * Salvava `form` e basta: nome, indirizzo, città, CAP, telefono, note. Restavano fuori **il codice
 * sconto, il metodo di pagamento e la fascia di consegna**. Chi si registrava proprio nel momento
 * di confermare tornava indietro con lo sconto sparito e il pagamento riportato a «carta».
 *
 * **Un totale che sale dopo il login è la definizione del carrello abbandonato.** La persona ha
 * appena dato l'email e la password, torna, e la cifra è più alta di quella che aveva accettato.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERCHÉ SI RIPORTA IL CODICE E NON LO SCONTO
 * ─────────────────────────────────────────────────────────────────────────────
 * La strada corta era salvare anche lo sconto già calcolato e rimetterlo al ritorno. Non si fa, per
 * due motivi diversi che portano nella stessa direzione.
 *
 * ① **La bozza sta nel browser, e nel browser ci scrive chiunque.** `localStorage` si apre con due
 *    clic. Se il ritorno rimettesse a video lo sconto salvato, basterebbe scriverci dentro un
 *    numero per vedersi un carrello scontato. Un codice, invece, è solo una stringa: passa dalla
 *    verifica come il primo giorno, e se non vale non vale.
 * ② **Il carrello può essere cambiato nel frattempo.** Il codice valeva sopra i 30 €, la persona ha
 *    tolto un articolo in un'altra scheda: quello sconto non è più suo. La verifica che c'è già
 *    nella pagina se ne accorge — ma solo se le si dà un codice da verificare, non un risultato
 *    da mostrare.
 *
 * Stessa idea per la fascia di consegna: si riporta indietro **solo se è ancora possibile**. Chi va
 * al login alle 19:55 e torna alle 20:05 non deve ritrovarsi «Oggi · 19:30–21:00» come se niente
 * fosse — quell'ora è passata mentre digitava la password.
 *
 * Prova: tests/unit/il-muro-dell-accesso-faceva-salire-il-totale.test.ts
 */
import { fasceAncoraPossibili, fasceDiDomaniPossibili, FASCE_DI_DOMANI, type Giorno } from '@/lib/quando-arriva';
import { fasciaAlGiornoDellOrdine } from '@/lib/ordini/fascia-leggibile';
import { giornoPiacenza } from '@/lib/tempo-piacenza';

/** L'ora intera (le vecchie chiamate) oppure l'orologio di Roma coi minuti, e gli orari dei negozi. */
function fasceDi(giorno: 'today' | 'tomorrow', adesso: number | Date, orari: readonly unknown[]): string[] {
  if (typeof adesso === 'number') return giorno === 'today' ? fasceAncoraPossibili(adesso) : FASCE_DI_DOMANI;
  return giorno === 'today' ? fasceAncoraPossibili(adesso, orari) : fasceDiDomaniPossibili(adesso, orari);
}

/**
 * 13/11/2026 (R19-009) — QUANTO VIVE UNA BOZZA: DUE ORE.
 *
 * Dentro la bozza ci sono nome, indirizzo, telefono e note («citofono Rossi, cancello 1234»), e sta
 * nella memoria permanente del browser. Si cancellava solo quando qualcuno riapriva la cassa: chi
 * rinunciava all'accesso lasciava i suoi dati lì per sempre, e chi apriva la cassa una settimana
 * dopo sullo stesso computer li trovava già scritti. Adesso la bozza porta la sua scadenza
 * (`scadeIl`): passata quella non si rimette più, la cassa la butta, e la barra in alto la butta
 * a ogni caricamento e a ogni uscita dall'account. Due ore bastano per accedere o registrarsi.
 */
export const BOZZA_VALE_MS = 2 * 60 * 60_000;

/** I campi dell'indirizzo: gli unici che tornano indietro così come sono. */
export type CampiIndirizzo = Record<string, unknown>;

export type Bozza = {
  form: CampiIndirizzo;
  /** Il CODICE dello sconto, mai lo sconto: al ritorno si rifà la verifica. */
  couponCode?: string;
  metodoPagamento?: 'cod' | 'card';
  giorno?: Giorno;
  fasciaOggi?: string;
  fasciaDomani?: string;
  /**
   * 12/11/2026 (R03-025) — Quando è stata scelta la fascia (millisecondi): «Domani» vuol dire
   * domani rispetto a QUEL giorno, non a quello in cui si torna (vedi `bozzaRiportataAOggi`).
   */
  sceltaIl?: number;
  /** R19-009 — Quando la bozza scade (millisecondi): dopo, non si rimette più. */
  scadeIl?: number;
};

/**
 * 13/11/2026 (R19-009, giro di correzione) — La scadenza è ancora valida, ed è credibile.
 *
 * `scadeIl` arriva dal browser come il resto: una bozza con la scadenza fra dieci giorni passava per
 * buona. Una bozza vera scade al più 2 ore dopo la scelta (`sceltaIl`), e non può scadere più di 2
 * ore dopo adesso: oltre, non vale. La usano la cassa (`bozzaLetta`) e la barra in alto.
 */
export function scadenzaDellaBozzaValida(g: { scadeIl?: unknown; sceltaIl?: unknown }, adesso: Date): boolean {
  if (typeof g.scadeIl !== 'number' || !Number.isFinite(g.scadeIl)) return false;
  const ora = adesso.getTime();
  if (ora > g.scadeIl) return false;
  if (g.scadeIl > ora + BOZZA_VALE_MS) return false;
  if (typeof g.sceltaIl === 'number' && Number.isFinite(g.sceltaIl) && g.scadeIl > g.sceltaIl + BOZZA_VALE_MS) return false;
  return true;
}

/** Quello che si mette da parte prima di mandare qualcuno a fare l'accesso. */
export function bozzaDaSalvare(s: {
  form: CampiIndirizzo;
  couponCode?: string | null;
  metodoPagamento: 'cod' | 'card';
  giorno: Giorno;
  fasciaOggi: string;
  fasciaDomani: string;
  /** L'istante in cui si salva: chi chiama passa l'orologio (di norma `new Date()`). */
  adesso?: Date;
}): Bozza {
  const istante = (s.adesso ?? new Date()).getTime();
  const bozza: Bozza = {
    form: s.form,
    metodoPagamento: s.metodoPagamento,
    giorno: s.giorno,
    fasciaOggi: s.fasciaOggi,
    fasciaDomani: s.fasciaDomani,
    sceltaIl: istante,
    scadeIl: istante + BOZZA_VALE_MS,
  };
  const codice = (s.couponCode ?? '').trim();
  if (codice) bozza.couponCode = codice;
  return bozza;
}

/**
 * Una bozza scritta da chissà chi diventa qualcosa di cui ci si può fidare.
 *
 * Torna solo campi che sappiamo leggere. Tutto il resto viene lasciato fuori: la bozza arriva dal
 * browser, e un oggetto arrivato dal browser non è un oggetto di cui fidarsi.
 */
export function bozzaLetta(grezza: unknown, adesso?: Date): Bozza | null {
  if (!grezza || typeof grezza !== 'object') return null;
  const g = grezza as Record<string, unknown>;
  // R19-009 — Scaduta: i dati di chi l'ha scritta non tornano a chi apre la cassa dopo. E una
  // scadenza oltre le 2 ore dalla scelta (o da adesso) non vale (`scadenzaDellaBozzaValida`).
  if (adesso && typeof g.scadeIl === 'number' && !scadenzaDellaBozzaValida(g, adesso)) return null;
  // Le bozze vecchie erano il form e basta, senza il campo `form`: si leggono lo stesso.
  const form = (g.form && typeof g.form === 'object' ? g.form : g) as CampiIndirizzo;
  const bozza: Bozza = { form: soloCampiSemplici(form) };
  if (typeof g.couponCode === 'string' && g.couponCode.trim()) bozza.couponCode = g.couponCode.trim();
  if (g.metodoPagamento === 'cod' || g.metodoPagamento === 'card') bozza.metodoPagamento = g.metodoPagamento;
  if (g.giorno === 'now' || g.giorno === 'today' || g.giorno === 'tomorrow') bozza.giorno = g.giorno;
  if (typeof g.fasciaOggi === 'string') bozza.fasciaOggi = g.fasciaOggi;
  if (typeof g.fasciaDomani === 'string') bozza.fasciaDomani = g.fasciaDomani;
  if (typeof g.sceltaIl === 'number' && Number.isFinite(g.sceltaIl)) bozza.sceltaIl = g.sceltaIl;
  // R03-025 — con l'orologio, la bozza si riporta al giorno di adesso (`bozzaRiportataAOggi`).
  return adesso ? bozzaRiportataAOggi(bozza, adesso) : bozza;
}

/**
 * 12/11/2026 (R03-025) — «DOMANI» SALVATO IERI SERA E' «OGGI».
 *
 * La bozza sta in `localStorage`, che resta anche nei giorni dopo, e conteneva il giorno
 * («tomorrow») e l'etichetta («Domani · 9:00–11:00») ma nessuna data. Lunedì alle 22:30 il
 * cliente sceglie domani mattina, si registra e apre il link di conferma martedì alle 08:15: la
 * cassa ripartiva con «Domani · 9:00–11:00» già premuto, e l'ordine nasceva per mercoledì.
 *
 * Qui la bozza si riporta al giorno di adesso con la regola che usa già la carta pagata dopo
 * mezzanotte (`fasciaAlGiornoDellOrdine`): «Domani» di ieri diventa «Oggi», una fascia di un
 * giorno passato si toglie. Una bozza senza data (scritta prima di questa riparazione) non dice
 * di che giorno parla: giorno e fasce non si rimettono, il resto sì. Poi `fasciaDaRimettere`
 * controlla, come sempre, che la fascia sia ancora proponibile adesso.
 */
export function bozzaRiportataAOggi(bozza: Bozza, adesso: Date): Bozza {
  // «Adesso» (la veloce) non è un giorno del calendario: resta, e la cassa lo ricontrolla da sé.
  const { giorno, fasciaOggi: _fasciaDiQuelGiorno, fasciaDomani, sceltaIl, ...resto } = bozza;
  const soloAdesso: Bozza = giorno === 'now' ? { ...resto, giorno } : resto;
  if (typeof sceltaIl !== 'number') return soloAdesso;
  if (giornoPiacenza(sceltaIl) === giornoPiacenza(adesso)) return bozza;
  const daDomaniAOggi = fasciaDomani ? fasciaAlGiornoDellOrdine(fasciaDomani, sceltaIl, adesso) : null;
  const oggi = daDomaniAOggi && daDomaniAOggi.startsWith('Oggi') ? daDomaniAOggi : null;
  const riportata: Bozza = { ...soloAdesso, sceltaIl };
  if (oggi) {
    riportata.fasciaOggi = oggi;
    if (giorno === 'tomorrow') riportata.giorno = 'today';
  }
  return riportata;
}

/** Il form non deve poter portare dentro oggetti annidati arrivati dal browser. */
function soloCampiSemplici(form: CampiIndirizzo): CampiIndirizzo {
  const fuori: CampiIndirizzo = {};
  for (const [k, v] of Object.entries(form ?? {})) {
    if (k === 'form' || k === 'couponCode' || k === 'metodoPagamento') continue;
    if (k === 'giorno' || k === 'fasciaOggi' || k === 'fasciaDomani' || k === 'sceltaIl' || k === 'scadeIl') continue;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') fuori[k] = v;
  }
  return fuori;
}

/**
 * Il metodo di pagamento che si può davvero rimettere.
 *
 * «Carta» si riporta solo se la carta è ancora accettabile: se Stripe non è disponibile adesso,
 * rimetterla vorrebbe dire riportare la persona su una strada che non porta da nessuna parte.
 */
export function metodoDaRimettere(
  salvato: 'cod' | 'card' | undefined,
  stripeDisponibile: boolean,
): 'cod' | 'card' | null {
  if (!salvato) return null;
  if (salvato === 'card' && !stripeDisponibile) return null;
  return salvato;
}

/**
 * La fascia che si può davvero rimettere — e la risposta è `null` quando è passata.
 *
 * IL CASO: login alle 19:55, ritorno alle 20:05. La fascia «Oggi · 19:30–21:00» era scelta ed
 * era giusta; adesso non è più proponibile. Rimetterla vorrebbe dire riportare la persona
 * esattamente sull'ordine con l'appuntamento già passato, cioè il difetto che il lotto prima aveva
 * chiuso. `null` vuol dire «riparti dal valore che la pagina calcola adesso».
 *
 * 30/10/2026 (ondata 22) — Con l'orologio di Roma (la Date intera) e gli orari dei negozi del
 * carrello si chiede alla regola unica della cassa: alle 19:15 l'ora sola diceva ancora «19» e
 * rimetteva una fascia che la cassa e la rotta rifiutano.
 */
export function fasciaDaRimettere(
  giorno: Giorno | undefined,
  fascia: string | undefined,
  adesso: number | Date,
  orari: readonly unknown[] = [],
): string | null {
  if (!giorno || !fascia || giorno === 'now') return null;
  return fasceDi(giorno, adesso, orari).includes(fascia) ? fascia : null;
}

/**
 * Il giorno che si può davvero rimettere.
 *
 * Se per oggi non c'è più niente, «oggi» non si rimette: si lascia decidere alla pagina, che il
 * giorno di partenza lo sa calcolare guardando l'ora.
 */
export function giornoDaRimettere(
  giorno: Giorno | undefined,
  adesso: number | Date,
  orari: readonly unknown[] = [],
): Giorno | null {
  if (!giorno) return null;
  if (giorno === 'today' && fasceDi('today', adesso, orari).length === 0) return null;
  return giorno;
}
