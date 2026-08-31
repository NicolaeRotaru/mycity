import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 31/8/2026 (R183, terzo giro) — LA SECONDA PORTA DI SALUTE ERA RIMASTA CIECA.
 *
 * Il giro precedente ha aperto /api/health al monitor anonimo: con i lavori
 * periodici fermi, adesso, chi guarda legge «degraded» e i nomi dei lavori.
 * La porta accanto pero' e' rimasta indietro, ed e' la piu' guardata delle due:
 * /api/health/ready e' quella che il monitor esterno interroga per sapere se il
 * sito e' pronto a servire — e' persino nominata nel commento della riparazione
 * (app/api/health/route.ts:255).
 *
 * MISURATO: con tutti e dieci i lavori periodici fermi da dieci giorni, in
 * produzione e senza intestazione di autorizzazione, /api/health/ready
 * rispondeva 200 {"status":"ready"} e dei battiti non sapeva niente. Due porte
 * dello stesso sito raccontavano due verita' diverse, e chi guardava la piu'
 * autorevole delle due non vedeva niente.
 *
 * QUI SI SORVEGLIA CHE LE DUE PORTE USINO LO STESSO METRO. Il finto database
 * e' l'unica cosa sostituita: le soglie, il verdetto e il modo di raccontarlo
 * sono quelli veri di produzione, chiamati sulle rotte vere. Se qualcuno desse
 * a /ready un elenco di soglie tutto suo, o rimettesse i battiti dietro il
 * segreto, queste righe diventano rosse.
 */

type Battito = { name: string; last_run_at: string | null };

const stato: {
  battiti: Battito[];
  errore: { message: string } | null;
  erroreDb: { message: string } | null;
} = {
  battiti: [],
  errore: null,
  erroreDb: null,
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'cron_heartbeats') {
        return { select: () => Promise.resolve({ data: stato.battiti, error: stato.errore }) };
      }
      return { select: () => ({ limit: () => Promise.resolve({ error: stato.erroreDb }) }) };
    },
  })),
}));

import { GET as PRONTO } from '@/app/api/health/ready/route';
import { GET as VIVO } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * I lavori periodici contati sul disco e non chiesti al codice che collaudo: se
 * il conto arrivasse dalle soglie di `lib/cron-health.ts`, un elenco dimezzato
 * farebbe passare queste prove lo stesso.
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
/** La richiesta del monitor vero: viene da internet e non ha nessun segreto. */
function richiestaDelMonitor(percorso: string, extra: Record<string, string> = {}) {
  contatore++;
  return new Request(`https://mycity.test${percorso}`, {
    headers: { 'x-forwarded-for': `198.51.100.${contatore % 250}`, ...extra },
  }) as never;
}

async function cosaVedeSuPronto(extra: Record<string, string> = {}) {
  const res = await PRONTO(richiestaDelMonitor('/api/health/ready', extra));
  const corpo = await res.json();
  return { http: res.status, corpo, testo: JSON.stringify(corpo) };
}

async function cosaVedeSuVivo() {
  const res = await (VIVO as unknown as (r: unknown) => Promise<Response>)(
    richiestaDelMonitor('/api/health'),
  );
  return { http: res.status, corpo: await res.json() };
}

