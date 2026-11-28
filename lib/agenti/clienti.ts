import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * LA MAPPA DEI CLIENTI DA VISITARE — 28/11/2026 (migrazione 999i).
 *
 * Nicola: «la mappa deve visualizzarsi in 2 modi: 1) sulla mappa, 2) una lista che si può ordinare, e un ordine è
 * la priorità del cliente da contattare». Le attività arrivano dal flusso n8n 16 (tutta la fila, circa 650 entro
 * 5 km da Pane Quotidiano) dalla porta /api/agenzia/clienti-da-visitare (la chiama solo n8n; contratto in
 * docs/agenti/mappa-clienti.md). Gli agenti le prenotano da soli («Ci vado io» / «Lascio») e dopo la visita segnano lo
 * stato con una parola. Questa tabella è l'unica fonte dello stato: il flusso 16 la rilegge il lunedì.
 *
 * Le regole dei permessi stanno qui e nelle rotte, perché il browser non arriva mai alla tabella:
 *  · ogni agente vede tutta la mappa, ma di una prenotazione altrui sa solo che è «presa» (non chi, non quando);
 *  · prende solo un cliente libero (una sola istruzione UPDATE … WHERE prenotata_da IS NULL: se due toccano
 *    «Ci vado io» insieme, vince uno e l'altro lo vede preso);
 *  · lascia e cambia lo stato solo dei clienti suoi;
 *  · l'admin (Nicola) vede chi ha preso cosa, e può lasciare o cambiare lo stato di tutti.
 * Mai messaggi automatici alle attività: il primo contatto lo fa una persona (art. 130 Codice privacy).
 */

// «esclusa» (Nicola, 28/11 alle 02:45): riga tolta, non visitata. Non è da contattare: non si mostra agli agenti e
// non conta come visitata. Arriva dalla tabella n8n o la mette l'admin; un agente non la sceglie.
export const STATI = ['da_visitare', 'visitata', 'si', 'no', 'iscritta', 'esclusa'] as const;
export type Stato = (typeof STATI)[number];
export const PAROLA_STATO: Record<Stato, string> = { da_visitare: 'da visitare', visitata: 'visitata', si: 'sì', no: 'no', iscritta: 'iscritta', esclusa: 'esclusa' };
export const statoValido = (s: unknown): s is Stato => typeof s === 'string' && (STATI as readonly string[]).includes(s);

export const OSM = /^(node|way|relation)\/[0-9]{1,15}$/;

export type Presa = 'libera' | 'mia' | 'altro';
export type Chi = { id: string; admin: boolean };

/** Quello che arriva al telefono dell'agente. Niente id di altri agenti. */
export type Cliente = {
  osm: string;
  nome: string;
  tipo: string | null;
  segmento: string | null;
  indirizzo: string | null;
  telefono: string | null;
  sito: string | null;
  lat: number | null;
  lon: number | null;
  distanzaM: number | null;
  punteggio: number | null;
  perche: string | null;
  offerta: string | null;
  mappa: string | null;
  dossier: string | null;
  settimana: string | null;
  inFila: boolean;
  stato: Stato;
  presa: Presa;
  /** Solo per l'admin: l'email dell'agente che l'ha presa. */
  presaDa?: string | null;
};

const COLONNE = 'osm, nome, tipo, segmento, indirizzo, telefono, sito, lat, lon, distanza_m, punteggio, perche, offerta, mappa, dossier, settimana, in_fila, prenotata_da, stato';

type Riga = Record<string, unknown>;
const testo = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const numero = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function perIlTelefono(r: Riga, chi: Chi, emailDi: Map<string, string> = new Map()): Cliente {
  const di = typeof r.prenotata_da === 'string' ? r.prenotata_da : null;
  const presa: Presa = !di ? 'libera' : di === chi.id ? 'mia' : 'altro';
  const c: Cliente = {
    osm: String(r.osm),
    nome: String(r.nome ?? ''),
    tipo: testo(r.tipo),
    segmento: testo(r.segmento),
    indirizzo: testo(r.indirizzo),
    telefono: testo(r.telefono),
    sito: testo(r.sito),
    lat: numero(r.lat),
    lon: numero(r.lon),
    distanzaM: numero(r.distanza_m),
    punteggio: numero(r.punteggio),
    perche: testo(r.perche),
    offerta: testo(r.offerta),
    mappa: typeof r.mappa === 'string' && r.mappa.startsWith('https://www.google.com/maps/') ? r.mappa : null,
    dossier: testo(r.dossier),
    settimana: testo(r.settimana),
    inFila: r.in_fila !== false,
    stato: statoValido(r.stato) ? r.stato : 'da_visitare',
    presa,
  };
  if (chi.admin) c.presaDa = di ? (di === chi.id ? 'io' : emailDi.get(di) ?? 'un agente') : null;
  return c;
}

/** Tutta la mappa, per un agente o per l'admin. Lancia per un guasto (tabella mancante, database giù). */
export async function leggiClienti(db: SupabaseClient, chi: Chi): Promise<Cliente[]> {
  const righe: Riga[] = [];
  // PostgREST restituisce al massimo 1000 righe per volta: si legge a pagine (la fila è circa 650, ma cresce).
  for (let da = 0; da < 20000; da += 1000) {
    const { data, error } = await db.from('clienti_da_visitare').select(COLONNE).order('punteggio', { ascending: false, nullsFirst: false }).order('osm', { ascending: true }).range(da, da + 999);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as Riga[];
    righe.push(...pagina);
    if (pagina.length < 1000) break;
  }
  let emailDi = new Map<string, string>();
  if (chi.admin) {
    const ids = [...new Set(righe.map((r) => r.prenotata_da).filter((x): x is string => typeof x === 'string'))];
    if (ids.length) {
      const { data } = await db.from('agenti').select('user_id, email').in('user_id', ids);
      emailDi = new Map(((data ?? []) as Riga[]).map((a) => [String(a.user_id), String(a.email)]));
    }
  }
  return righe.map((r) => perIlTelefono(r, chi, emailDi));
}

/** Per l'admin, la riga dopo un'azione con l'email di chi l'ha presa (senza, la pagina scriverebbe «un agente»). */
async function perChi(db: SupabaseClient, r: Riga, chi: Chi): Promise<Cliente> {
  const di = typeof r.prenotata_da === 'string' ? r.prenotata_da : null;
  if (!chi.admin || !di || di === chi.id) return perIlTelefono(r, chi);
  const { data } = await db.from('agenti').select('user_id, email').eq('user_id', di).maybeSingle();
  const a = data as Riga | null;
  return perIlTelefono(r, chi, a ? new Map([[String(a.user_id), String(a.email)]]) : new Map());
}

export type Esito = { ok: true; cliente: Cliente } | { ok: false; perche: 'non_trovato' | 'presa' | 'non_tua' };

async function rileggi(db: SupabaseClient, osm: string): Promise<Riga | null> {
  const { data, error } = await db.from('clienti_da_visitare').select(COLONNE).eq('osm', osm).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Riga | null) ?? null;
}

