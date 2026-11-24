import { z } from 'zod';

/**
 * LA SCHEDA DEL CLIENTE CHE MANDA N8N — 24/11/2026.
 *
 * Il flusso 16 di n8n (il modulo 12 che parte da solo) cerca le fonti pubbliche di un'attività e
 * prepara la sua scheda. Quando ha finito la manda al sito (/api/agenzia/scheda-cliente), che la
 * tiene pronta (tabella schede_clienti, migrazione 708) e la usa quando il titolare accetta il
 * preventivo. Il formato l'abbiamo concordato con la sessione n8n il 24/11: è quello che il 16 ha
 * già in mano, senza traduzioni.
 *
 * Regole (Nicola, 24/11):
 *  · nessun dato inventato: un campo che n8n non manda resta vuoto, e lo conferma il titolare;
 *  · in pubblico solo quello che è «confermato»: tutto il resto il titolare lo vede nella sua
 *    dashboard, con la fonte, e lo conferma lui;
 *  · prezzi e allergeni non arrivano mai: li conferma sempre il negoziante. Se nel testo del menu
 *    c'è un prezzo, la riga si scarta;
 *  · niente dati personali del titolare.
 */

export const STATI_CAMPO = ['confermato', 'da_confermare', 'foto', 'frammento', 'proposta', 'nessuna'] as const;
export type StatoCampo = (typeof STATI_CAMPO)[number];

