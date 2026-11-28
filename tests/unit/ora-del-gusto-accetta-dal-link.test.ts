import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 24/11/2026 — ORA DEL GUSTO ACCETTA DAL LINK COL CODICE (Lavoro 2).
 *
 * Nicola ha scelto «link col codice». Il titolare apre /preventivo/<codice>, sceglie, lascia l'email
 * e accetta: la sua email va sull'utente dell'attività (stesso id), il profilo si compila coi SOLI
 * dati confermati della scheda di n8n e passa in revisione, parte il link per entrare, si apre la
 * cassa Stripe con quell'email. Un secondo invio non accetta due volte; un'email già usata non
 * ruba l'account di nessuno e il preventivo torna aperto.
 */

const ODG = '0de1905e-7000-4000-8000-000000000001';
const CODICE = 'a'.repeat(64);

const db = vi.hoisted(() => ({
  preventivo: null as null | { seller_id: string; codice: string; stato: string; fascia_scelta: string | null; profiles: { store_name: string } },
  scheda: null as unknown,
  profiloAggiornato: [] as Array<Record<string, unknown>>,
  abbonamenti: [] as Array<{ stato: string }>,
  utenteAggiornato: [] as Array<Record<string, unknown>>,
  erroreUtente: null as null | { message: string; code?: string },
  // 27/11/2026 23:34 — gli altri utenti di MyCity, per sapere se l'email è già di un altro (listUsers).
  altriUtenti: [] as { id: string; email: string }[],
  posta: [] as Array<Record<string, unknown>>,
  avvisi: [] as string[],
  testiAvvisi: [] as string[],
  emailUtente: 'titolare@example.it' as string | null,
  casse: [] as Array<Record<string, unknown>>,
}));

// 26/11/2026 — Il pagamento online è spento (lib/agenzia/pagamento-servizi.ts, Nicola: per ora contanti).
// Queste prove guardano la cassa Stripe per quando si riaccende: qui l'interruttore è acceso apposta.
// Lo stato di oggi, spento, lo provano tests/unit/l-abbonamento-si-paga-in-contanti.test.tsx.
vi.mock('@/lib/agenzia/pagamento-servizi', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenzia/pagamento-servizi')>()),
  PAGAMENTO_ONLINE_SERVIZI: true,
  pagamentoOnlineAttivo: () => true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
// 27/11/2026 — L'accettazione chiede il codice dell'email (lib/agenzia/codice-dal-link.ts, Nicola: «codice
// dall'email»): qui il codice è sempre giusto, perché queste prove guardano cosa succede DOPO. Il codice lo provano
// tests/unit/il-titolare-entra-col-codice-dell-email.test.ts.
vi.mock('@/lib/agenzia/codice-dal-link', () => ({ verificaCodice: () => 'giusto', chiaveDelGettone: () => 'gettone-delle-prove' }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 10 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: Record<string, unknown>) => { db.posta.push(m); return { ok: true, id: 'e1' }; }) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async (titolo: string, testo: string) => { db.avvisi.push(titolo); db.testiAvvisi.push(testo); }) }));
vi.mock('@/lib/agenzia/cassa-servizi', () => ({
  apriCassaServizi: vi.fn(async (a: Record<string, unknown>) => {
    db.casse.push(a);
    return new Response(JSON.stringify({ ok: true, data: { url: 'https://checkout.stripe.test/s1' } }), { status: 200 });
  }),
}));
vi.mock('@/lib/supabase/server', () => {
  const tabellaPreventivi = () => ({
    select: () => ({ eq: (_c: string, codice: string) => ({ maybeSingle: async () => ({ data: db.preventivo && db.preventivo.codice === codice ? db.preventivo : null, error: null }) }) }),
    update: (valori: Record<string, unknown>) => {
      const filtri: Record<string, unknown> = {};
      const catena = {
        eq: (c: string, v: unknown) => { filtri[c] = v; return catena; },
        select: async () => {
          const p = db.preventivo;
          if (p && p.codice === filtri.codice && (filtri.stato === undefined || p.stato === filtri.stato)) {
            Object.assign(p, valori);
            return { data: [{ seller_id: p.seller_id }], error: null };
          }
          return { data: [], error: null };
        },
        then: (res: (v: unknown) => unknown) => {
          const p = db.preventivo;
          if (p && p.codice === filtri.codice) Object.assign(p, valori);
          return res({ error: null });
        },
      };
      return catena;
    },
  });
  return {
    getAdminSupabase: () => ({
      from: (t: string) => {
        if (t === 'preventivi_con_codice') return tabellaPreventivi();
        if (t === 'schede_clienti') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.scheda ? { scheda: db.scheda } : null, error: null }) }) }) };
        if (t === 'profiles') return {
          update: (v: Record<string, unknown>) => ({ eq: async () => { db.profiloAggiornato.push(v); return { error: null }; } }),
          // 25/11/2026 — se scheda e pagella sono aperte (lib/agenzia/scheda-dopo-abbonamento.ts).
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { visibile_senza_abbonamento: false }, error: null }) }) }),
        };
        if (t === 'abbonamenti_servizi') return { select: () => ({ eq: () => ({ limit: async () => ({ data: db.abbonamenti, error: null }) }) }) };
        throw new Error(`tabella inattesa ${t}`);
      },
      auth: {
        admin: {
          updateUserById: async (id: string, v: Record<string, unknown>) => {
            if (db.erroreUtente) return { data: null, error: db.erroreUtente };
            db.utenteAggiornato.push({ id, ...v });
            return { data: { user: { id } }, error: null };
          },
          listUsers: async ({ page }: { page: number }) => ({ data: { users: page === 1 ? db.altriUtenti : [] }, error: null }),
          getUserById: async (id: string) => ({ data: { user: db.emailUtente ? { id, email: db.emailUtente } : null }, error: null }),
          generateLink: async () => ({ data: { properties: { action_link: 'https://supabase.test/verify?token=t' } }, error: null }),
        },
      },
    }),
  };
});

