/**
 * 31/10/2026 — CHI RESTA FUORI DAL RIPENSAMENTO.
 *
 * Il Codice del Consumo esclude dal recesso i beni che si deteriorano in fretta
 * (art. 59 lett. d) e quelli fatti su misura o su ordinazione (lett. c). Scelta
 * di Nicola del 31/10 (fatto `legale.recesso-esclusi`): il negozio segna il
 * prodotto nel modulo (`products.non_recedibile`, migrazione 180) e la richiesta
 * di reso per «Cambio idea» su quel prodotto si rifiuta con un messaggio chiaro.
 * Difetto, articolo sbagliato o non conforme restano sempre ammessi: la garanzia
 * legale non dipende da qui.
 *
 * Esempio: una cliente compra una torta da Pane Quotidiano e il giorno dopo
 * chiede il reso con motivo «Cambio idea». Prima la rotta lo accettava e il
 * forno doveva rifiutarlo a mano, contro la promessa scritta sul sito.
 */

/** Il motivo di reso che vuol dire «ci ho ripensato» (lo stesso di `returns.reason`). */
export const MOTIVO_RIPENSAMENTO = 'CHANGED_MIND' as const;

export type ProdottoPerIlRecesso = { name?: string | null; non_recedibile?: boolean | null };

export function esclusoDalRecesso(prodotto: ProdottoPerIlRecesso | null | undefined): boolean {
  return prodotto?.non_recedibile === true;
}

/**
 * Il messaggio con cui si rifiuta la richiesta, oppure `null` se si puo' fare.
 * Si rifiuta solo il ripensamento, e solo se TUTTI i prodotti della richiesta
 * sono esclusi: la richiesta su una riga sola (la torta) si rifiuta; quella su
 * tutto l'ordine con dentro anche il miele no, perche' il miele il recesso ce
 * l'ha. In quel caso gli esclusi finiscono nella nota per il negozio
 * (`notaDegliEsclusi`) e il rimborso li lascia fuori: l'importo lo sceglie il
 * negozio quando decide il reso.
 */
export function rifiutoDelRecesso(motivo: string, prodotti: ProdottoPerIlRecesso[]): string | null {
  if (motivo !== MOTIVO_RIPENSAMENTO) return null;
  const esclusi = prodotti.filter(esclusoDalRecesso);
  if (esclusi.length === 0 || esclusi.length < prodotti.length) return null;
  const quali = elencoDeiNomi(esclusi);
  const uno = esclusi.length === 1;
  const chi = uno ? `Questo prodotto${quali} è escluso` : `Questi prodotti${quali} sono esclusi`;
  // 13/11/2026 (R13-004) — Prima la frase diceva a nome di MyCity «è fresco … la legge non permette»
  // per qualunque prodotto segnato, anche un maglione. Ora la spunta vale solo sugli alimenti
  // (`esclusioniAmmesse`), e la frase dice chi lo afferma: il negozio.
  return `${chi} dal recesso: il negozio ${uno ? 'lo' : 'li'} indica come ${uno ? 'alimento fresco che si deteriora' : 'alimenti freschi che si deteriorano'} in fretta o ${uno ? 'fatto' : 'fatti'} su ordinazione, e per questi prodotti il Codice del Consumo esclude il reso per «Cambio idea» (art. 59). Se è arrivato difettoso o sbagliato, scegli quel motivo: la garanzia vale sempre.`;
}

/**
 * Il ripensamento su un ordine misto passa, ma il negozio deve sapere cosa NON
 * rimborsare: la riga da aggiungere alle note del reso, oppure `null`.
 * Esempio: torta (esclusa) + miele per «Cambio idea» → il reso nasce, e la nota
 * dice che la torta resta fuori dal rimborso.
 */
export function notaDegliEsclusi(motivo: string, prodotti: ProdottoPerIlRecesso[]): string | null {
  if (motivo !== MOTIVO_RIPENSAMENTO) return null;
  const esclusi = prodotti.filter(esclusoDalRecesso);
  if (esclusi.length === 0 || esclusi.length === prodotti.length) return null;
  const nomi = [...new Set(esclusi.map((p) => (p.name ?? '').trim()).filter(Boolean))];
  return `Esclusi dal recesso (art. 59 Cod. Cons.), da non rimborsare per «Cambio idea»: ${nomi.length > 0 ? nomi.join(', ') : 'alcuni prodotti dell\'ordine'}.`;
}

