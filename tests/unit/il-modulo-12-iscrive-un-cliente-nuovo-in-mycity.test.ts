import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 25/11/2026 — IL MODULO 12 ISCRIVE UN CLIENTE NUOVO IN MYCITY.
 *
 * Nicola: «modifica il modulo 12 e permetti di iscrivere un nuovo cliente dentro mycity», «come Ora del
 * Gusto»: senza accesso, fuori vetrina, col link col codice. Queste prove diventano rosse se la porta si
 * apre senza segreto, se il negozio nasce approvato o visibile, se due invii creano due negozi, o se il
 * modulo riscrive un'attività che ha già accettato.
 */

const db = vi.hoisted(() => ({
  utenti: new Map<string, { id: string; email: string; banned_until?: string; created_at: string; app_metadata?: Record<string, unknown> }>(),
  profili: new Map<string, Record<string, unknown>>(),
  link: new Map<string, { seller_id: string; codice: string; stato?: string }>(),
  creaUtente: [] as Array<Record<string, unknown>>,
  ultimoId: 0,
  rompiProfilo: 0,
  /** Quanti minuti fa nascono gli utenti creati adesso (per simulare un'iscrizione vecchia). */
  etaMinuti: 0,
  /** Un altro invio scrive il link un attimo prima di questo (due invii insieme). */
  linkDaAltri: false,
  rompiLink: 0,
  /** La lettura degli utenti di Supabase Auth non riesce. */
  rompiLista: false,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 20 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: {
      admin: {
        createUser: async (o: { email: string } & Record<string, unknown>) => {
          db.creaUtente.push(o);
          if ([...db.utenti.values()].some((u) => u.email === o.email)) return { data: { user: null }, error: { message: 'already registered' } };
          db.ultimoId += 1;
          const id = `00000000-0000-4000-8000-${String(db.ultimoId).padStart(12, '0')}`;
          const creato = new Date(Date.now() - db.etaMinuti * 60_000).toISOString();
          db.utenti.set(id, {
            id, email: o.email, created_at: creato,
            ...(o.ban_duration ? { banned_until: new Date(Date.now() + 365 * 86_400_000).toISOString() } : {}),
            ...(o.app_metadata ? { app_metadata: o.app_metadata as Record<string, unknown> } : {}),
          });
          db.profili.set(id, { id, role: 'pending_approval' });
          return { data: { user: { id } }, error: null };
        },
        getUserById: async (id: string) => ({ data: { user: db.utenti.get(id) ?? null }, error: null }),
        listUsers: async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) =>
          db.rompiLista
            ? { data: null, error: { message: 'auth non risponde' } }
            : { data: { users: [...db.utenti.values()].slice((page - 1) * perPage, page * perPage) }, error: null },
      },
    },
    from: (tabella: string) => {
      const filtri: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { filtri[c] = v; return q; },
        maybeSingle: async () => ({
          data: tabella === 'profiles' ? db.profili.get(String(filtri.id)) ?? null
            : tabella === 'preventivi_con_codice' ? db.link.get(String(filtri.seller_id)) ?? null : null,
          error: null,
        }),
        upsert: (riga: Record<string, unknown>, o?: { ignoreDuplicates?: boolean }) => {
          // Come PostgREST: l'upsert si può attendere da solo, oppure con .select() che restituisce le righe
          // scritte davvero (con ignoreDuplicates, nessuna se la riga c'era già).
          let esito: { error: { message: string } | null; data: unknown[] };
          if (tabella === 'profiles' && db.rompiProfilo > 0) { db.rompiProfilo -= 1; esito = { error: { message: 'connessione persa' }, data: [] }; }
          // Come il vincolo della migrazione 703 (profiles_business_type_detail_check): oltre 60 caratteri il database rifiuta.
          else if (tabella === 'profiles' && typeof riga.business_type_detail === 'string' && Array.from(riga.business_type_detail).length > 60) {
            esito = { error: { message: 'new row for relation "profiles" violates check constraint "profiles_business_type_detail_check"' }, data: [] };
          }
          else if (tabella === 'profiles') { db.profili.set(String(riga.id), { ...db.profili.get(String(riga.id)), ...riga }); esito = { error: null, data: [riga] }; }
          else if (tabella === 'preventivi_con_codice' && db.rompiLink > 0) { db.rompiLink -= 1; esito = { error: { message: 'connessione persa' }, data: [] }; }
          else if (tabella === 'preventivi_con_codice') {
            const scritta = !(o?.ignoreDuplicates && (db.link.has(String(riga.seller_id)) || db.linkDaAltri));
            if (db.linkDaAltri && !db.link.has(String(riga.seller_id))) db.link.set(String(riga.seller_id), { seller_id: String(riga.seller_id), codice: 'd'.repeat(64), stato: 'aperto' });
            if (scritta) db.link.set(String(riga.seller_id), { stato: 'aperto', ...(riga as { seller_id: string; codice: string }) });
            esito = { error: null, data: scritta ? [{ seller_id: riga.seller_id }] : [] };
          } else esito = { error: null, data: [] };
          const promessa = Promise.resolve(esito);
          return Object.assign(promessa, { select: () => promessa });
        },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          const nome = filtri['profiles.store_name'];
          const righe = [...db.link.values()].filter((l) => db.profili.get(l.seller_id)?.store_name === nome);
          return Promise.resolve({ data: righe, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  }),
}));

