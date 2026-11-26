// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ANALISI_PER_FASCIA,
  PARTI_RAPPORTO,
  analisiDaSalvare,
  analisiPerChiNonHaPagato,
  analisiPerLaFascia,
  campiDaSalvare,
  fraseMostrabile,
  temaMostrabile,
  assaggio,
  leggiBlocco,
  leggiRapporto,
  partiDellaFascia,
  placeIdDi,
  type PezzoParte,
} from '@/lib/agenzia/rapporto';
import { analisiAziendale, leggiAnalisiCanali } from '@/lib/agenzia/analisi';
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
const DFS = 'https://dataforseo.com/';

const scheda = (analisi: Record<string, unknown>): SchedaCliente =>
  ({ tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi } as unknown as SchedaCliente);

/** Un blocco dei fatti come lo manda n8n (contratto v1.2, sez. 1). */
const blocco = (dati: Record<string, unknown> | null, altro: Record<string, unknown> = {}) => ({
  stato: 'letto', motivo: null, fonte: 'https://www.openstreetmap.org/', fonte_nome: 'OpenStreetMap', licenza: 'ODbL', letto_il: LETTO, conserva_fino_al: null, dati, parte: 3, ...altro,
});
const vicini = (numero: number | null, elenco: unknown[] = []) => blocco({ raggio_m: 400, concorrenti: { numero, tipo_osm: 'amenity=bar', elenco }, servizi: { fermate_bus: 3, parcheggi: 1, scuole: 0 } });
const instagram = (follower: number) => blocco({ profilo: 'bar.roma', follower, post_ultimi_30_giorni: 6 }, { fonte: 'https://developers.facebook.com/docs/instagram-api', fonte_nome: 'Instagram', licenza: null });

describe('prova 1 — La Ragazzetta, nessun sito', () => {
  const ragazzetta = scheda({
    fatti: { versione: 1, vicini: vicini(7), google: blocco({ place_id: 'ChIJ_ragazzetta_123' }, { fonte_nome: 'Google Places' }) },
  });

  it('i concorrenti vicini sono un numero vero, da OpenStreetMap, con fonte, data e licenza', () => {
    const c = assaggio({ scheda: ragazzetta }, ADESSO).find((n) => n.id === 'concorrenti')!;
    expect(c.valore).toBe('7 attività simili entro 400 m');
    expect(c.fonte).toBe('Fonte: OpenStreetMap, letto il 26/11, licenza ODbL');
  });

  it('senza sito la velocità dice «non ancora letto», mai uno zero', () => {
    const v = assaggio({ scheda: ragazzetta }, ADESSO).find((n) => n.id === 'velocita_sito')!;
    expect(v.valore).toBeNull();
    const { container } = render(<RapportoImprenditore scheda={ragazzetta} canali={null} sito={null} haPagato={false} adesso={ADESSO} />);
    expect(container.querySelector('[data-numero="velocita_sito"]')?.textContent).toContain('non ancora letto');
    expect(container.querySelector('[data-numero="velocita_sito"]')?.textContent).not.toMatch(/\b0\b/);
  });

  it('di Google c’è solo il place_id; con google spento non c’è', () => {
    expect(placeIdDi(ragazzetta)).toBe('ChIJ_ragazzetta_123');
    expect(placeIdDi(scheda({ fatti: { google: blocco(null, { stato: 'spento', motivo: 'voce Config a no' }) } }))).toBeNull();
  });

  it('un numero che manca (null col motivo) non diventa zero; uno zero contato si dice in parole', () => {
    const manca = scheda({ fatti: { vicini: vicini(null) } });
    expect(assaggio({ scheda: manca }, ADESSO).find((n) => n.id === 'concorrenti')!.valore).toBeNull();
    const zero = scheda({ fatti: { vicini: { ...vicini(0), stato: 'vuoto' } } });
    expect(assaggio({ scheda: zero }, ADESSO).find((n) => n.id === 'concorrenti')!.valore).toBe('nessuna attività simile entro 400 m');
  });
});