/** «Ci vado io»: il cliente diventa mio solo se è libero. Toccarlo di nuovo quando è già mio va bene. */
export async function prendi(db: SupabaseClient, osm: string, chi: Chi): Promise<Esito> {
  if (!OSM.test(osm)) return { ok: false, perche: 'non_trovato' };
  const { data, error } = await db.from('clienti_da_visitare')
    .update({ prenotata_da: chi.id, prenotata_il: new Date().toISOString() })
    .eq('osm', osm).is('prenotata_da', null).select(COLONNE);
  if (error) throw new Error(error.message);
  const presa = (data ?? []) as Riga[];
  if (presa.length) return { ok: true, cliente: perIlTelefono(presa[0], chi) };
  const r = await rileggi(db, osm);
  if (!r) return { ok: false, perche: 'non_trovato' };
  if (r.prenotata_da === chi.id) return { ok: true, cliente: perIlTelefono(r, chi) };
  return { ok: false, perche: 'presa' };
}

/** «Lascio»: torna libero. Un agente lascia solo i suoi; l'admin anche quelli degli altri. Lo stato resta. */
export async function lascia(db: SupabaseClient, osm: string, chi: Chi): Promise<Esito> {
  if (!OSM.test(osm)) return { ok: false, perche: 'non_trovato' };
  let q = db.from('clienti_da_visitare').update({ prenotata_da: null, prenotata_il: null }).eq('osm', osm);
  if (!chi.admin) q = q.eq('prenotata_da', chi.id);
  const { data, error } = await q.select(COLONNE);
  if (error) throw new Error(error.message);
  const fatte = (data ?? []) as Riga[];
  if (fatte.length) return { ok: true, cliente: perIlTelefono(fatte[0], chi) };
  const r = await rileggi(db, osm);
  if (!r) return { ok: false, perche: 'non_trovato' };
  if (!r.prenotata_da) return { ok: true, cliente: await perChi(db, r, chi) };
  return { ok: false, perche: 'non_tua' };
}

