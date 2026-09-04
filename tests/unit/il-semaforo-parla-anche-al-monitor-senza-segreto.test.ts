import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 31/8/2026 (R183, secondo giro) — IL SEMAFORO ERA CIECO PROPRIO PER CHI LO
 * GUARDA, ED ERA VERDE ANCHE QUANDO NON AVEVA GUARDATO NIENTE.
 *
 * Due guasti che si tenevano per mano.
 *
 * ① Il controllo sui battiti dei lavori periodici veniva calcolato solo dentro
 *    `if (autorizzato)`, e in produzione «autorizzato» vuol dire aver mandato
 *    il segreto dei cron nell'intestazione. Ma chi interroga questa rotta e' il
 *    monitor esterno (UptimeRobot / BetterStack, CHANGELOG:44), e quel segreto
 *    non lo manda: con tutti e dieci i lavori fermi da dieci giorni riceveva
 *    200 e {"status":"ok"}. Le prove che c'erano non mettevano mai
 *    NODE_ENV=production, quindi provavano l'unico ramo che il monitor vero non
 *    usa: la versione comoda del difetto.
 *
 * ② Con la tabella dei battiti vuota — ogni ambiente nuovo, ogni ripristino del
 *    database — il controllo rispondeva {"ok":true}: zero lavori esaminati,
 *    spunta verde. E da fuori un verde su zero e un verde su dieci erano
 *    indistinguibili, perche' il conto di quante cose aveva guardato non
 *    compariva da nessuna parte nella risposta.
 *
 * Queste prove chiamano la rotta come la chiama il monitor vero: in produzione
 * e senza intestazione di autorizzazione.
 */

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
      // La query di vivacita' del database risponde bene: l'unica cosa che puo'
      // far cambiare colore al semaforo sono i battiti.
      return { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { GET } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { esitoBattiti } from '@/lib/cron-health';

/**
 * Quanti lavori periodici esistono davvero, contati sul disco e non chiesti al
 * codice che sto collaudando: se il conto arrivasse da `lib/cron-health.ts`, un
 * elenco di soglie dimezzato farebbe passare queste prove lo stesso.
 */
function lavoriSulDisco(): string[] {
  const cartella = join(process.cwd(), 'app/api/cron');
  return readdirSync(cartella, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(cartella, d.name, 'route.ts')))
    .map((d) => d.name)
    .sort();
}

const LAVORI = lavoriSulDisco();
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let contatore = 0;
/** La richiesta del monitor esterno: viene da internet e non ha nessun segreto. */
function richiestaDelMonitor(): Request {
  contatore++;
  return new Request('https://mycity.test/api/health', {
    headers: { 'x-forwarded-for': `198.51.100.${contatore % 250}` },
  });
}

async function cosaVedeIlMonitor() {
  const res = await GET(richiestaDelMonitor());
  const corpo = await res.json();
  return { http: res.status, corpo, testo: JSON.stringify(corpo) };
}

