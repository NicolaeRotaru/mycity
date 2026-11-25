import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * L'ANALISI SUBITO, LA SCHEDA E LA PAGELLA DOPO L'ABBONAMENTO — 25/11/2026.
 *
 * Nicola: per ogni attività che si iscrive l'analisi parte subito e serve a cucire i servizi; la scheda
 * del cliente e la pagella sul marketplace arrivano solo dopo l'abbonamento. I dati della scheda restano
 * nel sito, chiusi, fino al primo pagamento (sua scelta, 25/11).
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { schedaEPagellaAperte, schedaPerIlSito, leggiSchedaEPagellaAperte } = await import('@/lib/agenzia/scheda-dopo-abbonamento');
const { avvisaN8nAbbonamentoAttivo, apriLaScheda } = await import('@/lib/agenzia/abbonamento-attivo-n8n');
const { offertaSuMisura } = await import('@/lib/agenzia/offerta-su-misura');

const SCHEDA = {
  tipo: 'scheda-cliente' as const,
  id_attivita: 'b8d328ab-1955-4820-9c64-c6626d449b4a',
  campi: {
    indirizzo: { valore: 'Via Roma 10, Piacenza', stato: 'confermato' as const, fonte: 'https://example.org' },
    menu_testo: { valore: 'Tortelli\nPisarei e fasò\nAnolini', stato: 'confermato' as const, fonte: null },
  },
  analisi: { punti_di_forza: ['Cucina piacentina fatta in casa'], idee_contenuti: ['La sfoglia tirata a mano il sabato'], cosa_chiedere_al_titolare: ['Fate anche asporto?'] },
  da_confermare: ['orari'],
};

afterEach(() => {
  delete process.env.N8N_PAGELLA_WEBHOOK_URL;
  delete process.env.N8N_NUOVO_CLIENTE_SEGRETO;
});

describe('quando scheda e pagella sono aperte', () => {
  it('in demo (mai pagato) sono chiuse; un abbonamento mai pagato non conta', () => {
    expect(schedaEPagellaAperte({ visibileSenzaAbbonamento: false, statiAbbonamenti: [] })).toBe(false);
    expect(schedaEPagellaAperte({ visibileSenzaAbbonamento: null, statiAbbonamenti: null })).toBe(false);
    expect(schedaEPagellaAperte({ visibileSenzaAbbonamento: false, statiAbbonamenti: ['incomplete', 'incomplete_expired', '', null] })).toBe(false);
  });
  it('dopo il primo pagamento sono aperte, anche se poi è disdetto o in ritardo', () => {
    for (const s of ['active', 'past_due', 'canceled', 'unpaid']) expect(schedaEPagellaAperte({ visibileSenzaAbbonamento: false, statiAbbonamenti: [s] }), s).toBe(true);
  });
  it('chi era già online prima della demo (Pane Quotidiano, negozi di sistema) le ha come oggi', () => {
    expect(schedaEPagellaAperte({ visibileSenzaAbbonamento: true, statiAbbonamenti: [] })).toBe(true);
  });
  it('se la lettura dal database non riesce restano chiuse', async () => {
    const giu = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'giù' } }), limit: async () => ({ data: null, error: { message: 'giù' } }) }) }) }) };
    expect(await leggiSchedaEPagellaAperte(giu as never, 'x')).toBe(false);
  });
});