describe('prova 2 — un locale con Instagram professionale', () => {
  it('i follower sono un numero letto, con fonte e data', () => {
    const f = assaggio({ scheda: scheda({ fatti: { instagram: instagram(1840) } }) }, ADESSO).find((n) => n.id === 'follower')!;
    expect(f.valore).toBe(`${(1840).toLocaleString('it-IT')} su Instagram`);
    expect(f.fonte).toBe('Fonte: Instagram, letto il 26/11');
  });

  it('con Instagram spento l’assaggio dice «in arrivo», non «non trovato»', () => {
    const s = scheda({ fatti: { instagram: blocco(null, { stato: 'spento', motivo: 'serve account professionale' }) } });
    const f = assaggio({ scheda: s }, ADESSO).find((n) => n.id === 'follower')!;
    expect(f.valore).toBeNull();
    expect(f.inArrivo).toBe(true);
    const { container } = render(<RapportoImprenditore scheda={s} canali={null} sito={null} haPagato={false} adesso={ADESSO} />);
    expect(container.querySelector('[data-numero="follower"]')?.textContent).toContain('in arrivo');
  });
});

describe('prova 3 — dopo una lettura Google, nel database e nella scheda c’è solo il place_id', () => {
  const daGoogle = {
    google: { place_id: 'ChIJ_vecchia_bozza', voto: 4.6 },
    fatti: {
      versione: 1,
      google: blocco({ place_id: 'ChIJ_abc_1234567', voto: 4.6, recensioni: 128, orari: 'Lun-Sab 7-19', nome: 'Bar Roma', indirizzo: 'Via Roma 1' }, { fonte_nome: 'Google Places' }),
      tripadvisor: blocco({ location_id: '123', voto: 4.2, posizione: 3 }, { fonte_nome: 'TripAdvisor' }),
      recensioni: blocco({ lette: 40, voto_medio: 4.6, per_stelle: { 5: 30 }, con_risposta: 2, testi: ['Mario Rossi: ottimo'] }, { fonte: DFS, fonte_nome: 'DataForSEO' }),
      vicini: vicini(5),
    },
    business: {
      reputazione_temi: [{ tema: 'i dolci', tono: 'positivo', quante: 9, fonte: DFS, testo: 'citazione' }, { tema: 'il parcheggio', tono: 'negativo', quante: 2, fonte: DFS }],
      confronto_concorrenti: [{ nome: 'Caffè Verdi', distanza_m: 120, voto: 4.5, recensioni: 300, differenza: 'Apre prima la mattina', fonte: 'https://www.openstreetmap.org/node/1' }],
    },
  };

  it('prima di salvare: google col solo place_id, TripAdvisor col solo location_id, recensioni senza voti né testi', () => {
    const salvata = analisiDaSalvare(daGoogle as Record<string, unknown>) as Record<string, unknown>;
    const f = salvata.fatti as Record<string, { dati: unknown }>;
    expect(f.google.dati).toEqual({ place_id: 'ChIJ_abc_1234567' });
    expect(f.tripadvisor.dati).toEqual({ location_id: '123' });
    expect(f.recensioni.dati).toEqual({ lette: 40, con_risposta: 2 });
    expect(salvata.google).toBeUndefined();
    const b = salvata.business as Record<string, Array<Record<string, unknown>>>;
    expect(b.reputazione_temi).toEqual([{ tema: 'i dolci', tono: 'positivo', quante: 9, fonte: DFS }]);
    expect(b.confronto_concorrenti[0]).not.toHaveProperty('voto');
    expect(JSON.stringify(salvata)).not.toMatch(/4\.6|4\.5|128|Lun-Sab|Via Roma|Mario/);
  });

  it('la porta di n8n salva la scheda già ripulita', async () => {
    const r = await manda({ tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi: daGoogle });
    expect(r.status).toBe(200);
    const analisi = (db.salvate[0].scheda as { analisi: Record<string, unknown> }).analisi;
    expect((analisi.fatti as Record<string, { dati: unknown }>).google.dati).toEqual({ place_id: 'ChIJ_abc_1234567' });
    expect(JSON.stringify(analisi)).not.toMatch(/voto|Lun-Sab|testi/);
  });

  it('anche se una riga vecchia li avesse, la lettura non mostra niente di Google, TripAdvisor o delle recensioni', () => {
    const s = scheda(daGoogle);
    const testo = JSON.stringify(leggiRapporto(s, ADESSO)) + JSON.stringify(assaggio({ scheda: s }, ADESSO));
    expect(testo).not.toMatch(/4,6|4\.6|128|Lun-Sab|TripAdvisor|Google Places|Mario/);
    // Un nome di fonte che dice Google accanto a un blocco ammesso si scarta lo stesso.
    expect(leggiBlocco({ vicini: { ...vicini(3), fonte_nome: 'Google Maps' } }, 'vicini', ADESSO)).toBeNull();
  });

  it('della scheda Google letta da n8n per la pagina «Analisi» si tolgono voto, recensioni e le frasi con una cifra', () => {
    const c = leggiAnalisiCanali({
      tipo: 'analisi-canali', id_attivita: ID, fatta_il: LETTO,
      canali: { google: { stato: 'fatta', fonte: 'https://maps.google.com/?cid=1', numeri: { valutazione: 4.6, recensioni: 128 }, osservazioni: ['Ha 4,6 stelle su 128 recensioni', 'Mancano le foto del locale'] } },
    })!;
    expect(c.canali.google?.numeri).toBeUndefined();
    expect(c.canali.google?.osservazioni).toEqual(['Mancano le foto del locale']);
  });
});