async function accetta(corpo: Record<string, unknown>, codice = CODICE) {
  const { POST } = await import('@/app/api/preventivo/[codice]/accetta/route');
  return POST(
    new Request(`https://mycity.example/api/preventivo/${codice}/accetta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ codice }) },
  );
}

const BUONO = { email: 'Titolare@Example.it', abbonamento: 'business', accettoCondizioni: true, codice: '123456', gettone: 'g'.repeat(20) };

beforeEach(() => {
  vi.resetModules();
  db.preventivo = { seller_id: ODG, codice: CODICE, stato: 'aperto', fascia_scelta: null, profiles: { store_name: 'Ora del Gusto' } };
  db.scheda = {
    tipo: 'scheda-cliente', id_attivita: ODG,
    campi: {
      indirizzo: { valore: 'Via Roma 10, Piacenza', stato: 'confermato', fonte: 'https://example.org' },
      telefono: { valore: '0523 123456', stato: 'da_confermare', fonte: 'https://example.org' },
    },
  };
  db.profiloAggiornato = [];
  db.abbonamenti = [];
  db.utenteAggiornato = [];
  db.erroreUtente = null;
  db.altriUtenti = [];
  db.posta = [];
  db.avvisi = [];
  db.testiAvvisi = [];
  db.emailUtente = 'titolare@example.it';
  db.casse = [];
});

describe('accettare dal link col codice', () => {
  it('email collegata, profilo in revisione SENZA i dati della scheda (non ha ancora pagato), link per entrare, cassa aperta', async () => {
    const r = await accetta(BUONO);
    expect(r.status).toBe(200);
    expect((await r.json()).data.url).toBe('https://checkout.stripe.test/s1');
    expect(db.utenteAggiornato).toEqual([{ id: ODG, email: 'titolare@example.it', email_confirm: true, ban_duration: 'none' }]);
    expect(db.profiloAggiornato).toHaveLength(1);
    // 25/11/2026 — Nicola: la scheda nasce solo dopo l'abbonamento. L'indirizzo entra al primo pagamento.
    expect(db.profiloAggiornato[0]).not.toHaveProperty('store_address');
    expect(db.profiloAggiornato[0]).toMatchObject({ approval_status: 'pending' });
    expect(db.profiloAggiornato[0]).not.toHaveProperty('store_phone');
    expect(db.preventivo?.stato).toBe('accettato');
    expect(db.preventivo?.fascia_scelta).toBe('business');
    expect(db.posta).toHaveLength(1);
    expect(db.posta[0].to).toBe('titolare@example.it');
    expect(String(db.posta[0].html)).toContain('https://supabase.test/verify?token=t');
    expect(db.avvisi[0]).toContain('Ora del Gusto');
    expect(db.casse[0]).toMatchObject({ sellerId: ODG, email: 'titolare@example.it', fascia: 'business' });
  });

  it('chi ha già pagato un abbonamento prima: la scheda è aperta e l’indirizzo confermato entra nel profilo', async () => {
    db.abbonamenti = [{ stato: 'canceled' }];
    expect((await accetta(BUONO)).status).toBe(200);
    expect(db.profiloAggiornato[0]).toMatchObject({ store_address: 'Via Roma 10, Piacenza', approval_status: 'pending' });
    expect(db.profiloAggiornato[0]).not.toHaveProperty('store_phone');
  });

  it('senza scheda di n8n si accetta lo stesso: il profilo va in revisione senza dati inventati', async () => {
    db.scheda = null;
    expect((await accetta(BUONO)).status).toBe(200);
    expect(db.profiloAggiornato[0]).not.toHaveProperty('store_address');
    expect(db.profiloAggiornato[0]).toMatchObject({ approval_status: 'pending' });
  });

  it('un secondo invio non accetta due volte e non apre un altra cassa', async () => {
    await accetta(BUONO);
    const r = await accetta({ ...BUONO, email: 'altro@example.it' });
    expect(r.status).toBe(409);
    expect(db.utenteAggiornato).toHaveLength(1);
    expect(db.casse).toHaveLength(1);
  });

  it('un email già usata da un altro account: niente, e il preventivo torna aperto', async () => {
    db.erroreUtente = { message: 'A user with this email address has already been registered', code: 'email_exists' };
    const r = await accetta(BUONO);
    expect(r.status).toBe(409);
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.profiloAggiornato).toHaveLength(0);
    expect(db.casse).toHaveLength(0);
  });

  it('un codice sbagliato o nella forma sbagliata non trova niente', async () => {
    expect((await accetta(BUONO, 'b'.repeat(64))).status).toBe(404);
    expect((await accetta(BUONO, 'corto')).status).toBe(404);
    expect(db.utenteAggiornato).toHaveLength(0);
  });

  it('senza il sì alle condizioni, o senza email valida, niente', async () => {
    expect((await accetta({ ...BUONO, accettoCondizioni: false })).status).toBe(400);
    expect((await accetta({ ...BUONO, email: 'non-email' })).status).toBe(400);
    expect((await accetta({ ...BUONO, abbonamento: 'oro' })).status).toBe(400);
    expect(db.preventivo?.stato).toBe('aperto');
  });

  it('28/11: i servizi confermati sono almeno uno e solo fra i quattro, sennò niente', async () => {
    expect((await accetta({ ...BUONO, servizi: [] })).status).toBe(400);
    expect((await accetta({ ...BUONO, servizi: ['volantini'] })).status).toBe(400);
    expect((await accetta({ ...BUONO, servizi: ['sito_web', 'prenotazioni'] })).status).toBe(400);
    expect(db.preventivo?.stato).toBe('aperto');
    expect(db.utenteAggiornato).toHaveLength(0);
  });

  it('un preventivo chiuso non si accetta', async () => {
    db.preventivo!.stato = 'chiuso';
    expect((await accetta(BUONO)).status).toBe(409);
    expect(db.utenteAggiornato).toHaveLength(0);
  });
});

async function paga(codice = CODICE) {
  const { POST } = await import('@/app/api/preventivo/[codice]/paga/route');
  return POST(new Request(`https://mycity.example/api/preventivo/${codice}/paga`, { method: 'POST' }), { params: Promise.resolve({ codice }) });
}

describe('dopo aver accettato (collaudo del 24/11)', () => {
  it('l avviso a Nicola dice l email data e che mancano i dati dell iscrizione', async () => {
    await accetta(BUONO);
    expect(db.testiAvvisi[0]).toContain('titolare@example.it');
    expect(db.testiAvvisi[0]).toContain('IBAN');
  });

  // Il 24/11 l'email già usata e il guasto davano lo stesso messaggio, perché da qui non si scoprisse se un'email è
  // su MyCity. Dal 27/11 si arriva qui solo col codice dell'email giusto: chi legge ha dimostrato che la casella è
  // sua. La regola cambia apposta (Nicola, Luna Rossa, 27/11 23:34): l'email già usata si dice chiaro, il guasto no.
  it('dopo il codice giusto l email già usata si dice chiaro, il guasto resta col messaggio prudente', async () => {
    db.erroreUtente = { message: 'already registered', code: 'email_exists' };
    const uno = await accetta(BUONO);
    db.erroreUtente = { message: 'boom' };
    const due = await accetta(BUONO);
    expect(uno.status).toBe(409);
    expect(due.status).toBe(409);
    const [primo, secondo] = [(await uno.json()).error.message, (await due.json()).error.message];
    expect(primo).toContain('ha già un account');
    expect(secondo).not.toContain('ha già un account');
    expect(secondo).toContain('Non sono riuscito a collegare questa email');
  });

  it('la risposta vera di Supabase (500 «Error updating user») con l email su un altro utente si riconosce', async () => {
    db.erroreUtente = { message: 'Error updating user', code: 'unexpected_failure' };
    db.altriUtenti = [{ id: 'cliente-1', email: 'titolare@example.it' }];
    const r = await accetta(BUONO);
    expect(r.status).toBe(409);
    expect((await r.json()).error.message).toContain('ha già un account');
    expect(db.preventivo?.stato).toBe('aperto');
  });

  it('chi ha accettato e non ha pagato paga dal link, con la fascia scelta e l email collegata', async () => {
    await accetta(BUONO);
    db.casse = [];
    const r = await paga();
    expect(r.status).toBe(200);
    expect(db.casse).toHaveLength(1);
    expect(db.casse[0]).toMatchObject({ sellerId: ODG, email: 'titolare@example.it', fascia: 'business' });
    expect(String(db.casse[0].chiaveExtra)).toMatch(/^link-[0-9a-f]{16}$/);
  });

  it('prima di accettare non si paga dal link', async () => {
    expect((await paga()).status).toBe(409);
    expect(db.casse).toHaveLength(0);
  });

  it('con l email segnaposto (.local) non si apre nessuna cassa', async () => {
    await accetta(BUONO);
    db.casse = [];
    db.emailUtente = 'ora-del-gusto.preventivo@mycity-system.local';
    expect((await paga()).status).toBe(503);
    expect(db.casse).toHaveLength(0);
  });
});
