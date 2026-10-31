import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

type Finto = Mock<(...a: unknown[]) => Promise<unknown>>;

/**
 * 31/10/2026 — LE FUNZIONI SPENTE LE FERMA LA ROTTA, ANCHE CHIAMATA A MANO.
 *
 * lib/funzioni-al-lancio.ts promette che ogni interruttore lo legge anche la
 * rotta del server. Per la newsletter, gli strumenti AI e «Traduci» non era
 * vero: le leggeva solo la pagina. Una richiesta fatta a mano (o da una scheda
 * aperta prima del rilascio) iscriveva e mandava l'email, avviava e pagava un
 * lotto di traduzione che poi /apply rifiutava, applicava un lavoro AI rimasto
 * «pronto». Qui si chiamano le rotte vere e si guarda cosa toccano: database,
 * posta, modello, spesa.
 *
 * Gli interruttori si fingono con un getter, così la prova non diventa rossa il
 * giorno in cui Nicola ne riaccende uno, e si prova anche il verso «acceso».
 */

const stato = vi.hoisted(() => ({
  aiAccesa: false,
  traduciAcceso: false,
  newsletterAccesa: false,
  adminChiesto: 0,
  sendEmail: undefined as unknown as Finto,
  submitBatch: undefined as unknown as Finto,
  registraSpesaAi: undefined as unknown as Finto,
  runMessage: undefined as unknown as Finto,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return {
    ...vero,
    get AI_NEGOZI_ACCESA() { return stato.aiAccesa; },
    get TRADUCI_ACCESO() { return stato.traduciAcceso; },
    get NEWSLETTER_ACCESA() { return stato.newsletterAccesa; },
  };
});

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (gestore: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    gestore({ user: { id: 'seller-1' }, req }),
}));

// Il database: si conta solo se qualcuno lo chiede. Chi arriva fin qui ha già
// passato il freno, che è proprio quello che non deve succedere a funzione spenta.
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    stato.adminChiesto += 1;
    throw new Error('database non preparato per questa prova');
  },
  getServerSupabase: () => {
    stato.adminChiesto += 1;
    throw new Error('database non preparato per questa prova');
  },
}));

vi.mock('@/lib/email/client', () => {
  stato.sendEmail = vi.fn(async () => ({ ok: true }));
  return { sendEmail: (...a: unknown[]) => stato.sendEmail(...a) };
});
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

vi.mock('@/lib/ai/batch', () => {
  stato.submitBatch = vi.fn(async () => ({ id: 'msgbatch_prova', status: 'in_progress' }));
  return { submitBatch: (...a: unknown[]) => stato.submitBatch(...a) };
});

vi.mock('@/lib/ai/run', async (importActual) => {
  const vero = await importActual<typeof import('@/lib/ai/run')>();
  stato.registraSpesaAi = vi.fn(async () => {});
  stato.runMessage = vi.fn(async () => ({ toolInput: { patch: { name: 'Altamura bread' } }, text: '' }));
  return {
    ...vero,
    controllaTettoSpesaAi: async () => {},
    registraSpesaAi: (...a: unknown[]) => stato.registraSpesaAi(...a),
    runMessage: (...a: unknown[]) => stato.runMessage(...a),
  };
});

import { POST as iscriviNewsletter } from '@/app/api/newsletter/route';
import { POST as avviaLotto } from '@/app/api/ai/catalog-batch/start/route';
import { POST as applicaLotto } from '@/app/api/ai/catalog-batch/apply/route';
import { POST as traduci } from '@/app/api/ai/translate/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let ip = 0;
function richiesta(url: string, corpo: unknown): never {
  ip += 1;
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.8.0.${ip}` },
    body: JSON.stringify(corpo),
  }) as never;
}

beforeEach(() => {
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-chiave-presente');
  stato.aiAccesa = false;
  stato.traduciAcceso = false;
  stato.newsletterAccesa = false;
  stato.adminChiesto = 0;
  stato.sendEmail.mockClear();
  stato.submitBatch.mockClear();
  stato.registraSpesaAi.mockClear();
  stato.runMessage.mockClear();
});

describe('newsletter spenta: una POST a mano non iscrive e non scrive a nessuno', () => {
  it('503, nessun accesso al database, nessuna email', async () => {
    const res = await iscriviNewsletter(
      richiesta('/api/newsletter', { email: 'estraneo@example.com', captchaToken: 'gettone-buono' }),
    );
    expect(res.status).toBe(503);
    expect(stato.adminChiesto).toBe(0);
    expect(stato.sendEmail).not.toHaveBeenCalled();
  });

  it('controprova: accesa, la stessa richiesta arriva al database', async () => {
    stato.newsletterAccesa = true;
    await iscriviNewsletter(richiesta('/api/newsletter', { email: 'chi@example.com', captchaToken: 'gettone-buono' }));
    expect(stato.adminChiesto).toBe(1);
  });
});

describe('lotto AI sul catalogo: il freno sta prima della spesa', () => {
  it('AI spenta: /start risponde 503 e non manda niente al modello', async () => {
    const res = await avviaLotto(richiesta('/api/ai/catalog-batch/start', { operation: 'improve' }));
    expect(res.status).toBe(503);
    expect(stato.adminChiesto).toBe(0);
    expect(stato.submitBatch).not.toHaveBeenCalled();
    expect(stato.registraSpesaAi).not.toHaveBeenCalled();
  });

  it('«Traduci» spento: /start rifiuta il lotto translate prima di crearlo e pagarlo', async () => {
    stato.aiAccesa = true;
    const res = await avviaLotto(richiesta('/api/ai/catalog-batch/start', { operation: 'translate', targetLang: 'en' }));
    expect(res.status).toBe(400);
    expect(stato.adminChiesto).toBe(0);
    expect(stato.submitBatch).not.toHaveBeenCalled();
    expect(stato.registraSpesaAi).not.toHaveBeenCalled();
  });

  it('controprova: AI accesa, un lotto improve passa il freno e va a leggere il catalogo', async () => {
    stato.aiAccesa = true;
    await avviaLotto(richiesta('/api/ai/catalog-batch/start', { operation: 'improve' })).catch(() => null);
    expect(stato.adminChiesto).toBe(1);
  });

  it('AI spenta: /apply su un lavoro rimasto «pronto» risponde 503 e non tocca i prodotti', async () => {
    const res = await applicaLotto(richiesta('/api/ai/catalog-batch/apply', { jobId: 'job-1' }));
    expect(res.status).toBe(503);
    expect(stato.adminChiesto).toBe(0);
  });
});

describe('«Traduci» spento: /api/ai/translate non chiama il modello', () => {
  const corpo = { product: { name: 'Pane di Altamura', description: 'Pane di grano duro.' }, targetLang: 'en' };

  it('503 e nessuna chiamata al modello, anche con AI e chiave presenti', async () => {
    stato.aiAccesa = true;
    const res = await traduci(richiesta('/api/ai/translate', corpo));
    expect(res.status).toBe(503);
    expect(stato.runMessage).not.toHaveBeenCalled();
  });

  it('controprova: acceso, la stessa richiesta arriva al modello', async () => {
    stato.aiAccesa = true;
    stato.traduciAcceso = true;
    await traduci(richiesta('/api/ai/translate', corpo)).catch(() => null);
    expect(stato.runMessage).toHaveBeenCalled();
  });
});
