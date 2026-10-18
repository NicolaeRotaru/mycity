import { logger } from '@/lib/logger';

/**
 * CHI HA CREATO UNA LISTA, LETTO SENZA APRIRE LA TABELLA DEI PROFILI.
 *
 * 18/10/2026 — Le liste curate (`/lists` e `/lists/[id]`) mostrano «@handle» di chi le ha
 * create, col link al suo profilo pubblico. Il nome arrivava agganciando la lista alla tabella
 * `profiles` dal browser: funzionava solo grazie alla regola «chi ha il profilo pubblico si legge
 * da tutti», che le migrazioni 110 e 161 tolgono. Dopo, ogni lista avrebbe perso il suo autore.
 *
 * Una vista nuova leggibile da chi non ha l'account non si fa (romperebbe il guardiano delle
 * viste pubbliche), quindi l'handle lo chiede il browser a una rotta del server
 * (`/api/profili-pubblici`), che lo legge col client di servizio.
 *
 * COSA ESPONE LA ROTTA, e niente di piu': per gli id che le si chiedono, l'id e l'handle di chi
 * ha ACCESO il profilo pubblico (`public_profile_enabled = true`). Niente nome, niente email,
 * niente foto o bio: alle liste serve solo l'handle. Chi il profilo pubblico non l'ha acceso, per
 * la rotta non esiste. E' meno di quanto si legge oggi in produzione, dove la regola del profilo
 * pubblico apre la riga intera.
 */

/** Quante persone si possono chiedere in una volta: le liste ne mostrano al piu' 24 per volta. */
export const MASSIMO_PROFILI_PER_DOMANDA = 50;

const FORMA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HandlePubblico = { id: string; public_handle: string };

/**
 * Gli id chiesti alla rotta, ripuliti: senza doppioni e solo nella forma di un id vero.
 * `null` se la domanda non va accettata (nessun id, troppi, o uno scritto male).
 */
export function idDaChiedere(valori: string[]): string[] | null {
  const unici = [...new Set(valori.map((v) => v.trim()).filter(Boolean))];
  if (unici.length === 0 || unici.length > MASSIMO_PROFILI_PER_DOMANDA) return null;
  if (!unici.every((v) => FORMA_ID.test(v))) return null;
  return unici;
}

/** Il minimo che serve: il client di servizio, o un suo finto nelle prove. */
type LettoreProfili = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tabella: string) => any;
};

/**
 * Sul server, col client di servizio: gli handle di chi ha il profilo pubblico acceso.
 *
 * ⚠️ Il client di servizio non guarda le regole del database: i due limiti qui sotto — le sole
 * colonne `id, public_handle` e il filtro `public_profile_enabled = true` — sono l'unica cosa che
 * separa questa rotta dalla tabella intera. Non vanno mai tolti.
 */
export async function leggiHandlePubblici(admin: LettoreProfili, ids: string[]): Promise<HandlePubblico[]> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, public_handle')
    .in('id', ids)
    .eq('public_profile_enabled', true);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; public_handle: string | null }>)
    .filter((r): r is HandlePubblico => typeof r.public_handle === 'string' && r.public_handle.length > 0)
    .map((r) => ({ id: r.id, public_handle: r.public_handle }));
}

export type AutorePubblico = { public_handle: string };

/** Quanto le liste aspettano al massimo l'autore, prima di mostrarsi senza «@handle». */
export const ATTESA_MASSIMA_AUTORI_MS = 3000;

/**
 * Nel browser: attacca a ogni lista l'handle pubblico di chi l'ha creata, chiedendolo alla rotta.
 *
 * Se la rotta non risponde, o non risponde entro `ATTESA_MASSIMA_AUTORI_MS`, le liste si vedono lo
 * stesso, senza «@handle»: l'autore e' un dettaglio, la lista no. Senza il tetto, una rotta lenta
 * (per esempio alla prima chiamata dopo un po' di quiete) teneva le liste in caricamento.
 */
export async function conAutoriPubblici<T extends { owner_id: string }>(
  liste: T[],
  chiedi: typeof fetch = fetch,
  attesaMassimaMs: number = ATTESA_MASSIMA_AUTORI_MS,
): Promise<Array<T & { owner: AutorePubblico | null }>> {
  const ids = [...new Set(liste.map((l) => l.owner_id).filter(Boolean))];
  const handle = new Map<string, string>();
  if (ids.length > 0) {
    const ferma = new AbortController();
    let sveglia: ReturnType<typeof setTimeout> | undefined;
    try {
      const domanda = new URLSearchParams(ids.map((id) => ['id', id]));
      const lettura = (async () => {
        const risposta = await chiedi(`/api/profili-pubblici?${domanda.toString()}`, { signal: ferma.signal });
        return { risposta, corpo: (await risposta.json()) as { ok?: boolean; data?: unknown } };
      })();
      // Se vince il tempo, la lettura interrotta rifiuta piu' tardi: non deve restare un rifiuto orfano.
      lettura.catch(() => {});
      const tempo = new Promise<never>((_, rifiuta) => {
        sveglia = setTimeout(() => {
          ferma.abort();
          rifiuta(new Error(`autori delle liste: nessuna risposta in ${attesaMassimaMs} ms`));
        }, attesaMassimaMs);
      });
      const { risposta, corpo } = await Promise.race([lettura, tempo]);
      if (risposta.ok && corpo?.ok === true && Array.isArray(corpo.data)) {
        for (const p of corpo.data as HandlePubblico[]) handle.set(p.id, p.public_handle);
      } else {
        logger.warn('[liste] autori delle liste non letti', { stato: risposta.status });
      }
    } catch (e) {
      logger.warn('[liste] autori delle liste non letti', e);
    } finally {
      clearTimeout(sveglia);
    }
  }
  return liste.map((l) => {
    const h = handle.get(l.owner_id);
    return { ...l, owner: h ? { public_handle: h } : null };
  });
}
