/**
 * @vitest-environment jsdom
 */
/**
 * 28/11/2026 — L'ANALISI DI MERCATO DI SDG È LO STANDARD PER OGNI CLIENTE.
 * Nicola: «anche l'analisi di mercato è molto molto bella e vorrei che venisse usato come standard questo per tutti.
 * Poi va personalizzato in base all'abbonamento e in base al cliente… questa analisi che si fa sul cliente la si usa
 * per personalizzare il servizio».
 *
 * Queste prove dicono:
 *  ① l'AD scrive anche i pezzi dello standard (forze e debolezze, concorrenti, clienti tipo, numeri con la fonte), con
 *    le regole legali di sempre: una voce che le rompe si toglie, un'analisi di prima resta valida;
 *  ② l'abbonamento decide le parti, quanti concorrenti e cosa comprende la fascia;
 *  ③ il titolare vede la pagina dell'analisi di SDG, con la sua fascia e «bozza»;
 *  ④ l'analisi cuce anche il piano social: «Da dove partiamo».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { AnalisiSchema } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { ANALISI_PER_FASCIA } from '@/lib/agenzia/rapporto';
import { CONCORRENTI_PER_FASCIA, COMPITO_ANALISI, SCHEMA_ANALISI, analisiDallaRisposta, datiPerLAnalisi, partiDaScrivere, type AnalisiAvvioOrdine } from '@/lib/agenzia/analisi-dell-ordine-ad';
import { TETTI_FLUSSO_14 } from '@/lib/agenzia/piano-completo-ad';
import { analisiDallOrdine, daDovePartiamoSuiSocial } from '@/lib/agenzia/analisi-standard';
import { pianoDelPrimoMese } from '@/lib/agenzia/piano-del-primo-mese';
import type { LavoroDellOrdine } from '@/lib/agenzia/lavoro-dell-ordine';
import LavoroDellOrdineDelTitolare from '@/components/seller/lavoro-consegnato/LavoroDellOrdine';

type Fascia = 'base' | 'business' | 'premium';
const concorrente = (n: number, extra: Record<string, unknown> = {}) => ({
  nome: `Pasticceria Esempio ${n}`, cosa_fanno: 'Dolci da banco e torte su ordinazione, con vendita anche sul web.',
  punti_forti: ['La vetrina curata si nota dalla strada.'], punti_deboli: ['Non pubblica quasi mai sui social.'],
  fonte: `https://www.pasticceria-esempio-${n}.it/`, ...extra,
});
const risposta = (fascia: Fascia, extra: Record<string, unknown> = {}) => ({
  sintesi: ['Il locale è in centro, in una zona di passaggio tutto il giorno.'],
  parti: partiDaScrivere(fascia).map((parte) => ({ parte, frasi: [parte === 'social' ? 'Il profilo Instagram pubblica poco e senza video.' : 'Lo leggiamo insieme alla prima visita.'], fonti: [] as string[] })),
  prime_mosse: [
    { cosa: 'Sistemare la vetrina su MyCity', perche: 'è la prima cosa che vede chi cerca un bar in zona', quando: 'settimana 1' },
    { cosa: 'Pubblicare le prime foto del locale', perche: 'oggi online non ci sono foto recenti', quando: 'settimana 2' },
    { cosa: 'Preparare il primo mese di post', perche: 'serve una presenza costante sui social' },
  ],
  da_confermare: ['I giorni di chiusura del locale'],
  ...extra,
});
const PEZZI = {
  swot: {
    forze: ['La posizione in centro porta passaggio tutto il giorno.'], debolezze: ['Online si vedono poche foto del locale.'],
    opportunita: ['Il mercato del sabato porta gente nella piazza vicina.'], minacce: ['Due bar nuovi hanno aperto nella stessa via.'],
  },
  concorrenti: [concorrente(1), concorrente(2), concorrente(3), concorrente(4), concorrente(5), concorrente(6)],
  clienti_tipo: [{ nome: 'Chi lavora in zona', bisogno: 'Una pausa veloce e buona tra una riunione e l’altra.', perche: 'Il bancone è a due passi dagli uffici della via.' }],
  numeri_chiave: [{ voce: 'Abitanti del quartiere', valore: '12.400', fonte: 'https://statistica.comune.piacenza.it/quartieri' }],
};
const avvio = (fascia: Fascia, extra: Record<string, unknown> = PEZZI): AnalisiAvvioOrdine => {
  const e = analisiDallaRisposta(risposta(fascia, extra), fascia, 'Caffè di Prova');
  if (!e.ok) throw new Error(e.motivo);
  return e.analisi;
};

describe('① i pezzi dello standard, con le regole legali di sempre', () => {
  it('un’analisi di prima, senza i pezzi nuovi, resta valida', () => {
    const e = analisiDallaRisposta(risposta('business'), 'business', 'Caffè di Prova');
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.analisi.concorrenti).toEqual([]);
    expect(e.analisi.swot).toEqual({ forze: [], debolezze: [], opportunita: [], minacce: [] });
    expect(e.analisi.primeMosse[0].quando).toBe('settimana 1');
    expect(e.analisi.primeMosse[2].quando).toBeNull();
  });

  it('i pezzi buoni entrano; quelli che rompono una regola si tolgono senza scartare l’analisi', () => {
    const a = avvio('premium', {
      ...PEZZI,
      swot: { ...PEZZI.swot, forze: [...PEZZI.swot.forze, 'Il caffè costa 1,20 € al banco.', 'Lo dice Mario Rossi, il titolare.'] },
      concorrenti: [concorrente(1), concorrente(2, { cosa_fanno: 'Colazione completa a 5 € a persona.' }), concorrente(3, { fonte: 'https://www.google.com/maps/place/x' })],
      numeri_chiave: [
        ...PEZZI.numeri_chiave,
        { voce: 'Voto medio', valore: '4,5 stelle', fonte: 'https://www.esempio.it/' },
        { voce: 'Attività simili vicine', valore: '7', fonte: '' },
        { voce: 'Recensioni del locale', valore: '230', fonte: 'https://www.esempio.it/' },
      ],
    });
    expect(a.swot?.forze).toEqual(PEZZI.swot.forze);
    expect(a.concorrenti?.map((c) => c.nome)).toEqual(['Pasticceria Esempio 1', 'Pasticceria Esempio 3']);
    expect(a.concorrenti?.[1].fonte).toBeNull();
    expect(a.numeriChiave).toEqual(PEZZI.numeri_chiave);
  });

  it.each([['base', 3], ['business', 6], ['premium', 8]] as const)('%s: al massimo %i concorrenti (3 vicini, più quelli sul web del listino)', (fascia, quanti) => {
    const dieci = Array.from({ length: 10 }, (_, i) => concorrente(i + 1));
    expect(CONCORRENTI_PER_FASCIA[fascia]).toBe(quanti);
    expect(avvio(fascia, { ...PEZZI, concorrenti: [...dieci, concorrente(1)] }).concorrenti?.length).toBe(quanti);
  });

  it('collaudo 28/11: un voto detto senza «Google», coi suoi sinonimi, non arriva mai a schermo', () => {
    const voti = ['Il locale ha una media di 4,5 stelle fra i clienti.', 'I clienti gli danno 5 stelle quasi sempre.', 'Il giudizio dei clienti è ★★★★★ da mesi.', 'I clienti lo votano 4/5 in media da un anno.', 'Il servizio prende 9/10 dai clienti abituali.', 'Ha raccolto 230 opinioni dei clienti in un anno.'];
    const a = avvio('premium', {
      ...PEZZI,
      swot: { ...PEZZI.swot, forze: [...PEZZI.swot.forze, ...voti.slice(0, 3)], minacce: [...PEZZI.swot.minacce, ...voti.slice(3)] },
      concorrenti: [concorrente(1, { nome: 'Bar Roma 4,5 stelle' }), concorrente(2, { nome: 'Bar Roma 4/5' }), concorrente(3, { punti_forti: [voti[0]] })],
      clienti_tipo: [{ nome: 'Chi lavora in zona', bisogno: voti[5], perche: null }, ...PEZZI.clienti_tipo],
      numeri_chiave: [
        ...PEZZI.numeri_chiave,
        { voce: 'Giudizio medio', valore: '4/5', fonte: 'https://www.esempio.it/' },
        { voce: 'Media della zona', valore: '9/10', fonte: 'https://www.esempio.it/' },
        { voce: 'Opinioni dei clienti', valore: '230', fonte: 'https://www.esempio.it/' },
        { voce: 'Chi guida il comune', valore: 'Mario Rossi', fonte: 'https://www.esempio.it/' },
      ],
    });
    const tutto = JSON.stringify(a);
    for (const v of voti) expect(tutto, v).not.toContain(v);
    expect(a.concorrenti?.map((c) => c.nome)).toEqual(['Pasticceria Esempio 3']);
    expect(a.concorrenti?.[0].puntiForti).toEqual([]);
    expect(a.clientiTipo?.map((c) => c.nome)).toEqual(['Chi lavora in zona']);
    expect(a.clientiTipo?.[0].bisogno).toBe(PEZZI.clienti_tipo[0].bisogno);
    expect(a.numeriChiave).toEqual(PEZZI.numeri_chiave);
  });

  it('collaudo 28/11: una fonte goo.gle o su un dominio .google non entra', () => {
    const a = avvio('business', { ...PEZZI, concorrenti: [concorrente(1, { fonte: 'https://goo.gle/abc' }), concorrente(2, { fonte: 'https://maps.example.google/x' })] });
    expect(a.concorrenti?.map((c) => c.fonte)).toEqual([null, null]);
  });

  it('il compito chiede lo standard, i dati dicono quanti concorrenti, e la richiesta sta nel tetto del flusso 14', () => {
    expect(COMPITO_ANALISI).toMatch(/LO STANDARD è l'analisi di mercato che SDG Agenzia ha fatto per se stessa/);
    expect(SCHEMA_ANALISI.required).toEqual(['sintesi', 'parti', 'prime_mosse', 'da_confermare']);
    for (const fascia of ['base', 'business', 'premium'] as const) {
      const dati = datiPerLAnalisi({ nome: 'X', tipo: 'bar', citta: 'Piacenza', indirizzo: null, fascia, scheda: null });
      expect(dati.abbonamento.concorrenti_al_massimo).toBe(CONCORRENTI_PER_FASCIA[fascia]);
      expect(JSON.stringify({ compito: COMPITO_ANALISI, dati, schema: SCHEMA_ANALISI }).length).toBeLessThanOrEqual(TETTI_FLUSSO_14.richiesta);
    }
    expect(COMPITO_ANALISI.length).toBeLessThanOrEqual(TETTI_FLUSSO_14.compito);
  });
});

describe('② la forma di SDG, misurata sull’abbonamento e sul cliente', () => {
  it.each(['base', 'business', 'premium'] as const)('%s: lo schema dell’analisi di SDG, le parti della fascia, cosa comprende', (fascia) => {
    const a = analisiDallOrdine(avvio(fascia), { nome: 'Caffè di Prova', fascia, canaliTrovati: [{ canale: 'Instagram', fonte: 'https://www.instagram.com/caffe/' }], sito: null });
    const letta = AnalisiSchema.safeParse(a);
    expect(letta.success, letta.success ? '' : JSON.stringify(letta.error.issues.slice(0, 3))).toBe(true);
    expect(a.mercato.length).toBe(partiDaScrivere(fascia).length);
    expect(a.compreso?.voci[0]).toBe(ANALISI_PER_FASCIA[fascia].ritmo);
    // Collaudo 28/11: quello che la fascia non comprende si dice per quello che è.
    for (const v of ANALISI_PER_FASCIA[fascia].nonComprende) expect(a.compreso?.voci).toContain(`Non compreso: ${v}`);
    expect(a.compreso?.voci.filter((v) => /ci sono nel/.test(v)).every((v) => v.startsWith('Non compreso: '))).toBe(true);
    expect(a.prezzi).toEqual([]);
    expect(a.raccomandazioni.map((r) => r.priorita)).toEqual([1, 2, 3]);
    expect(a.raccomandazioni[0].quando).toBe('settimana 1');
    expect(a.clienti_tipo.every((c) => c.abbonamento_adatto === null)).toBe(true);
    const presenza = Object.fromEntries(a.presenza_online_sdg.map((p) => [p.canale, p]));
    expect(presenza.Instagram).toMatchObject({ stato: 'trovato', indirizzo: 'https://www.instagram.com/caffe/' });
    expect(presenza['Sito web'].stato).toBe('da verificare alla visita');
    expect(JSON.stringify(a.presenza_online_sdg)).not.toMatch(/non c'è|non ha|assente/i);
    expect(a.fonti).toContain('https://statistica.comune.piacenza.it/quartieri');
  });

  it('collaudo 28/11: una pagina di TripAdvisor registrata come sito non diventa «Sito web: trovato»', () => {
    const a = analisiDallOrdine(avvio('base'), { nome: 'X', fascia: 'base', sito: 'https://www.tripadvisor.it/Restaurant_Review-x' });
    expect(a.presenza_online_sdg.find((p) => p.canale === 'Sito web')).toMatchObject({ stato: 'da verificare alla visita', indirizzo: null });
  });

  it('il Base non comprende i concorrenti sul web né le ricerche: non ci sono neanche nella pagina', () => {
    const base = analisiDallOrdine(avvio('base'), { nome: 'X', fascia: 'base' });
    const titoli = base.mercato.map((m) => m.titolo);
    expect(titoli).not.toContain('I concorrenti sui social e sul web');
    expect(titoli).not.toContain('Cosa cerca la gente');
    expect(analisiDallOrdine(avvio('premium'), { nome: 'X', fascia: 'premium' }).mercato.map((m) => m.titolo)).toContain('I concorrenti sui social e sul web');
  });
});

describe('③ e ④ le pagine del titolare', () => {
  const accesi: Root[] = [];
  afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); document.body.innerHTML = ''; });
  async function monta(el: React.ReactElement) {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const d = document.createElement('div');
    document.body.appendChild(d);
    const root = createRoot(d);
    accesi.push(root);
    await act(async () => { root.render(el); });
    return d;
  }
  const ordine = (fascia: Fascia, analisi: AnalisiAvvioOrdine | null): LavoroDellOrdine => ({
    fascia, servizi: null, nomeAttivita: 'Caffè di Prova',
    piano: { stato: 'pronto', piano: pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo: 'bar', fascia, accettatoIl: '2026-11-28T10:00:00+01:00' }) },
    sito: { stato: 'lo_stiamo_preparando', bozza: null, indirizzo: null },
    analisi: { stato: analisi ? 'pronto' : 'in_preparazione', analisi },
    perLoStandard: { tipo: 'bar', citta: 'Piacenza', canaliTrovati: null, suMisura: null, sito: null },
  });

  it('l’analisi del cliente ha le parti dell’analisi di SDG, con la sua fascia e «bozza»', async () => {
    const r = await monta(createElement(LavoroDellOrdineDelTitolare, { parte: 'analisi', ordine: ordine('business', avvio('business')) }));
    const t = r.textContent ?? '';
    for (const parte of ['Analisi di mercato Business di Caffè di Prova', 'I numeri chiave', 'Il mercato', 'I concorrenti', 'Forze, debolezze, opportunità, minacce', 'I clienti tipo', 'La tua presenza online', 'Cosa fare, in ordine', 'Da confermare alla visita', 'Compreso nel Business', 'Le fonti']) {
      expect(t, parte).toContain(parte);
    }
    expect(t).toContain('Business · Bozza, la confermiamo insieme alla visita');
    expect(t).toContain('Questo è il rapporto dell’avvio, fatto coi soli dati pubblici.');
    expect(t).not.toContain('lavoro consegnato');
    expect(t).not.toContain('La presenza online di SDG');
    expect(t).not.toContain('I prezzi a confronto');
  });

  it('un’analisi di prima dello standard non mostra quattro riquadri vuoti', async () => {
    const vecchia = avvio('base', {});
    const r = await monta(createElement(LavoroDellOrdineDelTitolare, { parte: 'analisi', ordine: ordine('base', vecchia) }));
    const t = r.textContent ?? '';
    expect(t).not.toContain('Forze, debolezze');
    expect(t).not.toContain('Niente da segnalare');
    expect(t).toContain('Cosa fare, in ordine');
  });

  it('l’analisi pronta cuce il piano social: «Da dove partiamo» con quello che ha visto sui social', async () => {
    const a = avvio('premium');
    expect(daDovePartiamoSuiSocial(a)).toContain('Il profilo Instagram pubblica poco e senza video.');
    // La frase di riempimento della parte «concorrenti sul web» non entra (collaudo 28/11).
    expect(daDovePartiamoSuiSocial(a)).not.toContain('Lo leggiamo insieme alla prima visita.');
    const conAnalisi = await monta(createElement(LavoroDellOrdineDelTitolare, { parte: 'social', ordine: ordine('premium', a) }));
    expect(conAnalisi.textContent).toContain('Da dove partiamo');
    expect(conAnalisi.textContent).toContain('Il profilo Instagram pubblica poco e senza video.');
    const senza = await monta(createElement(LavoroDellOrdineDelTitolare, { parte: 'social', ordine: ordine('premium', null) }));
    expect(senza.textContent).not.toContain('Da dove partiamo');
  });
});