describe('prova 4 (parte del sito) — fonte spenta e dati scaduti', () => {
  it('una fonte spenta è «in arrivo», mai «0» né «non trovato»', () => {
    const s = scheda({ fatti: { ricerche: blocco(null, { stato: 'spento', motivo: 'credenziale finta', fonte: DFS, fonte_nome: 'DataForSEO' }) } });
    expect(leggiRapporto(s, ADESSO)!.ricerche).toBe('in_arrivo');
    expect(assaggio({ scheda: s }, ADESSO).find((n) => n.id === 'ricerche')!.inArrivo).toBe(true);
  });

  it('passata conserva_fino_al (DataForSEO) i dati non si mostrano più: «da rileggere», senza cancellare niente', () => {
    const scaduta = blocco({ zona: 'Piacenza', parole: [{ parola: 'bar piacenza', ricerche_al_mese: 900, posizione: 4 }] }, { fonte: DFS, fonte_nome: 'DataForSEO', conserva_fino_al: '2026-11-20T00:00:00Z' });
    const s = scheda({ fatti: { ricerche: scaduta } });
    expect(leggiRapporto(s, ADESSO)!.ricerche).toBe('da_rileggere');
    expect(assaggio({ scheda: s }, ADESSO).find((n) => n.id === 'ricerche')!.valore).toBeNull();
    expect(analisiDaSalvare({ fatti: { ricerche: scaduta } }).fatti).toEqual({ ricerche: scaduta });
  });
});

describe('prova 5 — una recensione con «Mario Rossi»', () => {
  it('nella reputazione nessun nome di persona: un tema col nome si scarta, i testi non si leggono', () => {
    const s = scheda({ business_fatta_il: LETTO, business: { reputazione_temi: [
      { tema: 'Mario Rossi gentile', tono: 'positivo', quante: 5, fonte: DFS },
      { tema: 'il caffè', tono: 'positivo', quante: 5, fonte: DFS, testo: 'Mario Rossi dice che il caffè è ottimo' },
    ] } });
    const r = leggiRapporto(s, ADESSO)!;
    expect(JSON.stringify(r)).not.toContain('Mario');
    expect((r.reputazione as PezzoParte[])[0].temi.map((t) => t.tema)).toEqual(['il caffè']);
    const { container } = render(<RapportoImprenditore scheda={s} canali={null} sito={null} haPagato adesso={ADESSO} />);
    expect(container.textContent).not.toContain('Mario');
  });

  it('nelle voci niente prezzi, telefoni, link, menzioni o numeri di Google', () => {
    const occasioni = (cose: Array<Record<string, unknown>>) => scheda({ business_fatta_il: LETTO, business: { occasioni: [{ cosa: 'Mercato in piazza Cavalli', fonte: DFS }, ...cose] } });
    const cattive = [
      { cosa: 'Il caffè costa 1,20 € in zona', fonte: DFS }, { cosa: 'Chiama il 333 123 4567', fonte: DFS },
      { cosa: 'Leggi su www.esempio.it', fonte: DFS }, { cosa: 'Scrivi a (@mario.rossi) per info', fonte: DFS },
      { cosa: 'Il Caffè Verdi ha 4,5 su Google', fonte: DFS }, { cosa: 'Su TripAdvisor sei a 4,5 su 5', fonte: DFS },
      { cosa: 'Voto medio quattro e mezzo su cinque', fonte: DFS }, { cosa: 'Un menù da 25 a persona', fonte: DFS },
      { cosa: 'Senza fonte non esce' },
    ];
    // Una alla volta, accanto a una buona (la sezione ne tiene al massimo 5).
    for (const c of cattive) {
      const voci = (leggiRapporto(occasioni([c]), ADESSO)!.calendario as PezzoParte[]).flatMap((p) => p.voci.map((v) => v.titolo));
      expect(voci, String(c.cosa)).toEqual(['Mercato in piazza Cavalli']);
    }
  });
});

