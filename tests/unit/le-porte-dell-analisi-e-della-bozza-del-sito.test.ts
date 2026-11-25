import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 24/11/2026 — LE PORTE DELL'ANALISI DEL BUSINESS E DELLA BOZZA DEL SITO.
 *
 * Nicola: «dentro il servizio di analisi… ci deve essere anche l'analisi dei social, google, sito, e
 * ci deve essere un luogo dove l'imprenditore deve inserire l'id dei social e google». E la bozza del
 * sito la scrive «l'AD in un giro», mai il sito con un'IA a pagamento.
 *
 *  · /api/seller/canali — salva i cinque canali nei social della vetrina senza toccare il resto, rifiuta
 *    gli indirizzi interni, e chiede a n8n un'analisi nuova solo se i canali cambiano;
 *  · /api/seller/analisi-sito — Google PageSpeed (gratuito) al massimo una volta al giorno per negozio;
 *  · /api/agenzia/analisi-canali — n8n legge chi aspetta e manda l'analisi: segreto, https, formato;
 *  · /api/agenzia/bozza-sito — l'AD legge chi aspetta e manda la bozza: segreto suo, mai prezzi,
 *    ogni testo «da confermare», un tetto di dimensione.
 */

const NEGOZIO = '0de1905e-7000-4000-8000-000000000001';

const db = vi.hoisted(() => ({
  righe: {} as Record<string, unknown[]>,
  singola: {} as Record<string, unknown>,
  upsert: [] as Array<{ tabella: string; riga: Record<string, unknown> }>,
  update: [] as Array<{ tabella: string; valori: Record<string, unknown> }>,
  utente: { id: '0de1905e-7000-4000-8000-000000000001' },
  /** Il tentativo di oggi è già segnato: la scrittura condizionata non trova la riga. */
  tentatoOggi: false,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 60 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAnchePendingRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: db.utente, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const q: Record<string, unknown> & { singola: boolean } = {
        singola: false,
        select: () => q, eq: () => q, in: () => q, not: () => q, order: () => q, limit: () => q,
        maybeSingle: () => { q.singola = true; return q; },
        upsert: async (riga: Record<string, unknown>) => { db.upsert.push({ tabella, riga }); return { error: null }; },
        update: (valori: Record<string, unknown>) => {
          const u: Record<string, unknown> = {
            eq: () => u, or: () => u, select: () => u,
            then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
              const scrive = !(tabella === 'analisi_negozi' && 'sito_tentato_il' in valori && db.tentatoOggi);
              if (scrive) db.update.push({ tabella, valori });
              return Promise.resolve({ data: scrive ? [{}] : [], error: null }).then(ok, ko);
            },
          };
          return u;
        },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
          Promise.resolve(q.singola ? { data: db.singola[tabella] ?? null, error: null } : { data: db.righe[tabella] ?? [], error: null }).then(ok, ko),
      };
      return q;
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  db.righe = {};
  db.singola = {};
  db.upsert = [];
  db.update = [];
  db.tentatoOggi = false;
  process.env.N8N_SCHEDA_CLIENTE_SEGRETO = 'segreto-n8n';
  process.env.AD_BOZZA_SITO_SEGRETO = 'segreto-ad';
});

