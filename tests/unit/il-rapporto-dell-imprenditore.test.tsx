// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ANALISI_PER_FASCIA,
  PARTI_RAPPORTO,
  analisiDaSalvare,
  analisiPerChiNonHaPagato,
  assaggio,
  leggiRapporto,
  partiDellaFascia,
  placeIdDi,
  type ParteRapporto,
} from '@/lib/agenzia/rapporto';
import { leggiAnalisiCanali } from '@/lib/agenzia/analisi';
import { ABBONAMENTI, FASCE } from '@/lib/agenzia/preventivo';
import { schedaPerIlSito } from '@/lib/agenzia/scheda-dopo-abbonamento';
import { indiziDelTitolare, inviaNuovaAttivitaAlFlusso } from '@/lib/agenzia/nuovo-cliente-n8n';
import type { SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import RapportoImprenditore from '@/components/seller/RapportoImprenditore';
import CosaCeNellAnalisi from '@/components/seller/CosaCeNellAnalisi';

/**
 * IL RAPPORTO DELL'IMPRENDITORE — le prove del piano dell'AD (26/11/2026), aggiornate col parere legale.
 *
 * Il numero di ogni prova è quello della sezione «Le prove» del piano (dato → atteso). La 4 («fonte a pagamento
 * spenta → nessuna chiamata») è dei flussi n8n: qui si prova solo che un blocco `spento` non si mostra.
 * Sul codice di prima sono rosse: il modulo del rapporto non c'era, la scheda Google si salvava coi suoi numeri,
 * il preventivo non diceva le parti escluse.
 */

// Il modo del progetto di disegnare un componente nelle prove (come il-preventivo-corto.test.tsx).
const aperti: Array<{ root: Root; radice: HTMLElement }> = [];
function render(el: ReactElement) {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  act(() => root.render(el));
  const voce = { root, radice };
  aperti.push(voce);
  return {
    container: radice,
    unmount: () => {
      act(() => root.unmount());
      radice.remove();
    },
  };
}
afterEach(() => {
  for (const { root, radice } of aperti.splice(0)) {
    if (radice.isConnected) {
      act(() => root.unmount());
      radice.remove();
    }
  }
});

const ADESSO = new Date('2026-11-26T14:00:00Z');
const LETTO = '2026-11-26T09:00:00Z';
const ID = 'aaaaaaaa-0000-0000-0000-000000000001';

const scheda = (analisi: Record<string, unknown>): SchedaCliente =>
  ({ tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi } as unknown as SchedaCliente);

const parte = (nome: ParteRapporto, contenuto: Record<string, unknown>) =>
  scheda({ rapporto: { parti: { [nome]: { fonte: 'web', letto_il: LETTO, ...contenuto } } } });

describe('prova 1 — La Ragazzetta, nessun sito', () => {
  const ragazzetta = scheda({
    fatti: { concorrenti_vicini: { valore: 7, fonte: 'openstreetmap', letto_il: LETTO } },
    google: { place_id: 'ChIJ_ragazzetta_123' },
  });

  it('i concorrenti vicini sono un numero vero, da OpenStreetMap, con fonte e data', () => {
    const c = assaggio({ scheda: ragazzetta }, ADESSO).find((n) => n.id === 'concorrenti')!;
    expect(c.valore).toBe('7 attività simili vicino a te');
    expect(c.fonte).toBe('Fonte: OpenStreetMap, letto il 26/11');
  });

  it('senza sito la velocità dice «non ancora letto», mai uno zero', () => {
    const v = assaggio({ scheda: ragazzetta }, ADESSO).find((n) => n.id === 'velocita_sito')!;
    expect(v.valore).toBeNull();
    const { container } = render(<RapportoImprenditore scheda={ragazzetta} canali={null} sito={null} haPagato={false} adesso={ADESSO} />);
    expect(container.querySelector('[data-numero="velocita_sito"]')?.textContent).toContain('non ancora letto');
    expect(container.querySelector('[data-numero="velocita_sito"]')?.textContent).not.toMatch(/\b0\b/);
  });

  it('di Google c’è solo il place_id', () => {
    expect(placeIdDi(ragazzetta)).toBe('ChIJ_ragazzetta_123');
  });

  it('uno zero arrivato da n8n non si mostra: è un dato non letto', () => {
    const zero = scheda({ fatti: { concorrenti_vicini: { valore: 0, fonte: 'openstreetmap', letto_il: LETTO } } });
    expect(assaggio({ scheda: zero }, ADESSO).find((n) => n.id === 'concorrenti')!.valore).toBeNull();
  });
});

describe('prova 2 — un locale con Instagram professionale', () => {
  it('i follower sono un numero letto, con fonte e data', () => {
    const s = scheda({ fatti: { follower_instagram: { valore: 1840, fonte: 'instagram', letto_il: LETTO } } });
    const f = assaggio({ scheda: s }, ADESSO).find((n) => n.id === 'follower')!;
    expect(f.valore).toBe('1840 su Instagram'.replace('1840', (1840).toLocaleString('it-IT')));
    expect(f.fonte).toBe('Fonte: Instagram, letto il 26/11');
  });

  it('un numero che dice di venire dalla fonte sbagliata non si mostra', () => {
    const s = scheda({ fatti: { follower_instagram: { valore: 1840, fonte: 'openstreetmap', letto_il: LETTO } } });
    expect(assaggio({ scheda: s }, ADESSO).find((n) => n.id === 'follower')!.valore).toBeNull();
  });
});

describe('prova 3 — dopo una lettura Google, nel database e nella scheda c’è solo il place_id', () => {
  const daGoogle = {
    google: { place_id: 'ChIJ_abc_1234567', voto: 4.6, recensioni: 128, orari: 'Lun-Sab 7-19', nome: 'Bar Roma', indirizzo: 'Via Roma 1' },
    fatti: {
      voto_google: { valore: 4.6, fonte: 'google', letto_il: LETTO },
      recensioni_google: { valore: 128, fonte: 'google', letto_il: LETTO },
      voto_tripadvisor: { valore: 4.2, fonte: 'tripadvisor', letto_il: LETTO },
      concorrenti_vicini: { valore: 5, fonte: 'openstreetmap', letto_il: LETTO },
    },
    rapporto: {
      parti: {
        reputazione: { fonte: 'google', letto_il: LETTO, temi: [{ tema: 'i dolci', tono: 'positivo', quante: 9 }] },
        concorrenti: { fonte: 'openstreetmap', letto_il: LETTO, voci: [{ titolo: 'Bar Roma', numero: 4.5, fonte: 'google' }, { titolo: 'Caffè Verdi' }] },
      },
    },
  };

  it('prima di salvare la busta google resta col solo place_id, e i fatti di Google e TripAdvisor si tolgono', () => {
    const salvata = analisiDaSalvare(daGoogle as Record<string, unknown>) as Record<string, unknown>;
    expect(salvata.google).toEqual({ place_id: 'ChIJ_abc_1234567' });
    expect(Object.keys(salvata.fatti as object)).toEqual(['concorrenti_vicini']);
    const parti = (salvata.rapporto as { parti: Record<string, { voci?: unknown[] }> }).parti;
    expect(parti.reputazione).toBeUndefined();
    expect(parti.concorrenti.voci).toEqual([{ titolo: 'Caffè Verdi' }]);
    expect(JSON.stringify(salvata)).not.toMatch(/4\.6|128|Lun-Sab|Via Roma/);
  });

  it('la porta di n8n salva la scheda già ripulita', async () => {
    const r = await manda({ tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi: daGoogle });
    expect(r.status).toBe(200);
    const analisi = (db.salvate[0].scheda as { analisi: Record<string, unknown> }).analisi;
    expect(analisi.google).toEqual({ place_id: 'ChIJ_abc_1234567' });
    expect(JSON.stringify(analisi)).not.toMatch(/"voto|recensioni_google|tripadvisor/);
  });

  it('anche se una riga vecchia li avesse, la lettura non mostra fatti né parti da Google', () => {
    const s = scheda(daGoogle);
    const r = leggiRapporto(s, ADESSO)!;
    expect(r.reputazione).toBeNull();
    expect(r.concorrenti?.voci.map((v) => v.titolo)).toEqual(['Caffè Verdi']);
    expect(assaggio({ scheda: s }, ADESSO).map((n) => n.valore).join(' ')).not.toMatch(/4,6|128/);
  });

  it('della scheda Google letta da n8n si tolgono voto, recensioni e le frasi con una cifra', () => {
    const c = leggiAnalisiCanali({
      tipo: 'analisi-canali', id_attivita: ID, fatta_il: LETTO,
      canali: { google: { stato: 'fatta', fonte: 'https://maps.google.com/?cid=1', numeri: { valutazione: 4.6, recensioni: 128 }, osservazioni: ['Ha 4,6 stelle su 128 recensioni', 'Mancano le foto del locale'] } },
    })!;
    expect(c.canali.google?.numeri).toBeUndefined();
    expect(c.canali.google?.osservazioni).toEqual(['Mancano le foto del locale']);
  });
});

describe('prova 4 (parte del sito) — un blocco spento non si mostra', () => {
  it('una parte `spento` è «non ancora letta», e un fatto spento non entra nell’assaggio', () => {
    const s = scheda({
      rapporto: { parti: { ricerche: { fonte: 'dataforseo', letto_il: LETTO, spento: true, frasi: ['Le ricerche crescono a dicembre'] } } },
      fatti: { ricerche_al_mese: { valore: 300, fonte: 'dataforseo', letto_il: LETTO, spento: true } },
    });
    expect(leggiRapporto(s, ADESSO)).toBeNull();
    expect(assaggio({ scheda: s }, ADESSO).find((n) => n.id === 'ricerche')!.valore).toBeNull();
  });
});

describe('prova 5 — una recensione con «Mario Rossi»', () => {
  it('nella reputazione nessun nome di persona: niente frasi, niente voci, e un tema col nome si scarta', () => {
    const s = parte('reputazione', {
      fonte: 'dataforseo',
      frasi: ['Mario Rossi scrive che il caffè è ottimo'],
      voci: [{ titolo: 'Mario Rossi', dettaglio: 'cliente abituale' }],
      temi: [{ tema: 'Mario Rossi gentile', tono: 'positivo', quante: 5 }, { tema: 'il caffè', tono: 'positivo', quante: 5 }],
    });
    const r = leggiRapporto(s, ADESSO)!;
    expect(JSON.stringify(r)).not.toContain('Mario');
    expect(r.reputazione?.temi.map((t) => t.tema)).toEqual(['il caffè']);
    const { container } = render(<RapportoImprenditore scheda={s} canali={null} sito={null} haPagato adesso={ADESSO} />);
    expect(container.textContent).not.toContain('Mario');
  });

  it('nelle frasi di ogni parte niente prezzi, telefoni, link o menzioni', () => {
    const s = parte('zona', { frasi: ['Il caffè costa 1,20 € in zona', 'Chiama il 333 123 4567 per info', 'Leggi su www.esempio.it', 'Lo dice @mario.rossi', 'La zona è piena di uffici a pranzo'] });
    expect(leggiRapporto(s, ADESSO)!.zona?.frasi).toEqual(['La zona è piena di uffici a pranzo']);
  });
});

describe('prova 6 — il preventivo Base', () => {
  it('l’elenco dell’analisi non promette il confronto mese su mese e mostra la parte 12 come esclusa', () => {
    const { incluse, escluse } = partiDellaFascia('base');
    const promesse = [...incluse.map((r) => `${r.titolo} ${r.come ?? ''}`), ...ANALISI_PER_FASCIA.base.inPiu, ANALISI_PER_FASCIA.base.ritmo].join(' ');
    expect(promesse).not.toMatch(/mese su mese|ogni mese|ogni settimana|confronto/i);
    expect(escluse.map((r) => r.parte)).toContain('concorrenti_web');
    const { container } = render(<CosaCeNellAnalisi fascia="base" />);
    expect(container.querySelector('[data-esclusa="concorrenti_web"]')?.textContent).toContain('Non compreso: i concorrenti sui social e sul web');
    expect(container.querySelector('[data-inclusa="concorrenti_web"]')).toBeNull();
  });

  it('il testo del Base nel listino non nomina parti che il Base non ha, né il ritmo delle altre fasce', () => {
    expect(FASCE.base.servizi.analisi).not.toMatch(/ricerche|sui social e sul web|ogni mese|ogni settimana/i);
    expect(FASCE.business.servizi.analisi).not.toMatch(/ogni settimana/i);
    expect(FASCE.business.servizi.analisi).toContain('concorrenti');
    expect(FASCE.premium.servizi.analisi).toContain('concorrenti');
  });

  it('prezzi invariati: 300, 500, 999 € al mese', () => {
    expect(ABBONAMENTI.map((f) => FASCE[f].prezzoMese)).toEqual([30_000, 50_000, 99_900]);
  });
});

describe('prova 7 — i temi delle recensioni', () => {
  it('un tema citato da 2 recensioni non si mostra; da 3 sì, col numero', () => {
    const s = parte('reputazione', { fonte: 'dataforseo', temi: [{ tema: 'il parcheggio', tono: 'negativo', quante: 2 }, { tema: 'le brioche', tono: 'positivo', quante: 3 }] });
    const r = leggiRapporto(s, ADESSO)!;
    expect(r.reputazione?.temi).toEqual([{ tema: 'le brioche', tono: 'positivo', quante: 3 }]);
    const { container } = render(<RapportoImprenditore scheda={s} canali={null} sito={null} haPagato adesso={ADESSO} />);
    expect(container.textContent).toContain('le brioche: piace (3 recensioni)');
    expect(container.textContent).not.toContain('parcheggio');
  });

  it('un tema senza il numero non si mostra', () => {
    const s = parte('reputazione', { fonte: 'dataforseo', temi: [{ tema: 'le brioche', tono: 'positivo' }] });
    expect(leggiRapporto(s, ADESSO)).toBeNull();
  });
});

describe('prova 8 — il preventivo di ogni fascia elenca incluse ed escluse, dalla stessa tabella', () => {
  it('ogni parte è o inclusa o esclusa, e il componente dice esattamente quelle della tabella', () => {
    for (const f of ABBONAMENTI) {
      const { incluse, escluse } = partiDellaFascia(f);
      expect([...incluse, ...escluse].map((r) => r.parte).sort()).toEqual([...PARTI_RAPPORTO].sort());
      const { container, unmount } = render(<CosaCeNellAnalisi fascia={f} />);
      const viste = Array.from(container.querySelectorAll('[data-inclusa]')).map((e) => e.getAttribute('data-inclusa'));
      const tolte = Array.from(container.querySelectorAll('[data-esclusa]')).map((e) => e.getAttribute('data-esclusa'));
      expect(viste).toEqual(PARTI_RAPPORTO.filter((p) => ANALISI_PER_FASCIA[f].parti[p] !== null));
      expect(tolte).toEqual(PARTI_RAPPORTO.filter((p) => ANALISI_PER_FASCIA[f].parti[p] === null));
      unmount();
    }
  });

  it('dopo il pagamento il rapporto mostra le parti della fascia e dice quelle non comprese', () => {
    const s = parte('concorrenti_web', { frasi: ['I concorrenti pubblicano video ogni giorno'] });
    const { container } = render(<RapportoImprenditore scheda={s} canali={null} sito={null} haPagato fascia="base" adesso={ADESSO} />);
    expect(container.querySelector('[data-parte="concorrenti_web"]')?.textContent).toContain('Non compresa nel Base');
    expect(container.textContent).not.toContain('I concorrenti pubblicano video');
  });
});

describe('l’assaggio prima di pagare, il rapporto intero dopo', () => {
  const intera = scheda({
    fatti: { concorrenti_vicini: { valore: 4, fonte: 'openstreetmap', letto_il: LETTO }, follower_facebook: { valore: 50, fonte: 'facebook', letto_il: LETTO } },
    google: { place_id: 'ChIJ_xyz_1234567', voto: 4.1 },
    rapporto: { parti: { zona: { fonte: 'web', letto_il: LETTO, frasi: ['La zona è piena di uffici a pranzo'] } } },
  });

  it('chi non ha pagato non riceve il rapporto dal server: solo i fatti dell’assaggio e il place_id', () => {
    const vista = schedaPerIlSito(intera, false)!;
    const a = vista.analisi as Record<string, unknown>;
    expect(a.rapporto).toBeUndefined();
    expect(Object.keys(a.fatti as object)).toEqual(['concorrenti_vicini']);
    expect(a.google).toEqual({ place_id: 'ChIJ_xyz_1234567' });
    expect(analisiPerChiNonHaPagato(undefined)).toBeUndefined();
  });

  it('chi non ha pagato vede l’assaggio e l’elenco per fascia, non le parti', () => {
    const { container } = render(<RapportoImprenditore scheda={intera} canali={null} sito={null} haPagato={false} adesso={ADESSO} />);
    expect(container.querySelector('[data-testid="assaggio"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cosa-ce-nell-analisi"]')).not.toBeNull();
    expect(container.querySelector('[data-parte]')).toBeNull();
    expect(container.textContent).not.toContain('uffici a pranzo');
  });

  it('chi ha pagato vede le parti, e quelle non lette lo dicono', () => {
    const { container } = render(<RapportoImprenditore scheda={intera} canali={null} sito={null} haPagato adesso={ADESSO} />);
    expect(container.querySelector('[data-parte="zona"]')?.textContent).toContain('uffici a pranzo');
    expect(container.querySelector('[data-parte="zona"]')?.textContent).toContain('Fonte: fonti pubbliche, letto il 26/11');
    expect(container.querySelector('[data-parte="bandi"]')?.textContent).toContain('Non ancora letta');
  });
});

describe('/sell: i due indizi facoltativi arrivano a n8n', () => {
  it('Instagram e la scheda Google Maps si ripuliscono, e uno storto si lascia fuori', () => {
    expect(indiziDelTitolare('https://www.instagram.com/bar.roma/', '')).toEqual({ instagram: 'bar.roma' });
    expect(indiziDelTitolare('', 'javascript:alert(1)')).toBeNull();
    expect(indiziDelTitolare(null, undefined)).toBeNull();
  });

  it('partono a n8n come indizi_del_titolare, e senza indizi la busta non cambia', async () => {
    process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL = 'https://n8n.example/webhook/16';
    process.env.N8N_NUOVO_CLIENTE_SEGRETO = 's';
    const corpi: Array<Record<string, unknown>> = [];
    const finta = (async (_u: unknown, init: { body: string }) => { corpi.push(JSON.parse(init.body)); return new Response('{}'); }) as unknown as typeof fetch;
    const base = { idAttivita: ID, nome: 'Bar Roma', tipo: 'bar', tipoDescritto: null, indirizzo: null, citta: null, descrizione: null };
    await inviaNuovaAttivitaAlFlusso({ ...base, indizi: { instagram: 'bar.roma' } }, finta);
    await inviaNuovaAttivitaAlFlusso(base, finta);
    expect(corpi[0].indizi_del_titolare).toEqual({ instagram: 'bar.roma' });
    expect('indizi_del_titolare' in corpi[1]).toBe(false);
    delete process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL;
    delete process.env.N8N_NUOVO_CLIENTE_SEGRETO;
  });
});

// ─── La porta per n8n, per la prova 3 ────────────────────────────────────────────────────
const db = vi.hoisted(() => ({ salvate: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 60 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ID, role: 'seller' }, error: null }) }) }) };
      if (tabella === 'schede_clienti') return { upsert: async (riga: Record<string, unknown>) => { db.salvate.push(riga); return { error: null }; } };
      throw new Error(`tabella inattesa ${tabella}`);
    },
  }),
}));

async function manda(corpo: unknown) {
  const { POST } = await import('@/app/api/agenzia/scheda-cliente/route');
  return POST(new Request('https://mycity.example/api/agenzia/scheda-cliente', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', 'x-mycity-segreto': 'segreto-di-prova' },
    body: JSON.stringify(corpo),
  }));
}

beforeEach(() => {
  process.env.N8N_SCHEDA_CLIENTE_SEGRETO = 'segreto-di-prova';
  db.salvate = [];
});
