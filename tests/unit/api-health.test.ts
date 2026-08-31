import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Mock supabase admin — factory self-contained
const limitMock = vi.fn<() => Promise<{ error: null | { message: string } }>>(
  () => Promise.resolve({ error: null }),
);
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn((tabella: string) =>
      // 31/8/2026 (R183, secondo giro) — QUESTO FINTO DATABASE NON SAPEVA DIRE
      // SE I LAVORI PERIODICI GIRAVANO.
      //
      // Prima rispondeva la stessa cosa a qualunque tabella, quindi la rotta
      // leggeva zero battiti — e passava per «tutto a posto» solo perche' un
      // controllo che non aveva guardato niente usciva verde lo stesso. Adesso
      // zero esaminati vale giallo, e questo blocco deve dire cosa succede ai
      // battiti: qui si misurano database e variabili d'ambiente, non i cron,
      // quindi i lavori battono tutti regolarmente. Chi collauda i battiti sta
      // in il-semaforo-parla-anche-al-monitor-senza-segreto.test.ts.
      tabella === 'cron_heartbeats'
        ? { select: () => Promise.resolve({ data: lavoriCheBattono(), error: null }) }
        : { select: vi.fn(() => ({ limit: limitMock })) },
    ),
  })),
}));

import { GET } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * I lavori periodici che esistono sul disco, tutti con un battito appena dato.
 * L'elenco si legge dalle cartelle vere e non dalle soglie del codice: cosi' un
 * lavoro nuovo entra da solo nel finto database, invece di far diventare gialli
 * dei casi che parlano d'altro.
 */
function lavoriCheBattono(): { name: string; last_run_at: string }[] {
  const cartella = join(process.cwd(), 'app/api/cron');
  return readdirSync(cartella, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(cartella, d.name, 'route.ts')))
    .map((d) => ({ name: d.name, last_run_at: new Date().toISOString() }));
}

/** Una richiesta finta con un indirizzo di rete diverso per ogni caso, così il
 *  freno di 60/minuto non fa fallire il caso successivo. */
let contatore = 0;
function req(headers: Record<string, string> = {}): Request {
  contatore++;
  return new Request('https://mycity.test/api/health', {
    headers: { 'x-forwarded-for': `10.0.0.${contatore % 250}`, ...headers },
  });
}