/**
 * 13/11/2026 (R13-004) — LA SPUNTA NON TOGLIE IL RECESSO A UN MAGLIONE.
 *
 * «Escluso dal recesso» era un interruttore libero: il negozio poteva accenderlo su qualunque
 * prodotto, e la rotta dei resi rifiutava il ripensamento dicendo che era la legge. L'elenco
 * dell'art. 59 è chiuso, e la scelta di Nicola (fatto `legale.recesso-esclusi`) ne prende due
 * voci: i prodotti che si deteriorano in fretta (pane, dolci, salumi, latticini e gli altri
 * freschi) e quelli fatti su ordinazione. Tutti e due, sul nostro catalogo, sono ALIMENTI: la
 * spunta vale solo per un prodotto la cui categoria (o una delle sue madri) è alimentare,
 * la stessa regola degli allergeni (`richiede_dichiarazioni_alimentari`, migrazione 363; senza
 * la colonna, la radice «alimentari», come in lib/category-attributes.ts).
 *
 * La controllano il salvataggio (lib/products/salvataggio-tracciato.ts), il database
 * (migrazione 373) e la rotta dei resi: una spunta rimasta su un prodotto non alimentare non
 * conta, il ripensamento passa e il negozio lo valuta.
 */
export type CategoriaPerIlRecesso = {
  id: string;
  slug?: string | null;
  parent_id?: string | null;
  richiede_dichiarazioni_alimentari?: boolean | null;
};

export function categoriaDaFreschi(categorie: CategoriaPerIlRecesso[], categoriaId: string | null | undefined): boolean {
  if (!categoriaId) return false;
  const perId = new Map(categorie.map((c) => [c.id, c]));
  const viste = new Set<string>();
  for (let c = perId.get(categoriaId); c && !viste.has(c.id); c = c.parent_id ? perId.get(c.parent_id) : undefined) {
    viste.add(c.id);
    if (c.richiede_dichiarazioni_alimentari === true) return true;
    if (!c.parent_id) return c.slug === 'alimentari';
  }
  return false;
}

/**
 * I prodotti letti dal database, con la spunta tolta dove la categoria non la permette. Una riga
 * letta senza la colonna `category_id` (una lettura parziale) resta com'è: non si sa.
 */
export function esclusioniAmmesse<T extends ProdottoPerIlRecesso & { category_id?: string | null }>(
  prodotti: T[],
  categorie: CategoriaPerIlRecesso[],
): T[] {
  return prodotti.map((p) =>
    p.non_recedibile === true && 'category_id' in p && !categoriaDaFreschi(categorie, p.category_id)
      ? { ...p, non_recedibile: false }
      : p,
  );
}

/** Cosa si dice al negozio che segna come escluso un prodotto non alimentare. */
export const ESCLUSIONE_NON_AMMESSA =
  "«Escluso dal recesso» vale solo per gli alimenti freschi che si deteriorano in fretta o fatti su ordinazione (art. 59 del Codice del Consumo): per questa categoria il cliente può sempre ripensarci. Togli la spunta e salva di nuovo.";

/** Una riga d'ordine come la legge la rotta dei resi. */
export type RigaPerIlRecesso = { product_id?: string | null; product_name?: string | null };

/**
 * 31/10/2026 (collaudo) — UN PRODOTTO TOLTO DAL CATALOGO NON CONTA COME ESCLUSO.
 * Un prodotto per ogni riga dell'ordine, non per ogni prodotto trovato. Se il
 * prodotto della riga non c'e' piu' (tolto dal catalogo: `product_id` NULL, o
 * la riga di `products` cancellata) l'esclusione non si puo' leggere, e la riga
 * vale come recedibile: il recesso e' la regola, l'esclusione l'eccezione che
 * il negozio deve aver segnato.
 * Esempio: torta (esclusa) + miele tolto dal catalogo, «Cambio idea» su tutto
 * l'ordine. Prima il miele spariva dal conto, restava solo la torta, e il reso
 * si rifiutava intero; ora il miele conta, il reso nasce, la torta resta fuori.
 */
export function prodottiDelleRighe(
  righe: RigaPerIlRecesso[],
  prodotti: Array<ProdottoPerIlRecesso & { id?: string | null }>,
): ProdottoPerIlRecesso[] {
  const perId = new Map(prodotti.filter((p) => typeof p.id === 'string').map((p) => [p.id as string, p]));
  return righe.map((r) => {
    const trovato = typeof r.product_id === 'string' ? perId.get(r.product_id) : undefined;
    return trovato ?? { name: r.product_name ?? null, non_recedibile: false };
  });
}

/**
 * La banca dati sa gia' dire «escluso dal recesso»? Si guarda una riga di
 * `products` letta con `*`: prima della migrazione 180 la colonna non c'e'.
 * Senza riga non si sa, e si risponde no: meglio non offrire la spunta che
 * offrirla e far fallire il salvataggio (PostgREST rifiuta la colonna, PGRST204).
 */
export function colonnaDelRecessoPresente(riga: unknown): boolean {
  return !!riga && typeof riga === 'object' && 'non_recedibile' in riga;
}

function elencoDeiNomi(prodotti: ProdottoPerIlRecesso[]): string {
  const nomi = [...new Set(prodotti.map((p) => (p.name ?? '').trim()).filter(Boolean))];
  return nomi.length > 0 ? ` (${nomi.join(', ')})` : '';
}