const SEGRETO = 'segreto-di-prova-1234567890';
const chiama = async (corpo: unknown, segreto: string | null = SEGRETO) => {
  const { POST } = await import('@/app/api/agenzia/nuova-attivita/route');
  const h: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-proto': 'https' };
  if (segreto) h['x-mycity-segreto'] = segreto;
  return POST(new Request('https://www.mycity-marketplace.com/api/agenzia/nuova-attivita', { method: 'POST', headers: h, body: JSON.stringify(corpo) }));
};
const BAR = { tipo: 'nuova-attivita', nome: 'Bar Prova', tipo_attivita: 'bar', citta: 'Piacenza', indirizzo: 'Via Roma 1' };

beforeEach(() => {
  db.utenti.clear(); db.profili.clear(); db.link.clear(); db.creaUtente.length = 0; db.ultimoId = 0; db.rompiProfilo = 0; db.etaMinuti = 0; db.linkDaAltri = false; db.rompiLink = 0; db.rompiLista = false;
  process.env.N8N_SCHEDA_CLIENTE_SEGRETO = SEGRETO;
});

describe('la porta del modulo 12', () => {
  it('senza segreto configurato resta chiusa', async () => {
    delete process.env.N8N_SCHEDA_CLIENTE_SEGRETO;
    expect((await chiama(BAR)).status).toBe(503);
  });
  it('col segreto sbagliato non iscrive niente', async () => {
    expect((await chiama(BAR, 'sbagliato')).status).toBe(401);
    expect(db.creaUtente).toHaveLength(0);
  });
  it('rifiuta un corpo senza nome', async () => {
    expect((await chiama({ tipo: 'nuova-attivita', nome: '' })).status).toBe(400);
  });
});

