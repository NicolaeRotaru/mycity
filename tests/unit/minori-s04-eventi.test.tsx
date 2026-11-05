/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 5/11/2026 (S04) — La pagina Eventi diceva cose non vere:
 *  - prometteva una notifica all'inizio dell'evento, che nessuno manda (scheda 1712);
 *  - teneva in pagina un evento finito, «Termina 2 giorni fa», e chiamava «Inizia 3h fa» uno già
 *    cominciato (1713);
 *  - dopo «Partecipa» il numero dei partecipanti restava quello di prima fino a un minuto (1714);
 *  - con la lettura caduta diceva «Nessun evento programmato» (422).
 * Qui la pagina si monta e si guarda cosa c'è a schermo.
 */

const avvisi = vi.hoisted(() => ({ ok: [] as string[], ko: [] as string[] }));
vi.mock('sonner', () => ({
  toast: {
    success: (t: string) => avvisi.ok.push(t),
    error: (t: string) => avvisi.ko.push(t),
  },
}));

const g = globalThis as Record<string, unknown>;
const ORA = Date.now();
const ore = (n: number) => new Date(ORA + n * 3_600_000).toISOString();

function evento(sopra: Record<string, unknown>) {
  return {
    id: 'ev', title: 'Evento', description: 'd', cover_image_url: null,
    starts_at: ore(24), ends_at: ore(30), discount_percent: null, cta_label: 'Partecipa',
    cta_url: null, status: 'scheduled', sponsor_seller_id: null, sponsor: null,
    ...sopra,
  };
}

function datiDellaPagina(eventi: unknown[]) {
  g.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey[1] === 'public' ? eventi : {});
}

async function pagina() {
  const mod = await monta('app/events/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  return s;
}

afterEach(() => {
  for (const k of ['__DATI_QUERY__', '__ESITO_QUERY__', '__OPZIONI_QUERY__', '__RISPOSTA_SUPABASE__', '__UTENTE__',
    '__MUTAZIONI_VERE__', '__MUTAZIONI_IN_VOLO__', '__RILETTURE__']) delete g[k];
  avvisi.ok.length = 0;
  avvisi.ko.length = 0;
  document.body.innerHTML = '';
});

describe('la pagina Eventi', () => {
  it('non promette una notifica che nessuno manda (1712)', async () => {
    datiDellaPagina([evento({ id: 'a' })]);
    const s = await pagina();
    expect(testoVisibile(s.radice)).not.toMatch(/notific|ricorder/i);
  });

  it('un evento finito non resta in pagina, anche se è ancora «live» (1713)', async () => {
    datiDellaPagina([
      evento({ id: 'finito', title: 'Flash di domenica', status: 'live', starts_at: ore(-60), ends_at: ore(-48) }),
      evento({ id: 'domani', title: 'Mercatino di domani' }),
    ]);
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toContain('Flash di domenica');
    expect(testo).toContain('Mercatino di domani');
  });

  it('chiede al database solo gli eventi non ancora finiti (1713)', async () => {
    const opzioni: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
    g.__OPZIONI_QUERY__ = opzioni;
    datiDellaPagina([]);
    await pagina();
    const chiamate: Array<[string, unknown[]]> = [];
    const catena: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'gt', 'gte', 'eq', 'order']) {
      catena[m] = (...a: unknown[]) => { chiamate.push([m, a]); return catena; };
    }
    catena.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
    g.__CLIENT_SUPABASE__ = { from: () => catena, rpc: async () => ({ data: [], error: null }) };
    try {
      await opzioni.find((o) => o.queryKey[1] === 'public')!.queryFn();
    } finally {
      delete g.__CLIENT_SUPABASE__;
    }
    const fine = chiamate.find(([m, a]) => (m === 'gt' || m === 'gte') && a[0] === 'ends_at');
    expect(fine).toBeTruthy();
    expect(Math.abs(Date.parse(String(fine![1][1])) - Date.now())).toBeLessThan(60_000);
  });

  it('un evento «programmato» già cominciato si dice in corso, non «Inizia 3h fa» (1713)', async () => {
    datiDellaPagina([evento({ id: 'b', status: 'scheduled', starts_at: ore(-3), ends_at: ore(3) })]);
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Inizia \d+h fa/);
    expect(testo).toMatch(/Termina tra/);
  });

  it('con la lettura caduta non dice «nessun evento», dice di riprovare (422)', async () => {
    datiDellaPagina([]);
    g.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      o.queryKey[1] === 'public' ? { data: undefined, isError: true, isSuccess: false } : undefined;
    const s = await pagina();
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/Nessun evento/);
    expect(testo).toMatch(/Non riesco a leggere gli eventi/);
  });

  it('la lettura che cade fa cadere la query, invece di diventare una lista vuota (422)', async () => {
    const opzioni: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
    g.__OPZIONI_QUERY__ = opzioni;
    datiDellaPagina([]);
    await pagina();
    g.__RISPOSTA_SUPABASE__ = { data: null, error: { message: 'rete caduta' } };
    const lettura = opzioni.find((o) => o.queryKey[1] === 'public')!;
    await expect(lettura.queryFn()).rejects.toBeTruthy();
  });

  it('il conto dei partecipanti non letto non diventa «0 partecipanti» (1714)', async () => {
    const opzioni: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
    g.__OPZIONI_QUERY__ = opzioni;
    datiDellaPagina([]);
    await pagina();
    g.__CLIENT_SUPABASE__ = { from: () => ({}), rpc: async () => ({ data: null, error: { message: 'rete caduta' } }) };
    try {
      await expect(opzioni.find((o) => o.queryKey[1] === 'rsvp-counts')!.queryFn()).rejects.toBeTruthy();
    } finally {
      delete g.__CLIENT_SUPABASE__;
    }
  });

  it('dopo «Partecipa» rilegge anche il numero dei partecipanti, e non promette promemoria (1714, 1712)', async () => {
    g.__UTENTE__ = { id: 'u-anna' };
    g.__MUTAZIONI_VERE__ = true;
    const inVolo: Promise<unknown>[] = [];
    g.__MUTAZIONI_IN_VOLO__ = inVolo;
    const riletture: unknown[] = [];
    g.__RILETTURE__ = riletture;
    datiDellaPagina([evento({ id: 'c', cta_label: 'Partecipa' })]);
    const s = await pagina();
    await attendi();
    const bottone = [...s.radice.querySelectorAll('button')].find((b) => /Partecipa/.test(b.textContent ?? ''))!;
    s.agisci(() => clicca(bottone));
    await Promise.all(inVolo);
    expect(riletture).toContainEqual(['events', 'rsvp-counts']);
    expect(avvisi.ok.join(' ')).not.toMatch(/ricorder|notific/i);
  });
});