describe('quello che il monitor esterno vede quando i lavori periodici si fermano', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    __resetRateLimitBuckets();
    stato.errore = null;
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: minutiFa(1) }));
    const completo: Record<string, string> = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      CRON_SECRET: 'segreto-dei-lavori-periodici',
    };
    for (const k of [
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
      'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'INTERNAL_API_SECRET',
      'UNSUBSCRIBE_SECRET', 'MIDDLEWARE_CACHE_SECRET', 'SUPPORT_EMAIL', 'TURNSTILE_SECRET_KEY',
      'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AI_GLOBAL_DAILY_BUDGET_EUR',
    ]) completo[k] = 'x';
    // Il monitor vero chiama il sito in produzione: e' l'unico ramo che conta.
    // L'ambiente si sostituisce tutto insieme perche' NODE_ENV, sull'oggetto
    // vero di Node, non si lascia riscrivere pezzo per pezzo.
    process.env = { ...salvato, ...completo, NODE_ENV: 'production' };
  });

  afterEach(() => {
    process.env = { ...salvato };
  });

  it('con tutti i lavori fermi da dieci giorni, chi sorveglia il sito lo legge', async () => {
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: minutiFa(10 * 24 * 60) }));
    const { http, corpo, testo } = await cosaVedeIlMonitor();
    expect(http).toBe(200);
    expect(
      corpo.status,
      `pagamenti, email e notifiche sono fermi da dieci giorni e il monitor legge «${corpo.status}»`,
    ).toBe('degraded');
    for (const lavoro of LAVORI) {
      expect(testo, `nella risposta non compare il lavoro fermo «${lavoro}»`).toContain(lavoro);
    }
  });

  it('con la tabella dei battiti vuota non dice «tutto a posto»: dice che non ha guardato niente', async () => {
    stato.battiti = [];
    const { corpo } = await cosaVedeIlMonitor();
    expect(
      corpo.cron?.esaminati,
      'la risposta non dice quanti lavori ha guardato, e un verde su zero sembra un verde su dieci',
    ).toBe(0);
    expect(corpo.cron?.attesi, 'la risposta non dice quanti lavori dovrebbe guardare').toBe(LAVORI.length);
    expect(
      corpo.cron?.ok,
      'ha esaminato zero lavori e mette lo stesso la spunta verde: succede a ogni ambiente nuovo e dopo ogni ripristino del database',
    ).toBe(false);
    expect(corpo.status, 'zero lavori guardati e il semaforo resta verde').toBe('degraded');
  });

  it('se nessun lavoro ha mai battuto un colpo, il semaforo non e verde', async () => {
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: null }));
    const { corpo } = await cosaVedeIlMonitor();
    expect(corpo.cron?.esaminati, 'nessun battito leggibile, eppure dice di averne guardati').toBe(0);
    expect(
      corpo.cron?.ok,
      'tutti i lavori periodici sono fermi dal primo giorno e la risposta dice che va tutto bene',
    ).toBe(false);
    expect(corpo.status).toBe('degraded');
  });

  it('un verde su un lavoro solo non si confonde piu con un verde su dieci', async () => {
    stato.battiti = [{ name: LAVORI[0], last_run_at: minutiFa(1) }];
    const { corpo, testo } = await cosaVedeIlMonitor();
    expect(corpo.cron?.esaminati, 'un solo lavoro ha battuto, ma la risposta non lo dice').toBe(1);
    expect(corpo.cron?.attesi).toBe(LAVORI.length);
    expect(
      corpo.cron?.ok,
      `ha guardato 1 lavoro su ${LAVORI.length} e si dichiara sano: gli altri nove possono essere fermi da mesi`,
    ).toBe(false);
    for (const lavoro of LAVORI.slice(1)) {
      expect(
        testo,
        `il lavoro «${lavoro}» non l'ha mai visto battere e non lo nomina a nessuno`,
      ).toContain(lavoro);
    }
  });

  it('quando i dieci lavori battono davvero, il monitor legge verde e il conto lo dimostra', async () => {
    const { http, corpo } = await cosaVedeIlMonitor();
    expect(http).toBe(200);
    expect(corpo.status, `si lamenta di: ${JSON.stringify(corpo.cron)}`).toBe('ok');
    expect(corpo.cron?.ok).toBe(true);
    expect(corpo.cron?.esaminati, 'dice verde ma non dimostra quanti lavori ha guardato').toBe(LAVORI.length);
    expect(corpo.cron?.attesi).toBe(LAVORI.length);
  });

  it('se i battiti non si riescono a leggere, al monitor non arriva un verde', async () => {
    stato.errore = { message: 'connection refused' };
    const { corpo } = await cosaVedeIlMonitor();
    expect(
      corpo.cron?.ok,
      'non ha potuto leggere nemmeno un battito e risponde lo stesso «tutto a posto»',
    ).toBe(false);
    expect(corpo.status).toBe('degraded');
  });

  /**
   * Il modo piu' silenzioso di riaprire il buco: svuotare l'elenco delle soglie.
   * Zero lavori attesi, zero esaminati, «li ho guardati tutti» — e il semaforo
   * tornerebbe verde su niente, che e' esattamente il difetto di partenza con
   * un'altra faccia.
   */
  it('un elenco di soglie vuoto non e un verde: e un controllo che non guarda niente', () => {
    const esito = esitoBattiti([], Date.now(), {});
    expect(esito.attesi).toBe(0);
    expect(
      esito.ok,
      'nessun lavoro da sorvegliare e la risposta si dichiara sana: verde su niente',
    ).toBe(false);
  });

  it('al monitor senza segreto escono i nomi dei lavori, non i segreti del sito', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    stato.errore = { message: 'permission denied for table cron_heartbeats' };
    const { testo } = await cosaVedeIlMonitor();
    expect(testo, 'dice a chiunque quale segreto manca: e una mappa di dov e scoperto il sito').not.toContain(
      'STRIPE_SECRET_KEY',
    );
    expect(testo, 'ripete a chiunque il messaggio grezzo del database').not.toContain('permission denied');
    expect(testo, 'lascia uscire il segreto dei lavori periodici').not.toContain('segreto-dei-lavori-periodici');
    expect(testo, 'la latenza interna e l elenco dei controlli restano roba di casa').not.toContain('checks');
  });

  /**
   * Il messaggio grezzo del database non e' stato buttato: e' stato spostato.
   * Se sparisse, chi ripara alle tre di notte perderebbe l'unica riga che dice
   * PERCHE' i battiti non si leggono — e questo sarebbe un altro modo di
   * rompere il semaforo, piu' silenzioso del primo.
   */
  it('chi ha il segreto vede anche perche i battiti non si leggono', async () => {
    stato.errore = { message: 'permission denied for table cron_heartbeats' };
    const res = await GET(
      new Request('https://mycity.test/api/health', {
        headers: {
          'x-forwarded-for': '203.0.113.44',
          authorization: 'Bearer segreto-dei-lavori-periodici',
        },
      }),
    );
    const corpo = await res.json();
    expect(corpo.checks?.cron?.ok).toBe(false);
    expect(
      corpo.checks?.cron?.dettaglio,
      'chi entra col segreto per capire cosa e successo non trova il motivo da nessuna parte',
    ).toContain('permission denied');
  });
});