const richiesta = (url: string, metodo: string, corpo?: unknown, testate: Record<string, string> = {}) =>
  new Request(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', ...testate },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

/* ─────────────────────────────── I tuoi canali ─────────────────────────────── */

describe('/api/seller/canali', () => {
  const salva = async (corpo: unknown) => {
    const { POST } = await import('@/app/api/seller/canali/route');
    return POST(richiesta('https://mycity.example/api/seller/canali', 'POST', corpo) as never);
  };

  it('salva i cinque canali nei social della vetrina, tiene WhatsApp e il resto, e chiede l analisi', async () => {
    db.singola.profiles = { role: 'seller', store_customization: { tagline: 'Il buongiorno', socials: { whatsapp: '+393331234567', instagram: 'vecchio' } } };
    const r = await salva({
      instagram: 'https://www.instagram.com/oradelgusto/?igsh=abc',
      facebook: '@oradelgusto',
      tiktok: '',
      google_maps: 'https://maps.app.goo.gl/AbC123',
      website: 'www.oradelgusto.it',
    });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.data.analisiChiesta).toBe(true);
    const scritto = db.update.find((u) => u.tabella === 'profiles')!.valori.store_customization as Record<string, Record<string, string>>;
    expect(scritto.tagline).toBe('Il buongiorno');
    expect(scritto.socials).toEqual({
      whatsapp: '+393331234567',
      instagram: 'oradelgusto',
      facebook: 'oradelgusto',
      tiktok: '',
      google_maps: 'https://maps.app.goo.gl/AbC123',
      website: 'https://www.oradelgusto.it',
    });
    const richiestaAnalisi = db.upsert.find((u) => u.tabella === 'analisi_negozi')!.riga;
    expect(richiestaAnalisi.id_attivita).toBe(NEGOZIO);
    expect(typeof richiestaAnalisi.canali_richiesti_il).toBe('string');
  });

  it('gli indirizzi interni o non pubblici non si salvano, e il campo sbagliato lo dice', async () => {
    db.singola.profiles = { role: 'seller', store_customization: {} };
    for (const website of ['http://192.168.1.1', 'localhost:3000', 'https://intranet.local', 'http://www.oradelgusto.it', 'https://a.it:8443', 'https://nome:pw@a.it', 'javascript:alert(1)']) {
      const r = await salva({ website });
      expect(r.status, website).toBe(400);
      expect((await r.json()).error.details.errori.website, website).toBeTruthy();
    }
    const g = await salva({ google_maps: 'https://example.com/maps/place/x' });
    expect((await g.json()).error.details.errori.google_maps).toContain('Google Maps');
    const ig = await salva({ instagram: 'https://www.instagram.com/p/C0ab12/' });
    expect(ig.status).toBe(400);
    expect(db.update).toHaveLength(0);
    expect(db.upsert).toHaveLength(0);
  });

  it('se i canali non cambiano non si chiede a n8n un altra analisi', async () => {
    db.singola.profiles = { role: 'seller', store_customization: { socials: { instagram: 'oradelgusto', facebook: '', tiktok: '', google_maps: '', website: '' } } };
    const r = await salva({ instagram: 'oradelgusto' });
    expect((await r.json()).data.analisiChiesta).toBe(false);
    expect(db.upsert).toHaveLength(0);
  });

  it('chi non è un negozio non salva canali', async () => {
    db.singola.profiles = { role: 'admin', store_customization: {} };
    expect((await salva({ instagram: 'x' })).status).toBe(403);
  });
});

/* ─────────────────────────────── Il sito (PageSpeed) ─────────────────────────────── */

const PAGESPEED_RISPOSTA = {
  lighthouseResult: {
    categories: { performance: { score: 0.42 }, seo: { score: 0.91 }, accessibility: { score: 0.77 } },
    audits: {
      'largest-contentful-paint': { numericValue: 5234 },
      'meta-description': { score: 0 },
      'image-alt': { score: 0.5 },
      'document-title': { score: 1 },
    },
  },
};

