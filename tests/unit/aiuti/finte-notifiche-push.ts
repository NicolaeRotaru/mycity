/**
 * Il finto `from('notifications')` delle prove del giro delle push (app/api/cron/send-push).
 *
 * 28/11/2026 (R03-016) — Il giro adesso PRENDE le notifiche prima di mandarle (`pushed_at` da vuoto
 * all'ora della presa, con `select`) e ridà al giro dopo quelle non partite (`pushed_at` di nuovo
 * vuoto, solo dove c'è ancora la sua presa). I finti che contavano «la scrittura che segna» non
 * bastano più: qui le righe stanno in memoria, ogni scrittura le cambia davvero, e «segnate» è quello
 * che resta con `pushed_at` pieno alla fine del giro.
 */
export type RigaNotifica = Record<string, unknown> & { id: string };

/** Le categorie che il giro tiene indietro quando rilegge solo le urgenti (`or(... not.in ...)`). */
const CHE_ASPETTANO = ['promo', 'group', 'newsletter'];

type Esito = { data: unknown; error: unknown };

export function tabellaNotifiche(
  righe: () => RigaNotifica[],
  opzioni: { erroreLettura?: () => { message: string } | null } = {},
) {
  let op: 'select' | 'update' = 'select';
  let valori: Record<string, unknown> = {};
  let tetto = Number.POSITIVE_INFINITY;
  let senzaAttese = false;
  const filtri: Array<(r: RigaNotifica) => boolean> = [];
  const esegui = async (): Promise<Esito> => {
    if (op === 'select') {
      const errore = opzioni.erroreLettura?.() ?? null;
      if (errore) return { data: null, error: errore };
    }
    const scelte = righe().filter(
      (r) => filtri.every((f) => f(r)) && (!senzaAttese || !CHE_ASPETTANO.includes(String(r.category))),
    );
    if (op === 'update') {
      for (const r of scelte) Object.assign(r, valori);
      // Le righe scritte, intere: il giro ne legge l'id, l'invio subito (lib/push/subito.ts) tutto.
      return { data: scelte.map((r) => ({ ...r })), error: null };
    }
    return { data: scelte.slice(0, tetto).map((r) => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    order: () => b,
    // La finestra dell'ultima ora: le righe delle prove sono tutte recenti.
    gte: () => b,
    or: (s: string) => { senzaAttese = s.includes('not.in'); return b; },
    is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return b; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return b; },
    limit: (n: number) => { tetto = n; return b; },
    update: (v: Record<string, unknown>) => { op = 'update'; valori = v; return b; },
    then: (ok: (v: Esito) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
  };
  return b;
}

/** Le notifiche rimaste segnate (`pushed_at` pieno) alla fine del giro. */
export function segnateIn(righe: RigaNotifica[]): string[] {
  return righe.filter((r) => r.pushed_at).map((r) => r.id);
}
