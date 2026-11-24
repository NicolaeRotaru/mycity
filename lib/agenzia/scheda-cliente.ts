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
 * Un testo che dice un prezzo: «1,50 €», «2 euro», «€ 3», «1,5», «3.50». Si scarta la riga intera:
 * i prezzi li scrive il negoziante. In una riga di MENU vale anche un numero da solo in fondo
 * («Brioche 2»), che in un'idea per un post («sfornata alle 7») non è un prezzo.
 * (Collaudo del 24/11: «Cornetto 1,5» e «Brioche 2» passavano.)
 */
const HA_UN_PREZZO = /\d+([.,]\d{1,2})?\s*(€|euro|eur\b)|€|\b\d+[.,]\d{1,2}\b/i;
const NUMERO_IN_FONDO = /\s\d{1,3}\s*$/;

/** Vero se il testo non dice un prezzo: solo così entra in un post, nel sito o nel profilo. */
export function senzaPrezzo(testo: string): boolean {
  return !HA_UN_PREZZO.test(testo);
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
    const voce = riga.replace(/^[\s\-–—•·*\d.)]+/, '').replace(/\s+/g, ' ').trim();
    if (voce.length < 3 || voce.length > 80 || !senzaPrezzo(voce) || NUMERO_IN_FONDO.test(riga)) continue;
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
export function campiPerIlProfilo(scheda: SchedaCliente | null | undefined): { store_address?: string; store_phone?: string } {
  const fuori: { store_address?: string; store_phone?: string } = {};
  const indirizzo = valoreConfermato(scheda, 'indirizzo');
  if (indirizzo) fuori.store_address = indirizzo.slice(0, 300);
  const telefono = valoreConfermato(scheda, 'telefono');
  if (telefono && /^[+\d][\d\s./-]{5,24}$/.test(telefono)) fuori.store_phone = telefono;
  return fuori;
}

/** Legge una scheda salvata: se non è nel formato, è come se non ci fosse (mai un dato a metà). */
export function leggiSchedaSalvata(grezza: unknown): SchedaCliente | null {
  const esito = SchedaInArrivo.safeParse(grezza);
  return esito.success ? esito.data : null;
}