describe('la scheda chiusa lascia l analisi', () => {
  it('in demo il sito vede solo l analisi: niente campi, niente «da confermare»', () => {
    const chiusa = schedaPerIlSito(SCHEDA, false)!;
    expect(chiusa.campi).toEqual({});
    expect(chiusa.da_confermare).toEqual([]);
    expect(chiusa.analisi).toEqual(SCHEDA.analisi);
    expect(schedaPerIlSito(SCHEDA, true)).toBe(SCHEDA);
    expect(schedaPerIlSito(null, true)).toBeNull();
  });

  it('il preventivo in demo ha la parte specifica dall analisi, senza i prodotti presi dal menu della scheda', () => {
    const dati = { storeLogo: null, storeMedia: null, prodotti: [], socials: null };
    const chiusa = offertaSuMisura({ nome: 'La Ragazzetta', tipo: 'ristorante', dati, scheda: schedaPerIlSito(SCHEDA, false), canali: null, sito: null, giudizioSito: null });
    const testo = JSON.stringify(chiusa);
    expect(testo).not.toMatch(/Pisarei|Anolini/);
    expect(testo).toMatch(/sfoglia tirata a mano|Cucina piacentina|asporto/);
    const aperta = JSON.stringify(offertaSuMisura({ nome: 'La Ragazzetta', tipo: 'ristorante', dati, scheda: SCHEDA, canali: null, sito: null, giudizioSito: null }));
    expect(aperta).toMatch(/Pisarei|Anolini|Tortelli/);
  });
});

describe('al primo abbonamento pagato', () => {
  it('l avviso a n8n è spento senza indirizzo, rifiuta un indirizzo non https e chi non ha il segreto', async () => {
    const f = vi.fn();
    expect(await avvisaN8nAbbonamentoAttivo('id-1', f as never)).toBe('spento');
    process.env.N8N_PAGELLA_WEBHOOK_URL = 'http://n8n.example/webhook/x';
    process.env.N8N_NUOVO_CLIENTE_SEGRETO = 's';
    expect(await avvisaN8nAbbonamentoAttivo('id-1', f as never)).toBe('fallito');
    process.env.N8N_PAGELLA_WEBHOOK_URL = 'https://n8n.example/webhook/x';
    delete process.env.N8N_NUOVO_CLIENTE_SEGRETO;
    expect(await avvisaN8nAbbonamentoAttivo('id-1', f as never)).toBe('fallito');
    expect(f).not.toHaveBeenCalled();
  });

  it('manda a n8n solo l id e da dove arriva; se n8n risponde male non lancia', async () => {
    process.env.N8N_PAGELLA_WEBHOOK_URL = 'https://n8n.example/webhook/mycity-analisi-attivita';
    process.env.N8N_NUOVO_CLIENTE_SEGRETO = 'segreto';
    const f = vi.fn(async () => new Response('', { status: 200 }));
    expect(await avvisaN8nAbbonamentoAttivo('id-1', f as never)).toBe('inviato');
    const corpo = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(Object.keys(corpo).sort()).toEqual(['id', 'inviato_il', 'origine', 'tipo']);
    expect(await avvisaN8nAbbonamentoAttivo('id-1', (async () => new Response('', { status: 500 })) as never)).toBe('fallito');
    expect(await avvisaN8nAbbonamentoAttivo('id-1', (async () => { throw new Error('rete'); }) as never)).toBe('fallito');
  });

  const finto = (indirizzoGia: string | null, scheda: unknown) => {
    const scritte: unknown[] = [];
    const admin = {
      from: (t: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => (t === 'schede_clienti' ? { data: scheda ? { scheda } : null, error: null } : { data: { store_address: indirizzoGia }, error: null }) }) }),
        update: (v: unknown) => ({ eq: async () => { scritte.push(v); return { error: null }; } }),
      }),
    };
    return { admin, scritte };
  };

  it('la scheda si apre: l indirizzo confermato entra nel profilo, mai il telefono', async () => {
    const { admin, scritte } = finto(null, { ...SCHEDA, campi: { ...SCHEDA.campi, telefono: { valore: '333 1234567', stato: 'confermato', fonte: null } } });
    expect(await apriLaScheda(admin as never, 'id-1')).toBe('scritta');
    expect(scritte).toEqual([{ store_address: 'Via Roma 10, Piacenza' }]);
  });

  it('un indirizzo già scritto dal titolare non si sovrascrive; senza scheda non si scrive niente', async () => {
    const a = finto('Piazza Cavalli 1', SCHEDA);
    expect(await apriLaScheda(a.admin as never, 'id-1')).toBe('niente');
    expect(a.scritte).toEqual([]);
    const b = finto(null, null);
    expect(await apriLaScheda(b.admin as never, 'id-1')).toBe('niente');
    expect(b.scritte).toEqual([]);
  });
});
