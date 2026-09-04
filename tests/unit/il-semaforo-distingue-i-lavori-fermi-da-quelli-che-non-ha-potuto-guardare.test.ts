/**
 * 3/9/2026 (R183, quarto giro) — «NON HO POTUTO GUARDARE» USCIVA IDENTICO A «I
 * LAVORI SONO FERMI».
 *
 * Le due porte di salute rispondevano `{ok: false}` in tutti e due i casi, con
 * la differenza nascosta dentro una frase in italiano. Ma chi legge quella
 * risposta è un programma di sorveglianza — che di frasi non capisce niente — o
 * una persona alle tre di notte, e i due casi vogliono due mestieri diversi:
 *
 *   fermi      → i lavori periodici hanno smesso di girare: si guarda lo
 *                scheduler, il rilascio, il segreto dei cron.
 *   non_letti  → la sorveglianza è cieca: permessi del database, chiave di
 *                servizio, tabella irraggiungibile. I lavori possono girare
 *                benissimo, e chi va a farli ripartire perde la notte.
 *
 * È successo davvero: il 3/9 in produzione la risposta era «battiti non
 * leggibili» — cioè il secondo caso, causato da una variabile mancante — e la
 * scheda che l'ha raccolta ha letto «i cron sono fermi». Un cartello che si fa
 * leggere al contrario manda a cercare nel posto sbagliato.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { esitoBattiti, SOGLIE_VISTE_DA_FUORI } from '@/lib/cron-health';

type Battito = { name: string; last_run_at: string | null };

const stato: { battiti: Battito[]; errore: { message: string } | null } = {
  battiti: [],
  errore: null,
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'cron_heartbeats') {
        return { select: () => Promise.resolve({ data: stato.battiti, error: stato.errore }) };
      }
      return { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { GET as VIVO } from '@/app/api/health/route';
import { GET as PRONTO } from '@/app/api/health/ready/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/** I lavori periodici contati sul disco, non chiesti al codice che collaudo. */
function lavoriSulDisco(): string[] {
  const cartella = join(process.cwd(), 'app/api/cron');
  return readdirSync(cartella, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(cartella, d.name, 'route.ts')))
    .map((d) => d.name);
}

const LAVORI = lavoriSulDisco();
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let contatore = 0;
function richiestaDelMonitor(percorso: string) {
  contatore++;
  return new Request(`https://mycity.test${percorso}`, {
    headers: { 'x-forwarded-for': `203.0.113.${contatore % 250}` },
  }) as never;
}

async function cosaVede(porta: 'viva' | 'pronta') {
  const res = porta === 'viva'
    ? await (VIVO as unknown as (r: unknown) => Promise<Response>)(richiestaDelMonitor('/api/health'))
    : await PRONTO(richiestaDelMonitor('/api/health/ready'));
  const corpo = await res.json();
  return { http: res.status, cron: corpo.cron as { stato?: string; ok?: boolean; error?: string } };
}

describe('il semaforo dei lavori periodici dice PERCHÉ, in una parola', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    __resetRateLimitBuckets();
    stato.errore = null;
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: minutiFa(1) }));
    process.env = {
      ...salvato,
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      CRON_SECRET: 'segreto-dei-lavori-periodici',
      NODE_ENV: 'production',
    };
  });

  afterEach(() => { process.env = { ...salvato }; });

  it('quando i lavori battono regolarmente la parola è «ok»', async () => {
    const { cron } = await cosaVede('viva');
    expect(cron.stato, `si lamenta di: ${cron.error}`).toBe('ok');
    expect(cron.ok).toBe(true);
  });

  it('quando i lavori hanno smesso di battere la parola è «fermi»', async () => {
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: minutiFa(10 * 24 * 60) }));
    const { cron } = await cosaVede('viva');
    expect(cron.stato).toBe('fermi');
  });

  it('IL CASO CHE ROMPEVA — se i battiti non si leggono la parola NON è «fermi»', async () => {
    // È quello che succedeva in produzione: la tabella dei battiti si legge solo
    // con la chiave di servizio, quella chiave mancava, e la risposta faceva
    // sembrare fermi dieci lavori che nessuno aveva potuto guardare.
    stato.errore = { message: 'permission denied for table cron_heartbeats' };
    const { cron } = await cosaVede('viva');
    expect(
      cron.stato,
      'chi legge va a far ripartire dei lavori che girano benissimo, mentre il guasto è nei permessi',
    ).toBe('non_letti');
    expect(cron.ok, 'non aver potuto guardare non è un verde').toBe(false);
  });

  it('con la tabella dei battiti vuota la parola è «mai_visti», non «ok»', async () => {
    stato.battiti = [];
    const { cron } = await cosaVede('viva');
    expect(cron.stato, 'un verde su zero lavori sembrava un verde su dieci').toBe('mai_visti');
  });

  it('le due porte del sito dicono la stessa parola sullo stesso guasto', async () => {
    stato.errore = { message: 'permission denied for table cron_heartbeats' };
    const viva = await cosaVede('viva');
    const pronta = await cosaVede('pronta');
    expect(
      pronta.cron.stato,
      `«sei vivo?» dice ${viva.cron.stato} e «sei pronto?» dice ${pronta.cron.stato}: chi guarda non sa a quale credere`,
    ).toBe(viva.cron.stato);
  });

  it('un elenco di soglie vuoto è «non ho guardato niente», non «va tutto bene»', () => {
    // Il caso più silenzioso di tutti: zero lavori attesi, zero esaminati,
    // «tutti quelli che dovevo guardare li ho guardati» → verde, su niente.
    const esito = esitoBattiti([], Date.now(), {});
    expect(esito.stato).toBe('non_letti');
    expect(esito.ok).toBe(false);
  });

  it('la parola dice il guasto più grave: fermi batte mai_visti', () => {
    const nomi = Object.keys(SOGLIE_VISTE_DA_FUORI);
    // Uno fermo da dieci giorni, gli altri mai visti: chi legge deve andare a
    // guardare il lavoro morto, che è la cosa che sta facendo danno adesso.
    const esito = esitoBattiti(
      [{ name: nomi[0], last_run_at: minutiFa(10 * 24 * 60) }],
      Date.now(),
      SOGLIE_VISTE_DA_FUORI,
    );
    expect(esito.stato).toBe('fermi');
    expect(esito.error).toContain(nomi[0]);
  });
});