describe('il negozio nasce come Ora del Gusto', () => {
  it('senza accesso, con email finta, venditore non approvato, fuori vetrina e col link', async () => {
    const r = await chiama(BAR);
    expect(r.status).toBe(201);
    const { id_attivita } = (await r.json()) as { id_attivita: string };
    const u = db.creaUtente[0];
    expect(String(u.email)).toMatch(/\.preventivo@mycity-system\.local$/);
    expect(u.ban_duration).toBeTruthy();
    const p = db.profili.get(id_attivita)!;
    expect(p).toMatchObject({ role: 'seller', is_approved: false, approval_status: null, store_name: 'Bar Prova', business_type: 'bar' });
    expect(p.store_address).toBe('Via Roma 1, Piacenza');
    expect(db.link.get(id_attivita)?.codice).toMatch(/^[0-9a-f]{64}$/);
  });

  // 25/11/2026 — Nicola: l'analisi parte subito, da tutte e due le porte. Chi nasce dal modulo 12 va
  // anche al flusso 16, come chi si iscrive da /sell. Una seconda volta (stesso negozio) no.
  it('un negozio nuovo va anche al flusso 16; lo stesso negozio rimandato no', async () => {
    const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { chiamate.push({ url, corpo: JSON.parse(String(init.body)) }); return new Response('{}', { status: 200 }); }));
    process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL = 'https://n8n.example/webhook/mycity-nuovo-cliente';
    process.env.N8N_NUOVO_CLIENTE_SEGRETO = 'segreto-16';
    try {
      const { id_attivita } = (await (await chiama(BAR)).json()) as { id_attivita: string };
      await vi.waitFor(() => expect(chiamate).toHaveLength(1));
      expect(chiamate[0].url).toBe('https://n8n.example/webhook/mycity-nuovo-cliente');
      expect(chiamate[0].corpo).toMatchObject({ tipo: 'nuovo-cliente', provenienza: 'modulo-12', attivita: { id: id_attivita, nome: 'Bar Prova', tipo: 'bar', citta: 'Piacenza' } });
      expect((await chiama(BAR)).status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      expect(chiamate).toHaveLength(1);
    } finally {
      delete process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL;
      delete process.env.N8N_NUOVO_CLIENTE_SEGRETO;
      vi.unstubAllGlobals();
    }
  });

  it('lo stesso nome e città mandati due volte non creano due negozi né cambiano il link', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    const codice = db.link.get(a.id_attivita)!.codice;
    const r = await chiama(BAR);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { id_attivita: string; nuova: boolean };
    expect(b).toMatchObject({ id_attivita: a.id_attivita, nuova: false });
    expect(db.utenti.size).toBe(1);
    expect(db.link.get(a.id_attivita)!.codice).toBe(codice);
  });

  it('un iscrizione fermata a metà (utente creato, profilo no) si finisce al secondo invio, senza doppioni (collaudo del 27/11)', async () => {
    db.rompiProfilo = 1;
    db.etaMinuti = 10;
    expect((await chiama(BAR)).status).toBe(503);
    expect(db.utenti.size).toBe(1);
    expect(db.link.size).toBe(0);
    const r = await chiama(BAR);
    expect(r.status).toBe(201);
    const b = (await r.json()) as { id_attivita: string; nuova: boolean };
    expect(b.nuova).toBe(true);
    expect(db.utenti.size).toBe(1);
    expect(db.profili.get(b.id_attivita)).toMatchObject({ store_name: 'Bar Prova', business_type: 'bar', is_approved: false });
    expect(db.link.has(b.id_attivita)).toBe(true);
    // E un terzo invio è un invio qualunque: stesso negozio, non più «nuovo».
    expect(((await (await chiama(BAR)).json()) as { nuova: boolean }).nuova).toBe(false);
  });

  it('anche col profilo scritto e il link caduto, il secondo invio finisce l iscrizione (consiglio della sessione #345)', async () => {
    db.rompiLink = 1;
    expect((await chiama(BAR)).status).toBe(503);
    expect(db.profili.size).toBe(1);
    expect(db.link.size).toBe(0);
    const r = await chiama(BAR);
    expect(r.status).toBe(201);
    const b = (await r.json()) as { id_attivita: string; nuova: boolean };
    expect(b.nuova).toBe(true);
    expect(db.utenti.size).toBe(1);
    expect(db.link.has(b.id_attivita)).toBe(true);
  });

  it('i paletti del recupero (collaudo del 27/11): niente account altrui, niente omonimi, niente invii doppi', async () => {
    // ① Un account registrato a mano con l'email di sistema (non bloccato) non diventa un negozio.
    const { emailDiSistema } = await import('@/lib/agenzia/nuova-attivita');
    db.utenti.set('estraneo', { id: 'estraneo', email: emailDiSistema(BAR), created_at: new Date(Date.now() - 3_600_000).toISOString() });
    db.profili.set('estraneo', { id: 'estraneo', role: 'buyer' });
    expect((await chiama(BAR)).status).toBe(503);
    expect(db.profili.get('estraneo')).toEqual({ id: 'estraneo', role: 'buyer' });
    expect(db.link.has('estraneo')).toBe(false);
    db.utenti.clear(); db.profili.clear();

    // ③ «BAR PROVA» in un'altra via ha la stessa email di «Bar Prova», già iscritto e col link: non lo riscrive.
    db.etaMinuti = 10;
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    const r = await chiama({ ...BAR, nome: 'BAR PROVA', indirizzo: 'Via Emilia 120' });
    expect(r.status).toBe(503);
    expect(db.profili.get(a.id_attivita)).toMatchObject({ store_name: 'Bar Prova' });
    expect(String(db.profili.get(a.id_attivita)!.store_address)).toContain('Via Roma 1');
    db.utenti.clear(); db.profili.clear(); db.link.clear();

    // ③ Due invii insieme sull'attività rimasta a metà: chi trova il link già scritto da un altro non è «nuova»,
    //    quindi il flusso 16 parte una volta sola.
    db.rompiProfilo = 1;
    expect((await chiama(BAR)).status).toBe(503);
    db.linkDaAltri = true;
    const doppio = await chiama(BAR);
    expect(doppio.status).toBe(200);
    expect(((await doppio.json()) as { nuova: boolean }).nuova).toBe(false);
  });

  it('un profilo approvato senza link non torna «non approvato» col recupero', async () => {
    db.etaMinuti = 10;
    db.rompiProfilo = 1;
    expect((await chiama(BAR)).status).toBe(503);
    const id = [...db.utenti.keys()][0];
    db.profili.set(id, { id, role: 'seller', is_approved: true, approval_status: 'approved' });
    expect((await chiama(BAR)).status).toBe(409);
    expect(db.profili.get(id)!.is_approved).toBe(true);
  });

  it('un secondo invio senza tipo non cancella il tipo scritto prima (collaudo del 27/11, pulsante dell agente)', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    expect(db.profili.get(a.id_attivita)!.business_type).toBe('bar');
    const { tipo_attivita: _via, ...senzaTipo } = BAR;
    void _via;
    expect((await chiama(senzaTipo)).status).toBe(200);
    expect(db.profili.get(a.id_attivita)!.business_type).toBe('bar');
  });

  // 28/11/2026 03:13 — Nicola, dalla pagina dell'agente: «Non sono riuscito ad aggiungere l'attività». Il tipo
  // descritto passava fino a 80 caratteri e il database ne accetta 60: il negozio non nasceva mai.
  it('un tipo descritto più lungo di 60 caratteri non ferma l iscrizione: si accorcia fra due parole', async () => {
    const lungo = 'Bar, caffetteria e pasticceria artigianale con gelateria e cucina'; // 65 caratteri
    expect(lungo.length).toBeGreaterThan(60);
    const r = await chiama({ ...BAR, dettaglio: lungo });
    expect(r.status).toBe(201);
    const { id_attivita } = (await r.json()) as { id_attivita: string };
    const scritto = String(db.profili.get(id_attivita)!.business_type_detail);
    expect(scritto.length).toBeLessThanOrEqual(60);
    expect(lungo.startsWith(scritto)).toBe(true);
    expect(scritto).toBe('Bar, caffetteria e pasticceria artigianale con gelateria');
  });

  it('col sito pubblico lo scrive nei canali della vetrina; un indirizzo non https lo scarta', async () => {
    const a = (await (await chiama({ ...BAR, sito: 'https://www.barprova.it/' })).json()) as { id_attivita: string };
    expect(db.profili.get(a.id_attivita)!.store_customization).toEqual({ socials: { website: 'https://www.barprova.it/' } });
    const b = (await (await chiama({ ...BAR, nome: 'Bar Due', sito: 'http://127.0.0.1/' })).json()) as { id_attivita: string };
    expect(db.profili.get(b.id_attivita)!.store_customization).toBeUndefined();
  });

  // Collaudo del 27/11 (difetto vecchio, grave): il titolare accetta il preventivo dal link e la sua email prende
  // il posto di quella finta. Prima lo stesso invio trovava libera l'email finta, e nasceva un secondo negozio
  // nascosto col suo secondo link: 201, utenti 2, link 2.
  it('dopo che il titolare ha accettato il preventivo, lo stesso invio non crea un secondo negozio', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    // L'accettazione come in lib/agenzia/preventivo-col-codice.ts: il link non è più aperto, l'utente prende
    // l'email del titolare e si sblocca, il profilo va in revisione.
    db.link.set(a.id_attivita, { ...db.link.get(a.id_attivita)!, stato: 'accettato' });
    const { banned_until: _sblocco, ...utente } = db.utenti.get(a.id_attivita)!;
    void _sblocco;
    db.utenti.set(a.id_attivita, { ...utente, email: 'titolare@barprova.it' });
    db.profili.set(a.id_attivita, { ...db.profili.get(a.id_attivita), approval_status: 'pending' });
    const profiloPrima = { ...db.profili.get(a.id_attivita) };

    const r = await chiama(BAR);
    expect(r.status).toBe(409);
    expect(db.utenti.size).toBe(1);
    expect(db.link.size).toBe(1);
    expect(db.profili.size).toBe(1);
    expect(db.profili.get(a.id_attivita)).toEqual(profiloPrima);
    expect(db.utenti.get(a.id_attivita)!.email).toBe('titolare@barprova.it');
  });

  it('dopo l’accettazione anche il controllo degli omonimi del pulsante riconosce il negozio', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    const { attivitaGiaIscritta } = await import('@/lib/agenzia/nuova-attivita');
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    const { banned_until: _sblocco, ...utente } = db.utenti.get(a.id_attivita)!;
    void _sblocco;
    db.utenti.set(a.id_attivita, { ...utente, email: 'titolare@barprova.it' });
    db.link.set(a.id_attivita, { ...db.link.get(a.id_attivita)!, stato: 'accettato' });
    const admin = getAdminSupabase() as unknown as Parameters<typeof attivitaGiaIscritta>[0];
    expect((await attivitaGiaIscritta(admin, BAR))?.id).toBe(a.id_attivita);
    // Scritto in un altro modo («BAR PROVA»), con la stessa email di sistema: lo riconosce lo stesso.
    expect((await attivitaGiaIscritta(admin, { ...BAR, nome: 'BAR PROVA' }))?.id).toBe(a.id_attivita);
  });

  it('un preventivo chiuso da Nicola non si riapre col modulo e non fa nascere un altro negozio', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    db.link.set(a.id_attivita, { ...db.link.get(a.id_attivita)!, stato: 'chiuso' });
    expect((await chiama(BAR)).status).toBe(409);
    expect(db.utenti.size).toBe(1);
    expect(db.link.size).toBe(1);
    expect(db.link.get(a.id_attivita)!.stato).toBe('chiuso');
  });

  it('se gli utenti non si leggono, non nasce un negozio alla cieca', async () => {
    db.rompiLista = true;
    expect((await chiama(BAR)).status).toBe(503);
    expect(db.creaUtente).toHaveLength(0);
    expect(db.utenti.size).toBe(0);
  });

  it('se la ricerca degli utenti tocca il tetto senza arrivare in fondo, non nasce un negozio alla cieca', async () => {
    // 10 pagine da 1000 tutte piene (lib/agenzia/nuova-attivita.ts, PAGINE_UTENTI × PER_PAGINA): la ricerca non
    // ha guardato tutti, quindi «non c'è» non è sicuro.
    for (let i = 0; i < 10_000; i += 1) db.utenti.set(`altro-${i}`, { id: `altro-${i}`, email: `cliente${i}@esempio.it`, created_at: new Date().toISOString() });
    expect((await chiama(BAR)).status).toBe(503);
    expect(db.creaUtente).toHaveLength(0);
  });

  it('due primi invii insieme della stessa attività: un negozio solo, e «nuova» per uno solo', async () => {
    const esiti = await Promise.all([chiama(BAR), chiama(BAR)]);
    expect(esiti.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(db.utenti.size).toBe(1);
    expect(db.link.size).toBe(1);
  });

  it('non riscrive un’attività che ha già accettato', async () => {
    const a = (await (await chiama(BAR)).json()) as { id_attivita: string };
    db.profili.set(a.id_attivita, { ...db.profili.get(a.id_attivita), approval_status: 'approved', is_approved: true });
    const r = await chiama({ ...BAR, tipo_attivita: 'negozio' });
    expect(r.status).toBe(409);
    expect(db.profili.get(a.id_attivita)!.business_type).toBe('bar');
  });
});
