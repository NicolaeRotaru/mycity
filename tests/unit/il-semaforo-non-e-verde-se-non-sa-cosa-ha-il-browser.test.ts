import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 8/9/2026 — IL SEMAFORO RESTAVA VERDE MENTRE NESSUNO RIUSCIVA PIU' AD ENTRARE
 * NE' A PAGARE CON LA CARTA.
 *
 * `/api/health` elencava diciassette variabili «importanti», tutte segreti del
 * server, e le misurava tutte allo stesso modo: `!process.env[nome]`. Due cose
 * gli sfuggivano, e sono le due che il cliente vede per prime.
 *
 * ① LE COPPIE A META'. `TURNSTILE_SECRET_KEY` c'e', `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
 *    no: le pagine di accesso e registrazione non disegnano il riquadro
 *    anti-robot, mandano il modulo senza gettone, e `lib/captcha.ts` risponde
 *    «CAPTCHA mancante» a tutti — su accesso, registrazione, contatti e
 *    newsletter. Nessuno entra, nessuno si registra. Oppure:
 *    `STRIPE_SECRET_KEY` c'e' e `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` no, e il
 *    checkout passa in silenzio a «solo contanti». In tutti e due i casi il
 *    semaforo diceva «ok».
 *    Succede da solo il martedi' che si ruotano le chiavi su Cloudflare e su
 *    Vercel si aggiorna solo la meta' segreta.
 *
 * ② «NON L'HO POTUTO MISURARE» NON ESISTEVA COME RISPOSTA. Le `NEXT_PUBLIC_*`
 *    non le legge il server: Next le stampa dentro il pacchetto costruito e le
 *    legge il browser. `process.env[nome]`, col nome dentro una variabile, non
 *    viene sostituito da Next e risponde a un'altra domanda. Un controllo che
 *    non riesce a misurare non e' verde: deve dirlo. Un «non lo so» e'
 *    un'informazione, un verde finto no — insegna a fidarsi.
 *
 * Il verdetto adesso e' una funzione pura in `lib/health-env.ts`, che questa
 * prova ESEGUE. Prima viveva dentro `route.ts` insieme a `next/server` e a due
 * query sul database: nessuno poteva eseguirla, quindi nessuno la provava,
 * quindi e' tornata a mentire.
 */

type Battito = { name: string; last_run_at: string | null };
const stato: { battiti: Battito[] } = { battiti: [] };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'cron_heartbeats') {
        return { select: () => Promise.resolve({ data: stato.battiti, error: null }) };
      }
      // Il database risponde bene: l'unica cosa che puo' far cambiare colore al
      // semaforo, in questa prova, sono le variabili.
      return { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { GET } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import {
  misuraVariabili,
  esitoVariabili,
  COPPIE_INTERE_O_GUASTO,
  type Misura,
} from '@/lib/health-env';
import { verifyTurnstileToken } from '@/lib/captcha';
import { logger } from '@/lib/logger';

const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Tutti i lavori periodici hanno battuto un colpo: il colore dipende solo dalle variabili. */
function lavoriTuttiVivi(): Battito[] {
  return [
    'release-payouts',
    'send-emails',
    'send-push',
    'expire-checkouts',
    'expire-stale-orders',
    'abandoned-carts',
    'process-deletions',
    'external-price-alerts',
    'riquadra-casse',
    'operational-alerts',
  ].map((name) => ({ name, last_run_at: minutiFa(1) }));
}

/** Un sito configurato bene, com'e' il giorno prima della rotazione delle chiavi. */
const TUTTO_A_POSTO: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  NEXT_PUBLIC_APP_URL: 'https://mycity.test',
  TURNSTILE_SECRET_KEY: 'turnstile_secret',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAA_sitekey',
  STRIPE_SECRET_KEY: 'sk_test',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  RESEND_API_KEY: 're_test',
  RESEND_FROM: 'MyCity <ordini@mycity.test>',
  CRON_SECRET: 'cron_test',
  UPSTASH_REDIS_REST_URL: 'https://upstash.test',
  UPSTASH_REDIS_REST_TOKEN: 'tok_test',
  INTERNAL_API_SECRET: 'int_test',
  UNSUBSCRIBE_SECRET: 'unsub_test',
  MIDDLEWARE_CACHE_SECRET: 'mid_test',
  SUPPORT_EMAIL: 'aiuto@mycity.test',
  VAPID_PRIVATE_KEY: 'vapid_priv',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'vapid_pub',
  AI_GLOBAL_DAILY_BUDGET_EUR: '20',
};

let contatore = 0;
/** Come chiama chi ha il segreto: il dettaglio dei controlli esce solo a lui. */
function richiestaConSegreto(): Request {
  contatore++;
  return new Request('https://mycity.test/api/health', {
    headers: {
      'x-forwarded-for': `203.0.113.${contatore % 250}`,
      authorization: `Bearer ${TUTTO_A_POSTO.CRON_SECRET}`,
    },
  });
}

