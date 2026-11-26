// IL FILO CON n8n — il motore della scheda del cliente (lo stesso del 26/11, già acceso):
//   avvia:     POST  <N8N_SCHEDA_URL>/scheda-venditore            (flusso 14)  → mette il lavoro in coda e risponde subito
//   risultato: GET   <N8N_SCHEDA_URL>/scheda-venditore-risultato  (flusso 14b) → «in_corso», «pronta» o «errore»
//   elenco:    POST  <N8N_SCHEDA_URL>/venditori-scheda            (flusso 14c, azione «elenco») → le schede di un agente
// Il segreto viaggia nell'intestazione x-scheda-segreto (variabile N8N_SCHEDA_SEGRETO su Vercel, progetto mycity);
// n8n ne conosce solo l'impronta (sha256). Senza il segreto l'AD non parte: l'agente ha solo la prima scheda.
// Il lavoro di IA lo fa l'AD col piano Max («90 · Chiedi all'AD»): nessuna API a pagamento.

export type Lavoro = { flusso: string; compito: string; dati: unknown; schema: unknown };
export type StatoLavoro = {
  stato: 'in_corso' | 'pronta' | 'errore' | 'sconosciuto';
  venditore?: string | null; prima?: unknown; risultato?: unknown; avvisi?: string[]; errore?: string | null; secondi?: number | null;
};
export type SchedaInElenco = { lavoro: string; nome: string; stato: string; iniziato: number | null };

const base = () => (process.env.N8N_SCHEDA_URL?.trim() || 'https://n8n-shdy.sliplane.app/webhook').replace(/\/+$/, '');
const segreto = () => process.env.N8N_SCHEDA_SEGRETO?.trim() || '';
export const adCollegato = () => segreto().length >= 24;

const comeJson = (t: string): unknown => { try { return JSON.parse(t); } catch { return null; } };
const oggetto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Il corpo che il flusso 14 riceve: `venditore` è l'email dell'agente. È una funzione a parte perché la prova di
 * contratto (tests/unit/agenti/contratto-n8n.test.ts) lo fa passare dal nodo vero «Controlla il lavoro»: il
 * 26/11 il collaudo ha trovato che sito e n8n si aspettavano due forme diverse, e nessuna prova se ne accorgeva.
 */
export function corpoLavoro(lavoro: string, venditore: string, nome: string, prima: unknown, job: Lavoro) {
  return { lavoro, venditore, nome, prima, ...job };
}

export async function avviaLavoro(lavoro: string, venditore: string, nome: string, prima: unknown, job: Lavoro): Promise<{ ok: boolean; errore?: string }> {
  if (!adCollegato()) return { ok: false, errore: 'il collegamento con l’AD non è ancora acceso (manca N8N_SCHEDA_SEGRETO su Vercel)' };
  try {
    const r = await fetch(`${base()}/scheda-venditore`, {
      method: 'POST', signal: AbortSignal.timeout(8000), cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-scheda-segreto': segreto() },
      body: JSON.stringify(corpoLavoro(lavoro, venditore, nome, prima, job)),
    });
    const corpo = oggetto(comeJson(await r.text()));
    if (r.ok && corpo?.ok === true) return { ok: true };
    return { ok: false, errore: corpo?.errore ? String(corpo.errore).slice(0, 200) : `n8n ha risposto ${r.status}${corpo ? '' : ' senza conferma'}` };
  } catch {
    return { ok: false, errore: 'n8n non risponde' };
  }
}

export async function leggiLavoro(lavoro: string): Promise<StatoLavoro> {
  if (!adCollegato()) return { stato: 'sconosciuto', errore: 'collegamento con l’AD non acceso' };
  try {
    const r = await fetch(`${base()}/scheda-venditore-risultato?lavoro=${encodeURIComponent(lavoro)}`, {
      signal: AbortSignal.timeout(8000), headers: { 'x-scheda-segreto': segreto() }, cache: 'no-store',
    });
    const corpo = oggetto(comeJson(await r.text()));
    if (!r.ok || !corpo || typeof corpo.stato !== 'string') return { stato: 'sconosciuto', errore: `n8n ha risposto ${r.status}` };
    const json = (v: unknown) => (typeof v === 'string' ? comeJson(v) : v);
    const avvisi = json(corpo.avvisi);
    return {
      stato: (['in_corso', 'pronta', 'errore'] as const).includes(corpo.stato as 'in_corso') ? (corpo.stato as StatoLavoro['stato']) : 'sconosciuto',
      venditore: typeof corpo.venditore === 'string' ? corpo.venditore.toLowerCase() : null,
      prima: json(corpo.prima), risultato: json(corpo.risultato),
      avvisi: Array.isArray(avvisi) ? avvisi.map((a) => String(a ?? '').trim()).filter(Boolean) : [],
      errore: corpo.errore ? String(corpo.errore).slice(0, 300) : null,
      secondi: typeof corpo.secondi === 'number' ? corpo.secondi : null,
    };
  } catch {
    return { stato: 'sconosciuto', errore: 'n8n non risponde' };
  }
}

/** Le ultime schede di un agente (al massimo 20), dalla tabella n8n «Schede per il venditore». */
export async function elencoSchede(email: string): Promise<SchedaInElenco[]> {
  if (!adCollegato()) return [];
  try {
    const r = await fetch(`${base()}/venditori-scheda`, {
      method: 'POST', signal: AbortSignal.timeout(8000), cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-scheda-segreto': segreto() },
      body: JSON.stringify({ azione: 'elenco', email }),
    });
    const corpo = oggetto(comeJson(await r.text()));
    const schede = Array.isArray(corpo?.schede) ? corpo.schede : [];
    return schede.map(oggetto).filter((s): s is Record<string, unknown> => !!s && typeof s.lavoro === 'string').slice(0, 20)
      .map((s) => ({ lavoro: String(s.lavoro), nome: String(s.nome ?? 'Scheda'), stato: String(s.stato ?? 'in_corso'), iniziato: typeof s.iniziato === 'number' ? s.iniziato : null }));
  } catch {
    return [];
  }
}