describe('la porta «sei pronto?» e i lavori periodici fermi', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    __resetRateLimitBuckets();
    stato.errore = null;
    stato.erroreDb = null;
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
      'UNSUBSCRIBE_SECRET', 'MIDDLEWARE_CACHE_SECRET', 'SUPPORT_EMAIL',
      'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AI_GLOBAL_DAILY_BUDGET_EUR',
    ]) completo[k] = 'x';
    // Il monitor vero chiama il sito in produzione, senza autorizzazione: e'
    // l'unico ramo che conta. L'ambiente si sostituisce tutto insieme perche'
    // NODE_ENV, sull'oggetto vero di Node, non si lascia riscrivere pezzo a pezzo.
    process.env = { ...salvato, ...completo, NODE_ENV: 'production' };
  });

  afterEach(() => {
    process.env = { ...salvato };
  });

  it('IL CASO CHE ROMPEVA — con tutti i lavori fermi da dieci giorni chi guarda «sei pronto?» se ne accorge', async () => {
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: minutiFa(10 * 24 * 60) }));
    const { corpo, testo } = await cosaVedeSuPronto();
    expect(
      corpo.cron?.ok,
      'pagamenti, email e notifiche sono fermi da dieci giorni e la porta piu guardata del sito non lo dice',
    ).toBe(false);
    // La parola e' la stessa che stampa il gemello, e non per gusto: un monitor
    // esterno si configura con una regola sola sulla parola chiave e copre tutte
    // e due le porte. Due parole diverse vorrebbero dire due regole, e la
    // seconda non la mette nessuno.
    expect(
      corpo.degraded,
      'i lavori periodici sono tutti fermi e la risposta non porta nessun avviso',
    ).toBe(true);
    for (const lavoro of LAVORI) {
      expect(testo, `nella risposta non compare il lavoro fermo «${lavoro}»`).toContain(lavoro);
    }
  });

  it('un lavoro periodico fermo non toglie il sito dal servizio: resta pronto e risponde 200', async () => {
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: minutiFa(10 * 24 * 60) }));
    const { http, corpo } = await cosaVedeSuPronto();
    expect(
      http,
      'un cron indietro fa dichiarare il sito non pronto: chi lo consuma smette di mandargli clienti mentre le pagine funzionano',
    ).toBe(200);
    expect(
      corpo.status,
      'il sito serve le pagine benissimo e si dichiara non pronto per colpa di un lavoro periodico',
    ).toBe('ready');
  });

  it('le due porte del sito danno lo stesso verdetto sugli stessi battiti', async () => {
    stato.battiti = LAVORI.map((name, i) => ({
      name,
      last_run_at: minutiFa(i === 0 ? 10 * 24 * 60 : 1),
    }));
    const pronto = await cosaVedeSuPronto();
    const vivo = await cosaVedeSuVivo();
    expect(
      pronto.corpo.cron,
      `«sei pronto?» e «sei vivo?» misurano i lavori periodici con due metri diversi: ${JSON.stringify(pronto.corpo.cron)} contro ${JSON.stringify(vivo.corpo.cron)}`,
    ).toEqual(vivo.corpo.cron);
    expect(pronto.corpo.cron?.attesi).toBe(LAVORI.length);
  });

  it('con la tabella dei battiti vuota non dice che va tutto bene: dice che non ha guardato niente', async () => {
    stato.battiti = [];
    const { corpo } = await cosaVedeSuPronto();
    expect(corpo.cron?.esaminati, 'un verde su zero lavori sembra un verde su dieci').toBe(0);
    expect(corpo.cron?.attesi, 'la risposta non dice quanti lavori dovrebbe guardare').toBe(LAVORI.length);
    expect(
      corpo.cron?.ok,
      'ha guardato zero lavori e mette lo stesso la spunta: succede a ogni ambiente nuovo e dopo ogni ripristino del database',
    ).toBe(false);
  });

  it('quando i dieci lavori battono davvero, nessun avviso e il conto lo dimostra', async () => {
    const { http, corpo } = await cosaVedeSuPronto();
    expect(http).toBe(200);
    expect(corpo.status).toBe('ready');
    expect(corpo.cron?.ok, `si lamenta di: ${JSON.stringify(corpo.cron)}`).toBe(true);
    expect(corpo.cron?.esaminati, 'dice verde ma non dimostra quanti lavori ha guardato').toBe(LAVORI.length);
    expect(corpo.degraded, 'grida al lupo con tutti i lavori che battono regolarmente').toBeUndefined();
  });

  it('al monitor senza segreto escono i nomi dei lavori, non i segreti del sito', async () => {
    stato.battiti = LAVORI.map((name) => ({ name, last_run_at: minutiFa(10 * 24 * 60) }));
    const { testo } = await cosaVedeSuPronto();
    expect(testo, 'lascia uscire il segreto dei lavori periodici').not.toContain('segreto-dei-lavori-periodici');
    expect(testo, 'racconta a chiunque la latenza interna, che e roba di casa').not.toContain('latencyMs');
    expect(testo, `nella risposta anonima non compare nessun lavoro fermo: ${testo}`).toContain(LAVORI[0]);
  });

  it('se i battiti non si leggono, al monitor non arriva un verde su niente', async () => {
    stato.errore = { message: 'permission denied for table cron_heartbeats' };
    const { corpo, testo } = await cosaVedeSuPronto();
    expect(
      corpo.cron?.ok,
      'non ha potuto leggere nemmeno un battito e risponde lo stesso «tutto a posto»',
    ).toBe(false);
    expect(testo, 'ripete a chiunque il messaggio grezzo del database').not.toContain('permission denied');
  });

  it('chi ha il segreto legge anche perche i battiti non si leggono', async () => {
    stato.errore = { message: 'permission denied for table cron_heartbeats' };
    const { corpo } = await cosaVedeSuPronto({ authorization: 'Bearer segreto-dei-lavori-periodici' });
    expect(
      corpo.cron?.dettaglio,
      'chi entra col segreto per capire cosa e successo non trova il motivo da nessuna parte',
    ).toContain('permission denied');
  });

  it('col database irraggiungibile resta 503 e i battiti non passano per guardati', async () => {
    stato.erroreDb = { message: 'connection refused' };
    const { http, corpo } = await cosaVedeSuPronto();
    expect(http, 'il database non risponde e il monitor legge che il sito e pronto').toBe(503);
    expect(corpo.status).toBe('not_ready');
    expect(
      corpo.cron?.ok,
      'il database e giu, i battiti nessuno li ha letti, e la risposta li da per sani',
    ).toBe(false);
  });
});