async function semaforo() {
  const res = await GET(richiestaConSegreto());
  const corpo = await res.json();
  return { http: res.status, status: corpo.status as string, variabili: corpo.checks.envOpzionali };
}

describe('il semaforo non e verde se non sa cosa ha in mano il browser', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    __resetRateLimitBuckets();
    stato.battiti = lavoriTuttiVivi();
    process.env = { ...salvato, ...TUTTO_A_POSTO };
  });

  afterEach(() => {
    process.env = { ...salvato };
  });

  // ── La rete di sicurezza: se il semaforo fosse rosso SEMPRE non varrebbe
  // niente lo stesso, perche' si impara a ignorarlo (e' l'altro modo di
  // rompere un allarme). Con tutto al posto giusto deve essere verde.
  it('con tutte le chiavi al loro posto il semaforo e verde, e dice su quante misure', async () => {
    const s = await semaforo();
    expect(s.status, `si lamenta di: ${s.variabili.error}`).toBe('ok');
    expect(s.variabili.ok).toBe(true);
    expect(s.variabili.stato).toBe('ok');
    // Un verde su zero e un verde su tutte non si assomigliano: il conto esce.
    expect(s.variabili.esaminate).toBe(s.variabili.attese);
    expect(s.variabili.attese).toBeGreaterThan(0);
  });

  it('col controllo anti-robot a meta il semaforo non dice piu «ok»: nessuno riesce ad accedere', async () => {
    // Il martedi' della rotazione: su Cloudflare si cambiano tutte e due le
    // chiavi, su Vercel si aggiorna solo la segreta.
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const s = await semaforo();
    expect(
      s.status,
      'accesso e registrazione sono spenti e il semaforo dice «ok»: lo scopre il primo cliente',
    ).toBe('degraded');
    expect(s.variabili.ok).toBe(false);
    expect(s.variabili.stato).toBe('coppia_rotta');
    expect(s.variabili.error).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    // Chi legge alle tre di notte deve sapere COSA si e' spento, non solo il
    // nome di una variabile.
    expect(s.variabili.error).toContain('CAPTCHA mancante');
  });

  it('col pagamento a meta il semaforo lo dice: dal checkout sparisce la carta', async () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const s = await semaforo();
    expect(s.status, 'il negozio non incassa piu con la carta e il cruscotto e verde').toBe('degraded');
    expect(s.variabili.stato).toBe('coppia_rotta');
    expect(s.variabili.error).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
    expect(s.variabili.error).toContain('contanti');
  });

  // 021 + 238 — La risposta pubblica non e' una mappa di dov'e' scoperto il
  // sito. Il messaggio nuovo e' molto piu' esplicito di prima («manca la chiave
  // pubblica di Stripe» dice a un estraneo dove provare): va tenuto dietro il
  // segreto come tutto il resto.
  it('a un anonimo, in produzione, non racconta quale meta di quale coppia manca', async () => {
    const prima = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    try {
      const res = await GET(
        new Request('https://mycity.test/api/health', { headers: { 'x-forwarded-for': '198.51.100.7' } }),
      );
      const testo = JSON.stringify(await res.json());
      expect(testo).not.toContain('TURNSTILE');
      expect(testo).not.toContain('checks');
      // Ma il colore lo vede: e' quello che fa scattare il monitor esterno.
      expect(testo).toContain('degraded');
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: prima, configurable: true });
    }
  });
});

/**
 * IL VERDETTO, ESEGUITO DA SOLO.
 *
 * Qui non c'e' `next/server`, non c'e' il database e non c'e' `process.env`: si
 * chiama la funzione con un oggetto e si guarda cosa risponde. E' il pezzo che
 * prima era annegato dentro `route.ts` e che nessuna prova poteva eseguire.
 */