describe('/api/seller/analisi-sito', () => {
  const analizza = async () => {
    const { POST } = await import('@/app/api/seller/analisi-sito/route');
    return POST(richiesta('https://mycity.example/api/seller/analisi-sito', 'POST') as never);
  };

  it('chiede a Google PageSpeed (gratuito), dal telefono, e tiene da parte il risultato in parole semplici', async () => {
    db.singola.profiles = { role: 'seller', store_customization: { socials: { website: 'https://www.oradelgusto.it' } } };
    const chiamate: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { chiamate.push(url); return new Response(JSON.stringify(PAGESPEED_RISPOSTA), { status: 200 }); }));
    const r = await analizza();
    expect(r.status).toBe(200);
    expect(chiamate).toHaveLength(1);
    const u = new URL(chiamate[0]);
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    expect(u.searchParams.get('url')).toBe('https://www.oradelgusto.it/');
    expect(u.searchParams.get('strategy')).toBe('mobile');
    const salvato = db.upsert.find((x) => x.tabella === 'analisi_negozi' && 'sito' in x.riga)!.riga.sito as Record<string, unknown>;
    expect(salvato).toMatchObject({ velocita: 42, seo: 91, accessibilita: 77, secondiPerVedere: 5.2, fonte: 'Google PageSpeed Insights' });
    expect(salvato.daSistemare).toEqual([
      'Manca la descrizione che Google mostra sotto il nome del sito.',
      'Alcune immagini non hanno una descrizione: chi non vede e Google non sanno cosa mostrano.',
    ]);
    vi.unstubAllGlobals();
  });

  it('una volta al giorno: lo stesso giorno risponde col risultato tenuto da parte, senza richiamare Google', async () => {
    const oggi = new Date().toISOString();
    const giaFatto = { url: 'https://www.oradelgusto.it/', fatta_il: oggi, fonte: 'Google PageSpeed Insights', velocita: 80, seo: 90, accessibilita: 95, secondiPerVedere: 2, daSistemare: [] };
    db.singola.profiles = { role: 'seller', store_customization: { socials: { website: 'https://www.oradelgusto.it' } } };
    db.singola.analisi_negozi = { sito: giaFatto, sito_il: oggi };
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await analizza();
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ giaFattaOggi: true, sito: { velocita: 80 } });
    expect(f).not.toHaveBeenCalled();
    // E cambiando il sito lo stesso giorno, il tetto vale lo stesso.
    db.singola.profiles = { role: 'seller', store_customization: { socials: { website: 'https://altro-sito.it' } } };
    db.tentatoOggi = true;
    expect((await analizza()).status).toBe(429);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('anche un tentativo andato male conta: il secondo dello stesso giorno non richiama Google (collaudo)', async () => {
    db.singola.profiles = { role: 'seller', store_customization: { socials: { website: 'https://www.oradelgusto.it' } } };
    const f = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', f);
    expect((await analizza()).status).toBe(502);
    expect(db.update.some((u) => u.tabella === 'analisi_negozi' && 'sito_tentato_il' in u.valori)).toBe(true);
    db.tentatoOggi = true; // il tentativo è segnato nel database
    expect((await analizza()).status).toBe(429);
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('senza un sito pubblico non chiama Google', async () => {
    db.singola.profiles = { role: 'seller', store_customization: { socials: { website: 'http://10.0.0.1' } } };
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await analizza()).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/* ─────────────────────────────── n8n: l'analisi dei canali ─────────────────────────────── */

const ANALISI = {
  tipo: 'analisi-canali',
  origine: 'n8n-18',
  id_attivita: NEGOZIO,
  fatta_il: '2026-11-25T09:00:00Z',
  canali: {
    instagram: {
      stato: 'fatta',
      fonte: 'https://www.instagram.com/oradelgusto/',
      letto_il: '2026-11-25T08:58:00Z',
      numeri: { follower: 812, post_ultimi_30_giorni: 3 },
      osservazioni: ['Pubblica circa una volta a settimana', 'Promo cornetto a 1,50 €'],
      consigli: ['Tre post a settimana, con le storie del mattino'],
    },
    facebook: { stato: 'non_trovato' },
    tiktok: { stato: 'non_disponibile' },
  },
};

describe('/api/agenzia/analisi-canali', () => {
  const manda = async (corpo: unknown, testate: Record<string, string> = { 'x-mycity-segreto': 'segreto-n8n' }) => {
    const { POST } = await import('@/app/api/agenzia/analisi-canali/route');
    return POST(richiesta('https://mycity.example/api/agenzia/analisi-canali', 'POST', corpo, testate));
  };

  it('col segreto giusto salva l analisi, tolte le frasi con un prezzo', async () => {
    db.singola.profiles = { id: NEGOZIO, role: 'seller' };
    const r = await manda(ANALISI);
    expect(r.status).toBe(200);
    const riga = db.upsert.find((x) => x.tabella === 'analisi_negozi')!.riga;
    const canali = (riga.canali as typeof ANALISI).canali;
    expect(canali.instagram.osservazioni).toEqual(['Pubblica circa una volta a settimana']);
    expect(canali.instagram.numeri).toEqual({ follower: 812, post_ultimi_30_giorni: 3 });
    expect(typeof riga.canali_il).toBe('string');
    // «non_disponibile» (sessione n8n, 24/11): canale che non si legge coi mezzi consentiti.
    expect(canali.tiktok.stato).toBe('non_disponibile');
  });

  it('senza segreto, col segreto sbagliato, in http o senza segreto configurato non entra niente', async () => {
    db.singola.profiles = { id: NEGOZIO, role: 'seller' };
    expect((await manda(ANALISI, {})).status).toBe(401);
    expect((await manda(ANALISI, { 'x-mycity-segreto': 'segreto-n8m' })).status).toBe(401);
    expect((await manda(ANALISI, { 'x-mycity-segreto': 'segreto-n8n', 'x-forwarded-proto': 'http' })).status).toBe(403);
    delete process.env.N8N_SCHEDA_CLIENTE_SEGRETO;
    expect((await manda(ANALISI)).status).toBe(503);
    expect(db.upsert).toHaveLength(0);
  });

  it('un formato sbagliato, un negozio che non c è o un negozio di sistema si rifiutano', async () => {
    db.singola.profiles = { id: NEGOZIO, role: 'seller' };
    expect((await manda({ ...ANALISI, canali: { instagram: { stato: 'bellissimo' } } })).status).toBe(400);
    expect((await manda({ ...ANALISI, canali: { instagram: { stato: 'fatta', fonte: 'javascript:alert(1)' } } })).status).toBe(400);
    expect((await manda({ ...ANALISI, canali: { linkedin: { stato: 'fatta' } } })).status).toBe(400);
    // Una fonte che non è un indirizzo vero farebbe cadere la pagina del negozio (collaudo).
    expect((await manda({ ...ANALISI, canali: { instagram: { stato: 'fatta', fonte: 'https://' } } })).status).toBe(400);
    expect((await manda({ ...ANALISI, canali: { instagram: { stato: 'fatta', fonte: 'https://a b' } } })).status).toBe(400);
    expect((await manda({ ...ANALISI, id_attivita: '11111111-1111-1111-1111-5d9000000001' })).status).toBe(400);
    db.singola.profiles = null;
    expect((await manda(ANALISI)).status).toBe(404);
    expect(db.upsert).toHaveLength(0);
  });

  it('GET dà a n8n solo i negozi che aspettano, coi canali pubblici e niente dati del titolare', async () => {
    db.righe.analisi_negozi = [
      { id_attivita: NEGOZIO, canali_richiesti_il: '2026-11-25T10:00:00Z', canali_il: '2026-11-24T10:00:00Z' },
      { id_attivita: 'b0000000-0000-4000-8000-000000000002', canali_richiesti_il: '2026-11-20T10:00:00Z', canali_il: '2026-11-21T10:00:00Z' },
    ];
    db.righe.profiles = [{
      id: NEGOZIO, role: 'seller', store_name: 'Ora del Gusto', business_type: 'bar', store_address: 'Via Roma 10, Piacenza',
      // Il sito salvato dal site builder con un indirizzo interno non arriva a n8n (collaudo).
      store_customization: { socials: { instagram: 'oradelgusto', whatsapp: '+393331234567', website: 'http://169.254.169.254/' } },
    }];
    const { GET } = await import('@/app/api/agenzia/analisi-canali/route');
    const r = await GET(richiesta('https://mycity.example/api/agenzia/analisi-canali', 'GET', undefined, { 'x-mycity-segreto': 'segreto-n8n' }));
    const corpo = await r.json();
    expect(corpo.richieste).toEqual([{
      id_attivita: NEGOZIO, nome: 'Ora del Gusto', tipo: 'bar', indirizzo: 'Via Roma 10, Piacenza',
      richiesta_il: '2026-11-25T10:00:00Z', canali: { instagram: 'oradelgusto' },
    }]);
    expect(JSON.stringify(corpo)).not.toContain('393331234567');
    const senza = await GET(richiesta('https://mycity.example/api/agenzia/analisi-canali', 'GET'));
    expect(senza.status).toBe(401);
  });
});

/* ─────────────────────────────── L'AD: la bozza del sito ─────────────────────────────── */

const testo = (t: string) => ({ testo: t, stato: 'da_confermare' });
const BOZZA = {
  tipo: 'bozza-sito',
  id_attivita: NEGOZIO,
  scritta_il: '2026-11-25T07:30:00Z',
  origine: 'ad-mycity',
  sottotitolo: 'Bar e pasticceria nel cuore di Piacenza.',
  sezioni: {
    chi_siamo: testo('Ora del Gusto è il bar e pasticceria di via Roma: brioche fatte in casa ogni mattina.'),
    cosa_offriamo: testo('Colazioni con brioche e torte della casa, caffetteria e pasticceria su ordinazione.'),
    dove_siamo: testo('Ci trovi in via Roma 10, a Piacenza. Gli orari li conferma il titolare.'),
    contatti: testo('Scrivici su WhatsApp o passa a trovarci: i contatti li conferma il titolare.'),
  },
  fonti: ['https://www.instagram.com/oradelgusto/'],
};

describe('/api/agenzia/bozza-sito', () => {
  const manda = async (corpo: unknown, testate: Record<string, string> = { 'x-mycity-segreto': 'segreto-ad' }) => {
    const { POST } = await import('@/app/api/agenzia/bozza-sito/route');
    return POST(richiesta('https://mycity.example/api/agenzia/bozza-sito', 'POST', corpo, testate));
  };

  it('col segreto dell AD la bozza si salva per quel negozio', async () => {
    db.singola.profiles = { id: NEGOZIO, role: 'seller' };
    const r = await manda(BOZZA);
    expect(r.status).toBe(200);
    const riga = db.upsert.find((x) => x.tabella === 'bozze_sito')!.riga;
    expect(riga.id_attivita).toBe(NEGOZIO);
    expect((riga.bozza as typeof BOZZA).sezioni.chi_siamo.testo).toContain('brioche fatte in casa');
  });

  it('un prezzo in qualunque testo, una sezione senza «da confermare» o una sezione mancante: rifiutata', async () => {
    db.singola.profiles = { id: NEGOZIO, role: 'seller' };
    const conPrezzo = { ...BOZZA, sezioni: { ...BOZZA.sezioni, cosa_offriamo: testo('Colazione completa a soli 3,50 € tutte le mattine della settimana.') } };
    const r = await manda(conPrezzo);
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toContain('prezzi');
    expect((await manda({ ...BOZZA, sottotitolo: 'Caffè a 1 euro' })).status).toBe(400);
    // Gli orari scritti col punto non sono prezzi (collaudo).
    expect((await manda({ ...BOZZA, sezioni: { ...BOZZA.sezioni, dove_siamo: testo('Ci trovi in via Roma 10: aperti dalle 8.30 alle 19.30, dal lunedì al sabato.') } })).status).toBe(200);
    db.upsert = [];
    expect((await manda({ ...BOZZA, sezioni: { ...BOZZA.sezioni, contatti: { testo: 'Telefono e WhatsApp a un tocco dal telefono.', stato: 'confermato' } } })).status).toBe(400);
    const { contatti: _tolta, ...tre } = BOZZA.sezioni;
    expect((await manda({ ...BOZZA, sezioni: tre })).status).toBe(400);
    expect(db.upsert).toHaveLength(0);
  });

  it('il segreto è dell AD (non quello di n8n), solo https, e oltre 32 KB non entra', async () => {
    db.singola.profiles = { id: NEGOZIO, role: 'seller' };
    expect((await manda(BOZZA, { 'x-mycity-segreto': 'segreto-n8n' })).status).toBe(401);
    expect((await manda(BOZZA, { 'x-mycity-segreto': 'segreto-ad', 'x-forwarded-proto': 'http' })).status).toBe(403);
    expect((await manda({ ...BOZZA, fonti: ['https://a.it/' + 'x'.repeat(40_000)] })).status).toBe(413);
    delete process.env.AD_BOZZA_SITO_SEGRETO;
    expect((await manda(BOZZA)).status).toBe(503);
    expect(db.upsert).toHaveLength(0);
  });

  it('GET dà all AD i negozi senza sito che aspettano la bozza, senza telefono e senza prezzi', async () => {
    db.righe.profiles = [
      { id: NEGOZIO, role: 'seller', store_name: 'Ora del Gusto', business_type: 'bar', store_address: 'Via Roma 10', store_description: 'Bar e pasticceria, chiamate Mario al 333 765 4321', store_customization: { socials: {} }, approval_status: null },
      { id: 'c0000000-0000-4000-8000-000000000003', role: 'seller', store_name: 'Ha già il sito', store_customization: { socials: { website: 'https://hagia.it' } } },
      { id: '11111111-1111-1111-1111-5d9000000001', role: 'seller', store_name: 'SDG Agenzia', store_customization: {} },
    ];
    db.righe.bozze_sito = [];
    db.righe.schede_clienti = [{
      id_attivita: NEGOZIO, aggiornata_il: '2026-11-24T10:00:00Z',
      scheda: {
        tipo: 'scheda-cliente', id_attivita: NEGOZIO,
        campi: {
          telefono: { valore: '333 1234567', stato: 'confermato', fonte: 'https://example.org' },
          orari: { valore: 'Lun–Sab 7.30–19.30', stato: 'da_confermare', fonte: 'https://example.org' },
          link_prenotazione: { valore: 'https://wa.me/393331234567', stato: 'confermato', fonte: 'https://example.org' },
          menu_testo: { valore: 'Brioche alla crema\nCappuccino 1,50 €', stato: 'da_confermare', fonte: null },
        },
      },
    }];
    db.righe.products = [{ name: 'Torta di mele' }, { name: 'Brioche 1,20 €' }];
    // 25/11/2026 — La scheda si usa solo dopo l'abbonamento: Ora del Gusto ha pagato.
    db.righe.abbonamenti_servizi = [{ seller_id: NEGOZIO, stato: 'active' }];
    const { GET } = await import('@/app/api/agenzia/bozza-sito/route');
    const r = await GET(richiesta('https://mycity.example/api/agenzia/bozza-sito', 'GET', undefined, { 'x-mycity-segreto': 'segreto-ad' }));
    const corpo = await r.json();
    // 25/11/2026 sera — Chi ha già un sito, senza il giudizio dell'AD, vale «medio»: il Business lo rifà, quindi aspetta la bozza.
    expect(corpo.negozi.map((n: { nome: string; perche: string }) => [n.nome, n.perche])).toEqual([['Ora del Gusto', 'nessuna_bozza'], ['Ha già il sito', 'sito_da_rifare']]);
    const n = corpo.negozi[0];
    expect(n.perche).toBe('nessuna_bozza');
    expect(n.dati.prodotti).toEqual(['Torta di mele']);
    expect(n.dati.prodotti_tipici).toEqual(['Brioche alla crema']);
    expect(Object.keys(n.dati.campi_della_scheda)).toEqual(['orari']);
    expect(n.dati.descrizione).toBe('Bar e pasticceria, chiamate Mario al [telefono]');
    expect(JSON.stringify(corpo)).not.toMatch(/333 1234567|3331234567|765 4321|1,50|1,20/);
  });

  // 25/11/2026 — Nicola: la scheda del cliente nasce solo dopo l'abbonamento. Per chi è in demo l'AD
  // scrive la bozza con l'analisi e la vetrina: niente campi della scheda, niente prodotti dal menu.
  it('GET: per un negozio in demo i campi della scheda restano chiusi, l analisi no', async () => {
    db.righe.profiles = [{ id: NEGOZIO, role: 'seller', store_name: 'La Ragazzetta', store_customization: { socials: {} }, visibile_senza_abbonamento: false }];
    db.righe.bozze_sito = [];
    db.righe.abbonamenti_servizi = [];
    db.righe.schede_clienti = [{
      id_attivita: NEGOZIO, aggiornata_il: '2026-11-25T10:00:00Z',
      scheda: {
        tipo: 'scheda-cliente', id_attivita: NEGOZIO,
        campi: { orari: { valore: 'Lun–Sab 7.30–19.30', stato: 'confermato', fonte: 'https://example.org' }, menu_testo: { valore: 'Tortelli\nPisarei', stato: 'confermato', fonte: null } },
        analisi: { punti_di_forza: ['Cucina piacentina fatta in casa'] },
      },
    }];
    db.righe.products = [];
    const { GET } = await import('@/app/api/agenzia/bozza-sito/route');
    const corpo = await (await GET(richiesta('https://mycity.example/api/agenzia/bozza-sito', 'GET', undefined, { 'x-mycity-segreto': 'segreto-ad' }))).json();
    const n = corpo.negozi[0];
    expect(n.dati.campi_della_scheda).toEqual({});
    expect(n.dati.prodotti_tipici).toEqual([]);
    expect(n.dati.punti_di_forza).toEqual(['Cucina piacentina fatta in casa']);
  });
});