describe('prova 6 — il preventivo Base', () => {
  it('l’elenco dell’analisi non promette il confronto mese su mese e mostra la parte 12 come esclusa', () => {
    const { incluse, escluse } = partiDellaFascia('base');
    const promesse = [...incluse.map((r) => `${r.titolo} ${r.come ?? ''}`), ...ANALISI_PER_FASCIA.base.inPiu, ANALISI_PER_FASCIA.base.ritmo].join(' ');
    expect(promesse).not.toMatch(/mese su mese|ogni mese|ogni settimana|confronto/i);
    expect(escluse.map((r) => r.parte)).toEqual(expect.arrayContaining(['ricerche', 'concorrenti_web']));
    const { container } = render(<CosaCeNellAnalisi fascia="base" />);
    expect(container.querySelector('[data-esclusa="concorrenti_web"]')?.textContent).toContain('Non compreso nel rapporto: i concorrenti sui social e sul web');
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
    const s = scheda({ business_fatta_il: LETTO, business: { reputazione_temi: [{ tema: 'il parcheggio', tono: 'negativo', quante: 2, fonte: DFS }, { tema: 'le brioche', tono: 'positivo', quante: 3, fonte: DFS }] } });
    expect((leggiRapporto(s, ADESSO)!.reputazione as PezzoParte[])[0].temi).toEqual([{ tema: 'le brioche', tono: 'positivo', quante: 3 }]);
    const { container } = render(<RapportoImprenditore scheda={s} canali={null} sito={null} haPagato adesso={ADESSO} />);
    expect(container.textContent).toContain('le brioche: piace (3 recensioni)');
    expect(container.textContent).not.toContain('parcheggio');
  });

  it('un tema senza il numero non si mostra', () => {
    expect(leggiRapporto(scheda({ business: { reputazione_temi: [{ tema: 'le brioche', tono: 'positivo', fonte: DFS }] } }), ADESSO)).toBeNull();
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
    const s = scheda({ business_fatta_il: LETTO, business: { idee_dal_confronto: [{ idea: 'I concorrenti pubblicano video ogni giorno', perche: 'piacciono', fonte: DFS }] } });
    const { container } = render(<RapportoImprenditore scheda={s} canali={null} sito={null} haPagato fascia="base" adesso={ADESSO} />);
    expect(container.querySelector('[data-parte="concorrenti_web"]')?.textContent).toContain('Non compresa nel Base');
    expect(container.textContent).not.toContain('I concorrenti pubblicano video');
  });
});