describe('il verdetto sulle variabili sa dire «non l ho potuto misurare»', () => {
  it('una variabile del browser che nessuno misura NON diventa verde leggendo il server', () => {
    // Il caso che rifarebbe il buco: qualcuno aggiunge una variabile pubblica
    // all'elenco e si dimentica di leggerla dal pacchetto del browser.
    // L'ambiente del SERVER ce l'ha, ed e' proprio la lettura sbagliata: se si
    // ripiegasse su quella uscirebbe un verde su una misura che non c'e'.
    const misure = misuraVariabili(
      ['NEXT_PUBLIC_FUNZIONE_NUOVA'],
      (nome) => (nome === 'NEXT_PUBLIC_FUNZIONE_NUOVA' ? 'c-e-nel-server' : undefined),
      {}, // il pacchetto del browser non la contiene: nessuno l'ha misurata
    );
    expect(misure.NEXT_PUBLIC_FUNZIONE_NUOVA).toBe<Misura>('non_misurabile');

    const esito = esitoVariabili(misure, ['NEXT_PUBLIC_FUNZIONE_NUOVA']);
    expect(esito.ok, 'non misurata e uscita verde: e il verde finto').toBe(false);
    expect(esito.stato).toBe('non_misurate');
    expect(esito.esaminate).toBe(0);
    expect(esito.attese).toBe(1);
    expect(esito.error).toContain('non misurate');
  });

  it('le variabili del browser si leggono dal pacchetto, non dall ambiente del server', () => {
    // Il caso vero su Vercel: la chiave e' stata rimessa nell'ambiente ma il
    // sito non e' stato ricostruito, quindi nel browser non c'e'. Il cliente
    // non vede il riquadro; il server, guardando se stesso, direbbe «c'e'».
    const misure = misuraVariabili(
      ['NEXT_PUBLIC_TURNSTILE_SITE_KEY'],
      () => 'rimessa-nell-ambiente-ma-senza-nuovo-rilascio',
      { NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined },
    );
    expect(misure.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe<Misura>('assente');
  });

  it('mezza coppia e peggio di zero, e prende la parola piu grave', () => {
    const attese = ['TURNSTILE_SECRET_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY'];
    const meta: Record<string, Misura> = {
      TURNSTILE_SECRET_KEY: 'presente',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'assente',
    };
    const rotta = esitoVariabili(meta, attese);
    expect(rotta.ok).toBe(false);
    expect(rotta.stato).toBe('coppia_rotta');

    // Con tutte e due assenti resta un guasto, ma non e' la stessa malattia:
    // zero non mente, mezza coppia si'. Le due parole devono restare diverse,
    // perche' mandano a cercare in due posti diversi.
    const zero = esitoVariabili(
      { TURNSTILE_SECRET_KEY: 'assente', NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'assente' },
      attese,
    );
    expect(zero.ok).toBe(false);
    expect(zero.stato).toBe('mancanti');
  });

  it('un elenco vuoto non e un verde: e un controllo che non guarda niente', () => {
    const esito = esitoVariabili({}, []);
    expect(esito.ok, 'zero variabili guardate e il verdetto e verde').toBe(false);
    expect(esito.stato).toBe('non_misurate');
  });

  it('una variabile svuotata su Vercel conta come assente, non come presente', () => {
    // Capita spesso: si cancella il valore e si lascia la riga. `''` non e' una
    // chiave.
    const misure = misuraVariabili(['STRIPE_SECRET_KEY'], () => '   ', {});
    expect(misure.STRIPE_SECRET_KEY).toBe<Misura>('assente');
  });

  it('ogni coppia dichiarata dice anche COSA si rompe, in italiano', () => {
    // Un nome di variabile non dice a nessuno cosa e' spento. Chi viene
    // svegliato di notte deve leggere la conseguenza, non la sigla.
    for (const c of COPPIE_INTERE_O_GUASTO) {
      expect(c.variabili.length, `${c.nome}: una coppia ha due meta'`).toBe(2);
      expect(c.rompe.length, `${c.nome}: non dice cosa si rompe`).toBeGreaterThan(20);
    }
  });
});

/**
 * IL PEZZO CHE IL SEMAFORO NON PUO' MISURARE.
 *
 * `/api/health` sa dire se la chiave pubblica del controllo anti-robot manca.
 * Non sa dire se c'e' ma e' VECCHIA — rotata su Cloudflare e rimasta indietro
 * nel pacchetto costruito: da fuori le due chiavi sono due stringhe non vuote e
 * si assomigliano. Quel caso lo vede solo chi apre i registri col sito gia' in
 * fiamme, e finora ci trovava «CAPTCHA mancante» — la stessa identica riga che
 * lascia un robot qualunque.
 *
 * Il registro adesso distingue le due cose. E le distingue in un modo solo: se
 * urlasse a ogni gettone mancante sarebbe rumore su un fatto normale, e un
 * registro che urla sempre non lo legge piu' nessuno.
 */
describe('quando la porta d ingresso e chiusa per tutti, il registro non lo confonde con un bot', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    process.env = { ...salvato, TURNSTILE_SECRET_KEY: 'turnstile_secret' };
  });

  afterEach(() => {
    process.env = { ...salvato };
    vi.restoreAllMocks();
  });

  it('senza la chiave pubblica nel browser lo scrive, e dice che sono chiusi per TUTTI', async () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const registro = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const esito = await verifyTurnstileToken(null);

    expect(esito.ok, 'una difesa non configurata deve rifiutare, non lasciar passare').toBe(false);
    expect(registro).toHaveBeenCalledTimes(1);
    const scritto = String((registro.mock.calls[0]?.[0] as Error)?.message);
    expect(scritto).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    // Chi legge deve capire che non e' un bot: e' la porta chiusa a tutti.
    expect(scritto).toContain('TUTTI');
  });

  it('col riquadro al suo posto, un gettone mancante resta un fatto normale e non urla', async () => {
    // Un robot che manda il modulo senza passare dalla pagina, o una rete che
    // blocca Cloudflare. Succede tutti i giorni: se scrivesse un errore ogni
    // volta, il registro diventerebbe illeggibile proprio quando serve.
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAA_sitekey';
    const registro = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const esito = await verifyTurnstileToken(null);

    expect(esito.ok).toBe(false);
    expect(registro, 'un avviso a ogni bot e rumore: il registro smette di essere letto').not.toHaveBeenCalled();
  });
});