const testo = (max: number) => z.string().trim().max(max);
const indirizzoWeb = z.string().trim().max(500).regex(/^https?:\/\//i, 'una fonte è un indirizzo web');

const Campo = z.object({
  valore: testo(4000).nullable().optional(),
  stato: z.enum(STATI_CAMPO),
  fonte: indirizzoWeb.nullable().optional(),
});
export type CampoScheda = z.infer<typeof Campo>;

/** I campi che il sito usa. Gli altri si conservano come arrivano (la scheda si tiene intera). */
export const CAMPI_LETTI = ['indirizzo', 'telefono', 'orari', 'link_prenotazione', 'link_menu', 'sito_ufficiale', 'menu_testo'] as const;
export type CampoLetto = (typeof CAMPI_LETTI)[number];

const elenco = z.array(testo(500)).max(30);

export const SchedaInArrivo = z.object({
  tipo: z.literal('scheda-cliente'),
  origine: testo(40).optional(),
  inviato_il: testo(40).optional(),
  id_attivita: z.string().uuid('id_attivita non è un id valido'),
  chiave_cliente: testo(120).optional(),
  campi: z.record(z.string().regex(/^[a-z_]{1,40}$/), Campo).refine((c) => Object.keys(c).length <= 40, 'troppi campi'),
  analisi: z
    .object({
      tipo_di_locale: testo(500).nullable().optional(),
      pubblico: testo(500).nullable().optional(),
      punti_di_forza: elenco.optional(),
      idee_contenuti: elenco.optional(),
      cosa_chiedere_al_titolare: elenco.optional(),
      dubbi: elenco.optional(),
    })
    .passthrough()
    .optional(),
  da_confermare: z.array(z.string().max(40)).max(40).optional(),
});
export type SchedaCliente = z.infer<typeof SchedaInArrivo>;

/** Il valore di un campo, ripulito; `null` se non c'è o è vuoto. */
export function valoreDi(scheda: SchedaCliente | null | undefined, campo: string): string | null {
  const c = scheda?.campi?.[campo];
  const v = typeof c?.valore === 'string' ? c.valore.trim() : '';
  return v ? v : null;
}

/** Il valore solo se è confermato: è l'unico che può andare in pubblico senza il titolare. */
export function valoreConfermato(scheda: SchedaCliente | null | undefined, campo: string): string | null {
  const c = scheda?.campi?.[campo];
  if (!c || c.stato !== 'confermato') return null;
  // Un campo elencato in «da_confermare» non è confermato, qualunque cosa dica il suo stato.
  if (scheda?.da_confermare?.includes(campo)) return null;
  return valoreDi(scheda, campo);
}

/** Un dato della scheda per l'anteprima: il valore e se va ancora confermato dal titolare. */
export type DatoScheda = { valore: string; confermato: boolean };

export function datoDi(scheda: SchedaCliente | null | undefined, campo: string): DatoScheda | null {
  const valore = valoreDi(scheda, campo);
  if (!valore) return null;
  return { valore, confermato: valoreConfermato(scheda, campo) !== null };
}

/**
 * I PREZZI NON ENTRANO MAI (li scrive il negoziante). Due collaudi del 24/11 hanno trovato forme
 * che passavano («1,5», «Brioche 2», «EUR 2», «euro 3», «Brioche:2», «2.-», «4 E»): la regola ora
 * è larga apposta, e scartare una frase buona costa meno che pubblicarne una con un prezzo.
 *  · VALUTA: il simbolo o la parola della moneta, in qualunque posizione;
 *  · NUMERO_DA_PREZZO: un numero coi decimali o col trattino («1,50», «3.5», «2.-») o seguito da «E».
 * Nelle righe del MENU basta una cifra qualsiasi per scartare la riga (vedi prodottiTipici).
 */
const VALUTA = /€|\b(eur|euro|euri|chf)\b|\beur\d/i;
const NUMERO_DA_PREZZO = /\d+[.,]\d{1,2}\b|\d+[.,]-|\d\s?E\b/;

/** Vero se il testo non nomina una moneta: si usa sugli orari, che hanno cifre e punti per forza. */
export function senzaValuta(testo: string): boolean {
  return !VALUTA.test(testo);
}

/** Vero se il testo non dice un prezzo: solo così entra in un post, nel sito o nel profilo. */
export function senzaPrezzo(testo: string): boolean {
  return !VALUTA.test(testo) && !NUMERO_DA_PREZZO.test(testo);
}

/** Le voci dell'analisi (punti di forza, idee) ripulite: niente vuoti, niente prezzi. */
export function vociSenzaPrezzo(voci: readonly string[] | undefined, quante: number, lunghezzaMassima = 140): string[] {
  return (voci ?? []).map((x) => x.trim()).filter((x) => x.length >= 3 && x.length <= lunghezzaMassima && senzaPrezzo(x)).slice(0, quante);
}

/**
 * La scheda con i soli campi confermati e senza l'analisi (che è una lettura di n8n, non un dato
 * confermato dal titolare). È quella che si usa dove la pagina non è del negozio: il link col
 * codice. Nella dashboard del negozio, invece, la scheda va intera, con «da confermare».
 */
export function soloConfermati(scheda: SchedaCliente | null | undefined): SchedaCliente | null {
  if (!scheda) return null;
  const campi = Object.fromEntries(
    Object.entries(scheda.campi).filter(([nome]) => valoreConfermato(scheda, nome) !== null),
  );
  return { ...scheda, campi, analisi: undefined, da_confermare: [] };
}

/**
 * I prodotti tipici, dal testo del menu: una voce per riga, senza elenchi puntati, senza righe
 * con un prezzo (i prezzi li conferma il negoziante) e senza doppioni. Al massimo `quanti`.
 */
export function prodottiTipici(scheda: SchedaCliente | null | undefined, quanti = 8, soloSeConfermato = false): string[] {
  const menu = soloSeConfermato ? valoreConfermato(scheda, 'menu_testo') : valoreDi(scheda, 'menu_testo');
  if (!menu) return [];
  const visti = new Set<string>();
  const voci: string[] = [];
  for (const riga of menu.split(/\r?\n|;/)) {
    // Si guarda la riga com'è arrivata, prima di ripulirla: ripulendo, «1,50 Brioche» diventava «,50 Brioche».
    // Il numero d'elenco in testa («1. Brioche», «- Brioche») non conta; qualunque altra cifra sì.
    const senzaElenco = riga.replace(/^\s*(\d{1,2}[.)]\s+|[-–—•·*]\s*)/, '');
    if (/\d/.test(senzaElenco) || VALUTA.test(senzaElenco)) continue;
    const voce = senzaElenco.replace(/\s+/g, ' ').trim();
    if (voce.length < 3 || voce.length > 80 || /^[,.:;]/.test(voce)) continue;
    const chiave = voce.toLowerCase();
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    voci.push(voce);
    if (voci.length >= quanti) break;
  }
  return voci;
}

/**
 * Cosa scrivere nel profilo quando il titolare accetta: solo i campi confermati, nelle colonne che
 * li reggono. Gli orari arrivano come testo e il profilo li vuole a giorni: restano nella scheda,
 * li sistema il titolare. Un campo assente non cancella quello che c'è già.
 */
export function campiPerIlProfilo(scheda: SchedaCliente | null | undefined): { store_address?: string } {
  // Solo l'indirizzo del locale, che per un negozio è pubblico per natura. Il telefono no: per il
  // modulo 12 «confermato» vuol dire «trovato scritto in una fonte», non «confermato dal titolare»
  // (sessione n8n, 24/11), e un numero trovato in rete può essere il cellulare del titolare. Resta
  // nella scheda, e lo conferma lui dalla sua dashboard.
  const fuori: { store_address?: string } = {};
  const indirizzo = valoreConfermato(scheda, 'indirizzo');
  if (indirizzo && senzaValuta(indirizzo)) fuori.store_address = indirizzo.slice(0, 300);
  return fuori;
}

/** Legge una scheda salvata: se non è nel formato, è come se non ci fosse (mai un dato a metà). */
export function leggiSchedaSalvata(grezza: unknown): SchedaCliente | null {
  const esito = SchedaInArrivo.safeParse(grezza);
  return esito.success ? esito.data : null;
}