/** Lo stato dopo la visita. Solo sui clienti miei (l'admin su tutti). */
export async function segnaStato(db: SupabaseClient, osm: string, stato: Stato, chi: Chi): Promise<Esito> {
  if (!OSM.test(osm)) return { ok: false, perche: 'non_trovato' };
  let q = db.from('clienti_da_visitare').update({ stato, stato_da: chi.id, stato_il: new Date().toISOString() }).eq('osm', osm);
  if (!chi.admin) q = q.eq('prenotata_da', chi.id);
  const { data, error } = await q.select(COLONNE);
  if (error) throw new Error(error.message);
  const fatte = (data ?? []) as Riga[];
  if (fatte.length) return { ok: true, cliente: await perChi(db, fatte[0], chi) };
  const r = await rileggi(db, osm);
  return { ok: false, perche: r ? 'non_tua' : 'non_trovato' };
}

// ── La porta di n8n ──────────────────────────────────────────────────────────

// Il carattere nullo Postgres non lo accetta in un testo: uno solo farebbe fallire tutto il giro (collaudo del 28/11).
const senzaNulli = (v: unknown) => String(v).replace(/\u0000/g, '');
const corta = (v: unknown, n: number): string | null => {
  if (v === null || v === undefined) return null;
  const t = Array.from(senzaNulli(v).replace(/\s+/g, ' ').trim());
  return t.length ? t.slice(0, n).join('') : null;
};
const lunga = (v: unknown, n: number): string | null => {
  if (v === null || v === undefined) return null;
  const t = Array.from(senzaNulli(v).trim());
  return t.length ? t.slice(0, n).join('') : null;
};
const coordinata = (v: unknown, max: number) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
/** Un giorno che esiste davvero: «2026-02-30» passerebbe la forma e farebbe fallire tutto il giro. */
const giornoVero = (s: unknown): s is string => typeof s === 'string' && GIORNO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Lo stato scritto a mano nella tabella n8n, letto come lo legge il flusso 16 (solo le parole giuste). */
export function statoDallaTabella(v: unknown): Stato | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parole: Record<string, Stato> = { visitata: 'visitata', visitato: 'visitata', visto: 'visitata', vista: 'visitata', si: 'si', yes: 'si', no: 'no', iscritta: 'iscritta', iscritto: 'iscritta', esclusa: 'esclusa', escluso: 'esclusa' };
  return parole[t] ?? null;
}

export type RigaInArrivo = {
  osm: string; nome: string; tipo: string | null; segmento: string | null; indirizzo: string | null; telefono: string | null;
  sito: string | null; lat: number | null; lon: number | null; distanza_m: number | null; punteggio: number | null;
  perche: string | null; offerta: string | null; mappa: string | null; dossier: string | null; settimana: string | null;
  stato_iniziale: Stato | null;
};

/**
 * Pulisce quello che manda n8n. Scarta le righe senza identificativo o nome validi, toglie i doppioni (vince
 * l'ultima: il database rifiuterebbe due righe uguali nello stesso giro), taglia i testi ai limiti della tabella.
 */
