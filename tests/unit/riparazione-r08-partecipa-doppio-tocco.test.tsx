/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 21/11/2026 (R08) — «PARTECIPA» TOCCATO DUE VOLTE, E L'EVENTO APPENA FINITO.
 *
 * In palestra (7/11), col doppio tocco su «Partecipa» partivano due scritture: una entrava, l'altra
 * tornava «già usato», e sotto «Ci sei!» compariva «Questo valore è già stato usato». Con le proprie
 * iscrizioni non lette, «Partecipa» su un evento dove eri già iscritto dava lo stesso errore.
 * E un evento finito mentre la pagina era aperta restava premibile fino al ridisegno: il tocco su
 * «Ci sei» cancellava l'iscrizione all'evento appena chiuso.
 *
 * Qui la pagina vera si monta con un database finto delle iscrizioni (una riga per persona ed
 * evento, il doppione risponde 23505 come Postgres) e un orologio finto.
 */

const avvisi = vi.hoisted(() => ({ ok: [] as string[], ko: [] as string[] }));
vi.mock('sonner', () => ({
  toast: {
    success: (t: string) => avvisi.ok.push(t),
    error: (t: string) => avvisi.ko.push(t),
  },
}));

const g = globalThis as Record<string, unknown>;
const T0 = Date.parse('2026-11-07T18:00:00Z');
const FINE = new Date(T0 + 150_000).toISOString(); // l'evento finisce fra 150 secondi

function evento(sopra: Record<string, unknown> = {}) {
  return {
    id: 'e1', title: 'Mercatino dal vivo', description: 'd', cover_image_url: null,
    starts_at: new Date(T0 - 3_600_000).toISOString(), ends_at: FINE, discount_percent: null,
    cta_label: 'Partecipa', cta_url: null, status: 'live', sponsor_seller_id: null, sponsor: null,
    ...sopra,
  };
}

/** Le iscrizioni come le tiene Postgres: chiave (persona, evento), il doppione è 23505. */
function iscrizioni(gia: string[] = [], opzioni: { letturaCaduta?: boolean } = {}) {
  const righe = new Set(gia);
  const scritture: string[] = [];
  const client = {
    from: (tavola: string) => {
      if (tavola !== 'event_rsvps') throw new Error('tavola inattesa: ' + tavola);
      let azione: 'leggi' | 'inserisci' | 'cancella' = 'leggi';
      let riga: { event_id?: string } = {};
      const filtri: Record<string, unknown> = {};
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (k: string, v: unknown) => { filtri[k] = v; return c; };
      c.insert = (r: { event_id: string }) => { azione = 'inserisci'; riga = r; return c; };
      c.delete = () => { azione = 'cancella'; return c; };
      c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(() => {
        if (azione === 'leggi') {
          return opzioni.letturaCaduta
            ? { data: null, error: { message: 'lettura caduta' } }
            : { data: [...righe].map((event_id) => ({ event_id })), error: null };
        }
        if (azione === 'inserisci') {
          scritture.push('insert');
          if (righe.has(String(riga.event_id))) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "event_rsvps_pkey"' } };
          }
          righe.add(String(riga.event_id));
          return { data: null, error: null };
        }
        scritture.push('delete');
        righe.delete(String(filtri.event_id));
        return { data: null, error: null };
      }).then(ok, ko);
      return c;
    },
    rpc: async () => ({ data: [], error: null }),
  };
  return { righe, scritture, client };
}

async function pagina(eventi: unknown[], db: ReturnType<typeof iscrizioni>) {
  g.__UTENTE__ = { id: 'u-cliente' };
  g.__MUTAZIONI_VERE__ = true;
  const inVolo: Promise<unknown>[] = [];
  g.__MUTAZIONI_IN_VOLO__ = inVolo;
  g.__CLIENT_SUPABASE__ = db.client;
  g.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey[1] === 'public' ? eventi : {});
  const mod = await monta('app/events/page.tsx');
  const s = accendi(mod.default);
  for (let i = 0; i < 4; i++) await attendi();
  const bottone = () => [...s.radice.querySelectorAll('button')].find((b) => /Partecipa|Ci sei/.test(b.textContent ?? ''));
  return { s, inVolo, bottone };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of ['__DATI_QUERY__', '__UTENTE__', '__MUTAZIONI_VERE__', '__MUTAZIONI_IN_VOLO__', '__CLIENT_SUPABASE__']) delete g[k];
  avvisi.ok.length = 0;
  avvisi.ko.length = 0;
  document.body.innerHTML = '';
});

describe('«Partecipa» sulla pagina Eventi', () => {
  it('il doppio tocco dà un solo «Ci sei!» e nessun errore, e la riga è una', async () => {
    const db = iscrizioni();
    const { s, inVolo, bottone } = await pagina([evento()], db);
    const b = bottone()!;
    expect(b).toBeTruthy();
    s.agisci(() => { clicca(b); clicca(b); });
    await Promise.all(inVolo);
    await attendi();
    expect(avvisi.ko, 'nessun avviso d\'errore dopo il doppio tocco').toEqual([]);
    expect(avvisi.ok.filter((t) => /Ci sei/.test(t))).toHaveLength(1);
    expect([...db.righe]).toEqual(['e1']);
  });

  it('con le proprie iscrizioni non lette, «Partecipa» dove sei già iscritto dice «Ci sei!», non un errore', async () => {
    const db = iscrizioni(['e1'], { letturaCaduta: true });
    const { s, inVolo, bottone } = await pagina([evento()], db);
    const b = bottone()!;
    expect(b.textContent).toMatch(/Partecipa/);
    s.agisci(() => clicca(b));
    await Promise.all(inVolo);
    await attendi();
    expect(avvisi.ko).toEqual([]);
    expect(avvisi.ok.join(' ')).toMatch(/Ci sei/);
    expect(testoVisibile(s.radice)).toMatch(/Ci sei/);
  });

  it('un evento finito mentre la pagina è aperta non si preme più, senza aspettare il ridisegno', async () => {
    const db = iscrizioni(['e1']);
    const { s, inVolo, bottone } = await pagina([evento()], db);
    const b = bottone()!;
    expect(b.textContent).toMatch(/Ci sei/);
    // Cinque secondi dopo la fine: nessun ridisegno è ancora passato.
    vi.setSystemTime(Date.parse(FINE) + 5_000);
    s.agisci(() => clicca(b));
    await Promise.all(inVolo);
    await attendi();
    expect(db.scritture, 'nessuna scrittura su un evento finito').toEqual([]);
    expect(avvisi.ok.join(' ')).not.toMatch(/Cancellazione/);
    expect([...db.righe]).toEqual(['e1']);
    expect(testoVisibile(s.radice)).not.toContain('Mercatino dal vivo');
  });
});