describe('l’assaggio prima di pagare, il rapporto intero dopo', () => {
  const intera = scheda({
    fatti: {
      vicini: vicini(4, [{ nome: 'Caffè Verdi', distanza_m: 120, fonte: 'https://www.openstreetmap.org/node/1' }]),
      instagram: instagram(50),
      google: blocco({ place_id: 'ChIJ_xyz_1234567' }, { fonte_nome: 'Google Places' }),
      bandi: blocco({ elenco: [{ titolo: 'Contributo per le vetrine del centro', fonte: 'https://www.comune.piacenza.it/' }] }, { fonte_nome: 'Comune di Piacenza', licenza: null }),
    },
    business_fatta_il: LETTO,
    business: { situazione: [{ testo: 'Bar in centro da dieci anni', fonte: 'https://example.org' }], piano_30_giorni: [{ settimana: 1, azione: 'Fotografare le brioche del mattino', servizio: 'foto_video', fonte: DFS }] },
  });

  it('chi non ha pagato non riceve il rapporto dal server: solo i numeri dell’assaggio e il place_id', () => {
    const a = schedaPerIlSito(intera, false)!.analisi as Record<string, unknown>;
    const f = a.fatti as Record<string, { dati: Record<string, unknown> }>;
    expect(Object.keys(f).sort()).toEqual(['google', 'instagram', 'vicini']);
    expect(JSON.stringify(f.vicini)).not.toContain('Caffè Verdi');
    expect((a.business as Record<string, unknown>).piano_30_giorni).toBeUndefined();
    expect((a.business as Record<string, unknown>).situazione).toBeDefined();
    expect(analisiPerChiNonHaPagato(undefined)).toBeUndefined();
  });

  it('chi non ha pagato vede l’assaggio e l’elenco per fascia, non le parti', () => {
    const { container } = render(<RapportoImprenditore scheda={intera} canali={null} sito={null} haPagato={false} adesso={ADESSO} />);
    expect(container.querySelector('[data-testid="assaggio"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cosa-ce-nell-analisi"]')).not.toBeNull();
    expect(container.querySelector('[data-parte]')).toBeNull();
    expect(container.textContent).not.toContain('Fotografare le brioche');
  });

  it('chi ha pagato vede le parti, con fonte e data, e quelle non lette lo dicono', () => {
    const { container } = render(<RapportoImprenditore scheda={intera} canali={null} sito={null} haPagato fascia="premium" adesso={ADESSO} />);
    expect(container.querySelector('[data-parte="concorrenti"]')?.textContent).toContain('Caffè Verdi — a 120 m');
    expect(container.querySelector('[data-parte="concorrenti"]')?.textContent).toContain('Fonte: OpenStreetMap, letto il 26/11, licenza ODbL');
    expect(container.querySelector('[data-parte="bandi"]')?.textContent).toContain('Contributo per le vetrine del centro');
    expect(container.querySelector('[data-parte="piano_30_giorni"]')?.textContent).toContain('Settimana 1 — Fotografare le brioche del mattino');
    expect(container.querySelector('[data-parte="zona"]')?.textContent).toContain('Fermate dell’autobus: 3');
    expect(container.querySelector('[data-parte="ricerche"]')?.textContent).toContain('Non ancora letta');
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

describe('dal collaudo del 26/11', () => {
  it('chiavi Google o TripAdvisor fuori dalla busta google si tolgono a ogni profondità, e i testi delle recensioni nei fatti', () => {
    const salvata = analisiDaSalvare({
      voto_google: 4.6, orari_google: 'Lun-Dom', tripadvisor: { voto: 4.5 },
      business: { situazione: [{ testo: 'Bar in centro da dieci anni', fonte: 'https://example.org' }] },
      fatti: { vicini: blocco({ raggio_m: 400, concorrenti: { numero: 3, elenco: [{ nome: 'Bar X', voto_google: 4.6 }] } }), recensioni: blocco({ lette: 3, testi: ['Mario Rossi: buono'] }) },
    }) as Record<string, unknown>;
    expect(JSON.stringify(salvata)).not.toMatch(/voto_google|orari_google|tripadvisor|Mario/);
    // Le frasi delle sezioni di prima (`testo`) restano.
    expect(JSON.stringify(salvata)).toContain('Bar in centro da dieci anni');
  });

  it('un place_id che non ha la forma di un place_id (nome e indirizzo) non si salva', () => {
    const salvata = analisiDaSalvare({ fatti: { google: blocco({ place_id: 'Bar Centrale, Via Roma 1, Piacenza' }) } }) as { fatti: { google: { dati: unknown } } };
    expect(salvata.fatti.google.dati).toBeNull();
  });

  it('un campo letto da una pagina di Google Maps o TripAdvisor non si salva', () => {
    const campi = campiDaSalvare({
      orari: { valore: 'Lun-Dom 7-20', stato: 'da_confermare', fonte: 'https://www.google.com/maps/place/Bar+X' },
      voto_google: { valore: '4,6', stato: 'da_confermare', fonte: 'https://example.org' },
      indirizzo: { valore: 'Via Roma 1', stato: 'confermato', fonte: 'https://www.bar-x.it/contatti' },
    });
    expect(Object.keys(campi)).toEqual(['indirizzo']);
  });

  it('l’analisi del business di prima non mostra più voti di Google né frasi prese da Google Maps', () => {
    const s = scheda({ business: {
      situazione: [{ testo: 'Su Google ha 4,6 stelle da 230 recensioni', fonte: 'https://example.org' }, { testo: 'Bar in centro da dieci anni', fonte: 'https://www.google.com/maps/place/x' }, { testo: 'Bar in centro con dehors', fonte: 'https://example.org' }],
    } });
    expect(analisiAziendale(s)?.situazione.map((f) => f.testo)).toEqual(['Bar in centro con dehors']);
  });

  it('nei canali, nessuna frase che ricopia voti o recensioni di Google, nemmeno su Instagram o in lettere', () => {
    const c = leggiAnalisiCanali({
      tipo: 'analisi-canali', id_attivita: ID, fatta_il: LETTO,
      canali: {
        google: { stato: 'fatta', osservazioni: ['Voto medio quattro e mezzo su cinque', 'Mancano le foto'] },
        instagram: { stato: 'fatta', osservazioni: ['Su Google ha 120 recensioni', 'Pubblica poco'] },
      },
    })!;
    expect(c.canali.google?.osservazioni).toEqual(['Mancano le foto']);
    expect(c.canali.instagram?.osservazioni).toEqual(['Pubblica poco']);
  });

  it('un tema con un nome (anche uno solo, con la maiuscola) si scarta; una data di oltre un anno fa non si mostra', () => {
    const s = scheda({ business: { reputazione_temi: [{ tema: 'la cameriera Giulia', tono: 'positivo', quante: 4, fonte: DFS }] } });
    expect(leggiRapporto(s, ADESSO)).toBeNull();
    expect(leggiBlocco({ vicini: { ...vicini(3), letto_il: '1990-01-01T00:00:00Z' } }, 'vicini', ADESSO)).toBeNull();
  });

  it('chi ha pagato il Base non riceve dal server le parti escluse; senza fascia vale il Base', () => {
    const a = {
      fatti: { ricerche: blocco({ parole: [] }), concorrenti_canali: blocco({ elenco: [] }), vicini: vicini(3) },
      business: { idee_dal_confronto: [{ idea: 'x' }], confronto_concorrenti: [{ nome: 'Bar X', differenza: 'apre prima', meglio: 'video', fonte: DFS }], piano_30_giorni: [] },
    };
    for (const fascia of ['base', null] as const) {
      const v = analisiPerLaFascia(a, fascia) as { fatti: object; business: Record<string, Array<Record<string, unknown>>> };
      expect(Object.keys(v.fatti)).toEqual(['vicini']);
      expect(v.business.idee_dal_confronto).toBeUndefined();
      expect(v.business.confronto_concorrenti[0]).not.toHaveProperty('meglio');
      expect(v.business.piano_30_giorni).toBeDefined();
    }
    const premium = analisiPerLaFascia(a, 'premium') as { fatti: object };
    expect(Object.keys(premium.fatti).sort()).toEqual(['concorrenti_canali', 'ricerche', 'vicini']);
    // E la pagina, senza fascia, mostra le parti del Base.
    const { container } = render(<RapportoImprenditore scheda={scheda(a)} canali={null} sito={null} haPagato fascia={null} adesso={ADESSO} />);
    expect(container.querySelector('[data-parte="concorrenti_web"]')?.textContent).toContain('Non compresa nel Base');
  });

  it('degli indizi di /sell non partono i link a un profilo di chi recensisce né a un percorso', () => {
    expect(indiziDelTitolare('', 'https://www.google.com/maps/contrib/112233445566778899/reviews')).toBeNull();
    expect(indiziDelTitolare('', 'https://www.google.com/maps/dir/Via+Roma+12,+Piacenza/Bar+X')).toBeNull();
    expect(indiziDelTitolare('', 'https://maps.app.goo.gl/AbC123xyz')).toEqual({ google_maps: 'https://maps.app.goo.gl/AbC123xyz' });
  });
});

describe('dal secondo collaudo e dal contratto v1.3', () => {
  it('nessun voto in stelle nelle frasi, nemmeno senza dire Google', () => {
    for (const t of ['Il locale ha una media di 4,6 su 5', 'Valutazione media 4.6/5 secondo i clienti', 'ha 4,7 su 5 di media, voi meno']) {
      expect(fraseMostrabile(t), t).toBeNull();
    }
  });

  it('contatti, link e menzioni scritti in modi diversi non passano', () => {
    for (const t of ['scrivi a mario @ gmail punto com', 'Visita pizzeria.shop per il menu', 'Segui linktr.ee/pizzeria', 'Profilo ＠mario.rossi qui', 'Ne parla @àlex in un post']) {
      expect(fraseMostrabile(t, 2), t).toBeNull();
    }
  });

  it('un tema con una maiuscola qualunque si scarta (nome in testa, fra parentesi, dopo barra o virgola)', () => {
    for (const t of ['Giulia', 'Giulia è gentile', 'personale (Giulia)', 'cameriere/Marco', 'il titolare,Rossi']) expect(temaMostrabile(t), t).toBe(false);
    expect(temaMostrabile('il servizio al banco')).toBe(true);
  });

  it('prima di salvare restano solo i campi del contratto: niente stelle, rating, voti in elenco, chiavi sconosciute, temi col nome', () => {
    const salvata = analisiDaSalvare({
      ratings: { media: 4.6, totale: 412 },
      fatti: { vicini: blocco({ raggio_m: 400, concorrenti: { numero: 2, elenco: [{ nome: 'Bar X', distanza_m: 80, voto_medio: 4.2, orari_osm: 'Mo-Sa 07:00-20:00' }] } }) },
      business: {
        confronto_concorrenti: [{ nome: 'Bar X', differenza: 'apre prima', stelle: 4.7, numero_recensioni: 300, rating: 4.7, fonte: DFS }],
        reputazione_temi: [{ tema: 'Mario Rossi ha scritto: «il peggior servizio», mai più', tono: 'negativo', quante: 3, fonte: DFS }],
      },
    }) as Record<string, unknown>;
    const testo = JSON.stringify(salvata);
    expect(testo).not.toMatch(/ratings|4\.6|4\.2|4\.7|stelle|numero_recensioni|rating|Mario/);
    expect(testo).toContain('Mo-Sa 07:00-20:00');
    expect((salvata.business as Record<string, unknown[]>).reputazione_temi).toEqual([]);
  });

  it('un campo letto da Google Search o da un link breve di Google non si salva', () => {
    for (const fonte of ['https://www.google.it/search?q=bar+roma', 'https://share.google/abc', 'https://search.google.com/local/x', 'https://business.google.com/x']) {
      expect(Object.keys(campiDaSalvare({ indirizzo: { valore: 'Via Roma 1', stato: 'da_confermare', fonte } })), fonte).toEqual([]);
    }
  });

  it('una voce dell’AD presa da una pagina di Google Maps non si mostra; le voci dell’AD hanno la data', () => {
    const s = scheda({ business_fatta_il: LETTO, business: { occasioni: [{ cosa: 'Aperto fino alle due di notte', fonte: 'https://www.google.com/maps/place/x' }, { cosa: 'Mercato in piazza Cavalli', fonte: DFS }] } });
    const parte = leggiRapporto(s, ADESSO)!.calendario as PezzoParte[];
    expect(parte.flatMap((p) => p.voci.map((v) => v.titolo))).toEqual(['Mercato in piazza Cavalli']);
    expect(parte[0].fonte).toContain('del 26/11');
    // Senza nessuna data, le voci dell'AD non si mostrano.
    expect(leggiRapporto(scheda({ business: { occasioni: [{ cosa: 'Mercato in piazza Cavalli', fonte: DFS }] } }), ADESSO)).toBeNull();
  });

  it('il Business riceve 3 concorrenti sui social e sul web, il Premium 5', () => {
    const elencoCinque = Array.from({ length: 5 }, (_, i) => ({ nome: `Bar ${i + 1}` }));
    const a = { fatti: { concorrenti_canali: blocco({ elenco: elencoCinque }) } };
    const quanti = (f: 'business' | 'premium') => ((analisiPerLaFascia(a, f) as unknown as { fatti: { concorrenti_canali: { dati: { elenco: unknown[] } } } }).fatti.concorrenti_canali.dati.elenco).length;
    expect(quanti('business')).toBe(3);
    expect(quanti('premium')).toBe(5);
  });

  it('degli indizi di /sell non partono link con un profilo, una recensione o un account, e la parte dopo «?» si toglie', () => {
    expect(indiziDelTitolare('', 'https://www.google.com/maps/place/Bar+Roma/contrib/1234567890/reviews')).toBeNull();
    expect(indiziDelTitolare('', 'https://www.google.com/maps/place/Bar+Roma/@45,9,17z?authuser=mario.rossi@gmail.com')).toBeNull();
    expect(indiziDelTitolare('', 'https://g.page/r/abc/review?mario')).toBeNull();
    expect(indiziDelTitolare('', 'https://www.google.com/maps/place/Bar+Roma/@45,9,17z?entry=ttu')).toEqual({ google_maps: 'https://www.google.com/maps/place/Bar+Roma/@45,9,17z' });
  });

  it('stato «vuoto» senza numero: lo zero è contato, non «non ancora letto»', () => {
    const s = scheda({ fatti: { vicini: { ...blocco({}), stato: 'vuoto' } } });
    expect(assaggio({ scheda: s }, ADESSO).find((n) => n.id === 'concorrenti')!.valore).toBe('nessuna attività simile');
  });

  it('il piano dei 30 giorni dice anche cosa facciamo noi (contratto v1.3, `proposta`)', () => {
    const s = scheda({ business_fatta_il: LETTO, business: { piano_30_giorni: [{ settimana: 2, azione: 'Mostrare le brioche del mattino', servizio: 'social', proposta: 'Pubblichiamo tre storie a settimana', fonte: DFS }] } });
    const v = (leggiRapporto(s, ADESSO)!.piano_30_giorni as PezzoParte[])[0].voci[0];
    expect(v).toEqual({ titolo: 'Settimana 2', dettaglio: 'Mostrare le brioche del mattino · lo facciamo noi: Pubblichiamo tre storie a settimana' });
  });

  it('una scheda parziale aggiunge e non scrive mai un vuoto sopra un pieno (contratto v1.3, regola 8)', async () => {
    db.esistente = {
      tipo: 'scheda-cliente', id_attivita: ID, campi: { indirizzo: { valore: 'Via Roma 1', stato: 'confermato', fonte: 'https://www.bar.it' } },
      analisi: { tipo_di_locale: 'bar', fatti: { vicini: vicini(4), instagram: instagram(100) }, business: { situazione: [{ testo: 'Bar in centro da dieci anni', fonte: 'https://x.it' }] } },
    };
    const r = await manda({
      tipo: 'scheda-cliente', id_attivita: ID, parziale: true, campi: {},
      analisi: { tipo_di_locale: '', fatti: { vicini: blocco(null, { stato: 'errore', motivo: 'Overpass non risponde' }), meteo: blocco({ giorni: [] }, { fonte_nome: 'MET Norway', licenza: 'CC BY 4.0' }) }, business: { situazione: [], occasioni: [{ cosa: 'Mercato', fonte: DFS }] } },
    });
    expect(r.status).toBe(200);
    const salvata = db.salvate[0].scheda as { campi: Record<string, unknown>; analisi: { tipo_di_locale: string; fatti: Record<string, { stato: string }>; business: Record<string, unknown[]> } };
    expect(Object.keys(salvata.campi)).toEqual(['indirizzo']);
    expect(salvata.analisi.tipo_di_locale).toBe('bar');
    expect(salvata.analisi.fatti.vicini.stato).toBe('letto');
    expect(salvata.analisi.fatti.instagram.stato).toBe('letto');
    expect(salvata.analisi.fatti.meteo.stato).toBe('letto');
    expect(salvata.analisi.business.situazione).toHaveLength(1);
    expect(salvata.analisi.business.occasioni).toHaveLength(1);
    db.esistente = null;
  });
});

// ─── La porta per n8n, per la prova 3 ────────────────────────────────────────────────────
const db = vi.hoisted(() => ({ salvate: [] as Array<Record<string, unknown>>, esistente: null as null | Record<string, unknown> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSec: 0, limit: 60 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ID, role: 'seller' }, error: null }) }) }) };
      if (tabella === 'schede_clienti') return {
        upsert: async (riga: Record<string, unknown>) => { db.salvate.push(riga); return { error: null }; },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.esistente ? { scheda: db.esistente } : null, error: null }) }) }),
      };
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