export function pulisciFila(attivita: unknown): { righe: RigaInArrivo[]; scartate: number } {
  if (!Array.isArray(attivita)) return { righe: [], scartate: 0 };
  const perOsm = new Map<string, RigaInArrivo>();
  let scartate = 0;
  for (const a of attivita) {
    if (!a || typeof a !== 'object') { scartate++; continue; }
    const x = a as Riga;
    const osm = String(x.osm ?? '').trim();
    const nome = corta(x.nome, 200);
    if (!OSM.test(osm) || !nome) { scartate++; continue; }
    const mappa = typeof x.mappa === 'string' && x.mappa.startsWith('https://www.google.com/maps/') && x.mappa.length <= 600 ? x.mappa : null;
    const distanza = Number(x.distanza_m);
    const punti = Number(x.punteggio);
    const settimana = giornoVero(x.settimana) ? x.settimana : null;
    // La posizione vale solo intera: una riga con la sola latitudine resterebbe a metà.
    let lat = coordinata(x.lat, 90), lon = coordinata(x.lon, 180);
    if (lat === null || lon === null) { lat = null; lon = null; }
    perOsm.set(osm, {
      osm, nome,
      tipo: corta(x.tipo, 80), segmento: corta(x.segmento, 60), indirizzo: corta(x.indirizzo, 200), telefono: corta(x.telefono, 40),
      sito: corta(x.sito, 300), lat, lon,
      distanza_m: x.distanza_m !== null && x.distanza_m !== '' && Number.isFinite(distanza) && distanza >= 0 && distanza <= 100000 ? Math.round(distanza) : null,
      punteggio: x.punteggio !== null && x.punteggio !== '' && Number.isFinite(punti) && Math.abs(punti) < 99999 ? Math.round(punti * 10) / 10 : null,
      perche: corta(x.perche, 400), offerta: corta(x.offerta, 200), mappa, dossier: lunga(x.dossier, 4000), settimana,
      stato_iniziale: statoDallaTabella(x.stato_tabella),
    });
  }
  return { righe: [...perOsm.values()], scartate };
}

/**
 * Un agente sospeso (Admin → Agenti) non entra più, e i suoi clienti tornano liberi subito: se no restano «presi»
 * per i colleghi finché qualcuno non li libera uno per uno (collaudo del 28/11). Gli stati restano.
 */
export async function liberaIClientiDi(db: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await db.from('clienti_da_visitare').update({ prenotata_da: null, prenotata_il: null }).eq('prenotata_da', userId).select('osm');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/** Quello che il flusso 16 rilegge il lunedì: chi è già proposto, preso o visitato, e il conto per il messaggio. */
export async function statiPerIlFlusso(db: SupabaseClient) {
  const righe: Riga[] = [];
  for (let da = 0; da < 20000; da += 1000) {
    const { data, error } = await db.from('clienti_da_visitare').select('osm, settimana, prenotata_da, stato').order('osm', { ascending: true }).range(da, da + 999);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as Riga[];
    righe.push(...pagina);
    if (pagina.length < 1000) break;
  }
  const stati = righe.map((r) => ({
    osm: String(r.osm),
    proposta: Boolean(r.settimana),
    presa: Boolean(r.prenotata_da),
    stato: statoValido(r.stato) ? r.stato : 'da_visitare',
  }));
  const conta = (f: (s: (typeof stati)[number]) => boolean) => stati.filter(f).length;
  return {
    stati,
    conti: {
      proposte: conta((s) => s.proposta),
      prese: conta((s) => s.presa),
      visitate: conta((s) => s.stato !== 'da_visitare' && s.stato !== 'esclusa'),
      escluse: conta((s) => s.stato === 'esclusa'),
      si: conta((s) => s.stato === 'si' || s.stato === 'iscritta'),
      iscritte: conta((s) => s.stato === 'iscritta'),
      no: conta((s) => s.stato === 'no'),
    },
  };
}