describe('GET /api/health', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    limitMock.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.RESEND_API_KEY = 're_test';
    process.env.CRON_SECRET = 'cron_test';
    process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.test';
    // 27/8/2026 (R184) — L'elenco delle variabili «importanti» e' passato da
    // cinque a dodici: sette segreti che, mancando, spegnevano un pezzo di
    // marketplace senza far cambiare colore al semaforo. Questo blocco dice
    // «l'ambiente e' completo», quindi va tenuto completo: altrimenti la prova
    // qui sotto misura un ambiente a meta' e chiama «ok» un `degraded`.
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok_test';
    process.env.INTERNAL_API_SECRET = 'int_test';
    process.env.UNSUBSCRIBE_SECRET = 'unsub_test';
    process.env.MIDDLEWARE_CACHE_SECRET = 'mid_test';
    process.env.SUPPORT_EMAIL = 'aiuto@mycity.test';
    process.env.VAPID_PRIVATE_KEY = 'vapid_priv';
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'vapid_pub';
    // 30/8/2026 (R142) — anche il tetto di spesa AI: senza, vale zero, e zero
    // vuol dire nessun tetto. Chi conta le variabili «importanti» sta in
    // il-semaforo-guarda-i-segreti-che-contano.test.ts.
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '20';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('risponde 200 ok quando il database risponde e le variabili ci sono', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.checks.db.ok).toBe(true);
    expect(json.checks.env.ok).toBe(true);
  });

  /**
   * 22/8/2026 — UN DATABASE LENTO NON DEVE FAR RIAVVIARE UN'ISTANZA SANA.
   *
   * Questa prova certificava che il database irraggiungibile facesse
   * rispondere 503. Ma 503 su QUESTA rotta vuol dire «ammazza il processo e
   * riavvialo», ed e' la cosa peggiore da fare mentre il database e' in
   * difficolta': si perdono le richieste in corso, il processo riparte,
   * ritrova lo stesso database lento, riparte di nuovo. Il rallentamento
   * diventa un blackout per mano nostra.
   *
   * Adesso il database in difficolta' e' `degraded` con 200 — visibile nel
   * corpo, senza il potere di riavviare — e la domanda «e' pronto a servire?»
   * vive su /api/health/ready, che guarda un monitor esterno.
   */
  it('un database che non risponde diventa «degraded», non un riavvio', async () => {
    limitMock.mockResolvedValueOnce({ error: { message: 'connection refused' } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.checks.db.ok).toBe(false);
  });

  it('ma la rotta «pronto a servire» quello lo dice: 503, per il monitor', async () => {
    limitMock.mockResolvedValueOnce({ error: { message: 'connection refused' } });
    const { GET: PRONTO } = await import('@/app/api/health/ready/route');
    const res = await (PRONTO as unknown as (r: unknown) => Promise<Response>)(req());
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('not_ready');
  });

  it('risponde 503 se manca una variabile senza cui il sito non serve pagine', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await GET(req());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.checks.env.ok).toBe(false);
  });

  // 176 + 234 — Questo è il caso che prima faceva spegnere il sito: senza la
  // chiave della posta rispondeva 503, e per Render 503 su questa rotta voleva
  // dire «istanza morta». Su Vercel non c'è nessuna istanza da spegnere, ma la
  // regola resta: 503 qui è quello che sveglia una persona di notte, e il
  // marketplace vende benissimo senza spedire email.
  it('senza la chiave delle email dice «degradato» ma risponde 200: nessuno va svegliato per la posta', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
  });

  // Il freno anti-abuso condiviso non è un lusso da quando il sito sta su
  // Vercel: senza Upstash ogni copia della funzione conta per conto suo, e
  // «dieci tentativi al minuto» diventano dieci per ogni copia. Non è un guasto
  // — il ripiego in memoria c'è sempre — ma va VISTO, e l'unico posto da cui si
  // vede è questa rotta.
  it('senza Upstash dice «degradato»: il freno anti-abuso non è più condiviso', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.checks.envOpzionali.error).toContain('UPSTASH_REDIS_REST_URL');
  });

  // 021 + 238 — La risposta pubblica non è una mappa di dove il sito è scoperto.
  it('in produzione non dice a un anonimo quali segreti mancano', async () => {
    const prima = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const res = await GET(req());
      const testo = JSON.stringify(await res.json());
      expect(testo).not.toContain('STRIPE_SECRET_KEY');
      expect(testo).not.toContain('checks');
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: prima, configurable: true });
    }
  });

  it('in produzione il dettaglio lo vede chi ha il segreto dei cron', async () => {
    const prima = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    try {
      const res = await GET(req({ authorization: 'Bearer cron_test' }));
      const json = await res.json();
      expect(json.checks).toBeTruthy();
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: prima, configurable: true });
    }
  });

  /**
   * 22/8/2026 — SU QUESTA ROTTA NON SI RISPONDE MAI 429.
   *
   * Il freno serve — la rotta interroga il database a ogni chiamata — ma chi
   * sorveglia il sito guarda una cosa sola: la risposta è 2xx? Un 429 lo
   * leggeva come «istanza morta», su un'istanza viva. E siccome `getClientIp`
   * restituisce la stringa fissa `'unknown'` quando non trova le intestazioni
   * del proxy, tutte le sonde interne finivano nello stesso contatore da
   * sessanta: bastavano due monitor per far sembrare morto il sito.
   *
   * Adesso: soglia alta, sonde interne fuori dal freno, e sopra soglia un 200
   * con corpo minimo — l'abuso non costa una query, ma non produce nemmeno un
   * falso allarme.
   */
  it('anche sotto raffica risponde 200, mai 429', async () => {
    const stesso = () => new Request('https://mycity.test/api/health', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    for (let i = 0; i < 60; i++) await GET(stesso());
    const res = await GET(stesso());
    expect(res.status).toBe(200);
  });

  it('oltre la soglia smette di interrogare il database, ma resta 200', async () => {
    const stesso = () => new Request('https://mycity.test/api/health', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    for (let i = 0; i < 600; i++) await GET(stesso());
    const res = await GET(stesso());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.throttled).toBe(true);
  });

  it('le sonde senza x-forwarded-for non passano dal freno', async () => {
    // Sono le chiamate interne della piattaforma: non hanno le intestazioni del
    // proxy, e prima finivano tutte nello stesso contatore chiamato 'unknown'.
    const interna = () => new Request('https://mycity.test/api/health');
    for (let i = 0; i < 700; i++) await GET(interna());
    const res = await GET(interna());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.throttled).toBeUndefined();
  });

  it('non trapela la chiave di servizio', async () => {
    const res = await GET(req());
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain('svc');
  });

  it('mette timestamp, latenza e cache-control no-store', async () => {
    const res = await GET(req());
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json.timestamp).toBeTruthy();
    expect(typeof json.latencyMs).toBe('number');
  });
});
