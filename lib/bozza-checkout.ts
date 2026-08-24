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
 * al login alle 19:55 e torna alle 20:05 non deve ritrovarsi «Stasera · 18:00–20:00» come se niente
 * fosse — quell'ora è passata mentre digitava la password.
 *
 * Prova: tests/unit/il-muro-dell-accesso-faceva-salire-il-totale.test.ts
 */
import { fasceAncoraPossibili, FASCE_DI_DOMANI, type Giorno } from '@/lib/quando-arriva';

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
};

/** Quello che si mette da parte prima di mandare qualcuno a fare l'accesso. */
export function bozzaDaSalvare(s: {
  form: CampiIndirizzo;
  couponCode?: string | null;
  metodoPagamento: 'cod' | 'card';
  giorno: Giorno;
  fasciaOggi: string;
  fasciaDomani: string;
}): Bozza {
  const bozza: Bozza = {
    form: s.form,
    metodoPagamento: s.metodoPagamento,
    giorno: s.giorno,
    fasciaOggi: s.fasciaOggi,
    fasciaDomani: s.fasciaDomani,
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
export function bozzaLetta(grezza: unknown): Bozza | null {
  if (!grezza || typeof grezza !== 'object') return null;
  const g = grezza as Record<string, unknown>;
  // Le bozze vecchie erano il form e basta, senza il campo `form`: si leggono lo stesso.
  const form = (g.form && typeof g.form === 'object' ? g.form : g) as CampiIndirizzo;
  const bozza: Bozza = { form: soloCampiSemplici(form) };
  if (typeof g.couponCode === 'string' && g.couponCode.trim()) bozza.couponCode = g.couponCode.trim();
  if (g.metodoPagamento === 'cod' || g.metodoPagamento === 'card') bozza.metodoPagamento = g.metodoPagamento;
  if (g.giorno === 'now' || g.giorno === 'today' || g.giorno === 'tomorrow') bozza.giorno = g.giorno;
  if (typeof g.fasciaOggi === 'string') bozza.fasciaOggi = g.fasciaOggi;
  if (typeof g.fasciaDomani === 'string') bozza.fasciaDomani = g.fasciaDomani;
  return bozza;
}

/** Il form non deve poter portare dentro oggetti annidati arrivati dal browser. */
function soloCampiSemplici(form: CampiIndirizzo): CampiIndirizzo {
  const fuori: CampiIndirizzo = {};
  for (const [k, v] of Object.entries(form ?? {})) {
    if (k === 'form' || k === 'couponCode' || k === 'metodoPagamento') continue;
    if (k === 'giorno' || k === 'fasciaOggi' || k === 'fasciaDomani') continue;
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
 * IL CASO: login alle 19:55, ritorno alle 20:05. La fascia «Stasera · 18:00–20:00» era scelta ed
 * era giusta; adesso non è più proponibile. Rimetterla vorrebbe dire riportare la persona
 * esattamente sull'ordine con l'appuntamento già passato, cioè il difetto che il lotto prima aveva
 * chiuso. `null` vuol dire «riparti dal valore che la pagina calcola adesso».
 */
export function fasciaDaRimettere(
  giorno: Giorno | undefined,
  fascia: string | undefined,
  ora: number,
): string | null {
  if (!giorno || !fascia) return null;
  if (giorno === 'tomorrow') return FASCE_DI_DOMANI.includes(fascia) ? fascia : null;
  if (giorno === 'today') return fasceAncoraPossibili(ora).includes(fascia) ? fascia : null;
  return null;
}

/**
 * Il giorno che si può davvero rimettere.
 *
 * Se per oggi non c'è più niente, «oggi» non si rimette: si lascia decidere alla pagina, che il
 * giorno di partenza lo sa calcolare guardando l'ora.
 */
export function giornoDaRimettere(giorno: Giorno | undefined, ora: number): Giorno | null {
  if (!giorno) return null;
  if (giorno === 'today' && fasceAncoraPossibili(ora).length === 0) return null;
  return giorno;
}
