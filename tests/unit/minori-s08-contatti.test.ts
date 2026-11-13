import { describe, it, expect, vi, beforeEach } from 'vitest';

/** S08 (5/11/2026) — Il modulo dei contatti, lato server. */

const stato: {
  senzaChiave: boolean;
  erroreInsert: { message: string } | null;
  accessoRotto: boolean;
  utente: { id: string } | null;
  email: Array<Record<string, unknown>>;
  dopo: Array<() => Promise<void>>;
} = { senzaChiave: false, erroreInsert: null, accessoRotto: false, utente: null, email: [], dopo: [] };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error('Service role Supabase non configurato');
    return { from: () => ({ insert: async () => ({ error: stato.erroreInsert }) }) };
  },
  getCurrentUser: async () => {
    if (stato.accessoRotto) {
      const e = new Error('servizio di accesso giù');
      e.name = 'AuthNonDisponibile';
      throw e;
    }
    return stato.utente;
  },
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (l: Record<string, unknown>) => { stato.email.push(l); return { ok: true }; },
}));
vi.mock('@/lib/api/dopo-la-risposta', () => ({
  dopoLaRisposta: (lavoro: () => Promise<void>) => { stato.dopo.push(lavoro); },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { POST } from '@/app/api/contact/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const corpoValido = { name: 'Maria Rossi', email: 'maria@example.com', subject: 'Privacy / GDPR', message: 'Vorrei cancellare il mio account, grazie.' };
let ip = 0;
function scrivi(corpo: Record<string, unknown> = corpoValido) {
  ip += 1;
  return POST(new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.9.${Math.floor(ip / 250)}.${ip % 250}` },
    body: JSON.stringify(corpo),
  }));
}

beforeEach(() => {
  stato.senzaChiave = false;
  stato.erroreInsert = null;
  stato.accessoRotto = false;
  stato.utente = null;
  stato.email = [];
  stato.dopo = [];
  __resetRateLimitBuckets();
  delete process.env.SUPPORT_EMAIL;
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
});

describe('il modulo dei contatti', () => {
  it('scheda 408 — un nome oltre 120 caratteri riceve un messaggio italiano', async () => {
    const res = await scrivi({ ...corpoValido, name: 'M'.repeat(130) });
    expect(res.status).toBe(400);
    const testo = JSON.stringify(await res.json());
    expect(testo).not.toMatch(/String must|character/i);
    expect(testo).toContain('massimo 120 caratteri');
  });

  it('scheda 408 — anche oggetto e messaggio troppo lunghi parlano italiano', async () => {
    for (const corpo of [{ ...corpoValido, subject: 'x'.repeat(250) }, { ...corpoValido, message: 'x'.repeat(5100) }]) {
      const testo = JSON.stringify(await (await scrivi(corpo)).json());
      expect(testo).not.toMatch(/String must|character/i);
      expect(testo).toMatch(/massimo \d+ caratteri/);
    }
  });

  it('scheda 2017 — se l accesso non risponde il messaggio si salva lo stesso, niente 500 muto', async () => {
    stato.accessoRotto = true;
    expect((await scrivi()).status).toBe(200);
  });

  it('scheda 2017 — col database che risponde con errore si prova l inoltro per email', async () => {
    stato.erroreInsert = { message: 'DB giù' };
    process.env.SUPPORT_EMAIL = 'supporto@mycity-marketplace.com';
    // 13/11/2026 (R24-010) — la regola della porta vuole anche la posta accesa (valore finto).
    process.env.RESEND_API_KEY = 're_di_prova';
    const res = await scrivi();
    expect(res.status).toBe(200);
    expect(stato.email).toHaveLength(1);
  });

  it('scheda 2014 — inoltrato senza database, il messaggio porta l account di chi l ha scritto', async () => {
    stato.senzaChiave = true;
    stato.utente = { id: 'utente-42' };
    process.env.SUPPORT_EMAIL = 'supporto@mycity-marketplace.com';
    // 13/11/2026 (R24-010) — la regola della porta vuole anche la posta accesa (valore finto).
    process.env.RESEND_API_KEY = 're_di_prova';
    expect((await scrivi()).status).toBe(200);
    expect(String(stato.email[0].html)).toContain('utente-42');
  });

  it('scheda 545 — l avviso al supporto passa da dopoLaRisposta, e porta l account', async () => {
    process.env.SUPPORT_EMAIL = 'supporto@mycity-marketplace.com';
    stato.utente = { id: 'utente-7' };
    expect((await scrivi()).status).toBe(200);
    expect(stato.email, 'l avviso non deve partire fuori da dopoLaRisposta').toHaveLength(0);
    expect(stato.dopo).toHaveLength(1);
    await stato.dopo[0]();
    expect(stato.email).toHaveLength(1);
    expect(String(stato.email[0].html)).toContain('utente-7');
  });

  it('scheda 1995 — senza casella il 503 non dice «Scrivici a il modulo dei contatti»', async () => {
    stato.senzaChiave = true;
    const res = await scrivi();
    expect(res.status).toBe(503);
    const corpo = await res.json();
    expect(corpo.error.message).not.toMatch(/Scrivici a il modulo/);
    expect(corpo.error.message).toContain('Non abbiamo ancora una casella email attiva');
    expect(corpo.error.details.recapito).toBeNull();
  });
});
