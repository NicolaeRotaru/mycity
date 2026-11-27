/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 — IL LAVORO PREMIUM CONSEGNATO DI SDG, nel menu Servizi.
 * Nicola: «quando SDG entra nella sua pagina da venditore… nella voce sito ci deve essere già il sito web,
 * nella voce social tutto il piano editoriale, nella voce analisi tutta l'analisi fatta bene di SDG».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { AnalisiSchema, SitoSchema, SocialSchema, type Analisi, type LavoroConsegnato, type Sito, type Social } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { lavoroConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';
import { parteDaMostrare } from '@/lib/agenzia/lavoro-consegnato/quale-parte';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';
import SitoConsegnato from '@/components/seller/lavoro-consegnato/SitoConsegnato';
import PianoEditorialeConsegnato from '@/components/seller/lavoro-consegnato/PianoEditorialeConsegnato';
import AnalisiConsegnata from '@/components/seller/lavoro-consegnato/AnalisiConsegnata';

const DIR = path.resolve(__dirname, '../../lib/agenzia/lavoro-consegnato/sdg');
const file = (n: string) => JSON.parse(readFileSync(path.join(DIR, n), 'utf8')) as unknown;

describe('i tre file di SDG sono nella forma del contratto', () => {
  it.each([['analisi.json', AnalisiSchema], ['social.json', SocialSchema], ['sito.json', SitoSchema]] as const)('%s passa lo schema', (nome, schema) => {
    const r = schema.safeParse(file(nome));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 5))).toBe(true);
  });

  it('un file rotto diventa rosso: indirizzo http e giorno storto non passano', () => {
    expect(SitoSchema.safeParse({ ...(file('sito.json') as object), indirizzo: 'http://x.it' }).success).toBe(false);
    expect(SocialSchema.safeParse({ ...(file('social.json') as object), calendario: [{ giorno: '1/12', ora: '12:30' }] }).success).toBe(false);
    expect(AnalisiSchema.safeParse({ titolo: 'x' }).success).toBe(false);
  });
});

describe('chi ha il lavoro consegnato', () => {
  it('SDG ha il premium con le tre parti, un altro negozio niente', () => {
    const l = lavoroConsegnatoDi(SDG_SELLER_ID);
    expect(l?.fascia).toBe('premium');
    expect(l?.sito && l.social && l.analisi).toBeTruthy();
    expect(lavoroConsegnatoDi('0de1905e-7000-4000-8000-000000000001')).toBeNull();
    expect(lavoroConsegnatoDi('')).toBeNull();
  });
});

const base: LavoroConsegnato = { negozioId: SDG_SELLER_ID, fascia: 'premium' };
describe('quale parte mostra la pagina del servizio', () => {
  const pieno: LavoroConsegnato = { ...base, sito: {} as Sito, social: {} as Social, analisi: {} as Analisi };
  it('sito_web, social, analisi mostrano la loro parte; foto_video e chi non ha il lavoro, il preventivo', () => {
    expect(parteDaMostrare('sito_web', pieno)).toBe('sito');
    expect(parteDaMostrare('social', pieno)).toBe('social');
    expect(parteDaMostrare('analisi', pieno)).toBe('analisi');
    expect(parteDaMostrare('foto_video', pieno)).toBeNull();
    expect(parteDaMostrare('social', null)).toBeNull();
    expect(parteDaMostrare('social', undefined)).toBeNull();
    expect(parteDaMostrare('social', { ...base, sito: {} as Sito })).toBeNull(); // parte non valida = pagina di oggi
  });
});

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

describe('i tre componenti mostrano i pezzi chiave', () => {
  it('sito: stato, apri il sito, codice, pagine, premium, da confermare, passi', async () => {
    const sito = SitoSchema.parse({
      titolo: 'Il sito di SDG', aggiornato_il: '2026-11-27T16:00:00+01:00', stato: 'online', indirizzo: 'https://sdg.example.it', codice: 'https://github.com/x/SDG',
      pagine: [{ titolo: 'Home', percorso: '/', cosa_contiene: 'La prima pagina' }], cosa_ha_di_premium: ['Pagina per ogni servizio'],
      da_confermare: [{ voce: 'Telefono', perche: 'vuoto' }], prossimi_passi: [{ cosa: 'Pubblicarlo', chi: 'Nicola' }],
    });
    const r = await monta(createElement(SitoConsegnato, { sito }));
    const t = r.textContent ?? '';
    expect(t).toContain('Premium · lavoro consegnato');
    expect(t).toContain('aggiornato il 27 novembre 2026');
    expect(t).toContain('Online');
    expect(r.querySelector('a[href="https://sdg.example.it"]')?.textContent).toBe('Apri il sito');
    expect(t).toContain('Pagina per ogni servizio');
    expect(t).toContain('Telefono');
    expect(t).toContain('Pubblicarlo');
    const senza = await monta(createElement(SitoConsegnato, { sito: { ...sito, stato: 'da_pubblicare', indirizzo: null } }));
    expect(senza.textContent).toContain('Da pubblicare');
    expect(senza.textContent).not.toContain('Apri il sito');
  });

  it('piano: giorno in italiano, ore, strato, da approvare, didascalia in details, filtro per canale', async () => {
    const social = SocialSchema.parse({
      titolo: 'Piano di dicembre', fascia: 'premium', mese: '2026-12', aggiornato_il: '2026-11-27T16:00:00+01:00', obiettivo: 'Quindici richieste', a_chi_parliamo: 'Titolari',
      canali: [{ nome: 'TikTok', account: null, ruolo: 'Reel', da_aprire: true }, { nome: 'Instagram', account: '@sdg', ruolo: 'Vetrina', da_aprire: false }],
      pilastri: [{ nome: 'Prima e dopo', percentuale: 30, descrizione: 'Casi' }], quantita: [{ voce: 'Contenuti', quanti: 20 }],
      calendario: [
        { giorno: '2026-12-01', ora: '12:30', canale: 'Instagram', formato: 'Reel', pilastro: 'Prima e dopo', titolo: 'Il bar prima e dopo', testo: 'Didascalia pronta uno', strato: 'premium', stato: 'da_approvare' },
        { giorno: '2026-12-09', ora: '18:00', canale: 'TikTok', formato: 'Reel', pilastro: 'Prima e dopo', titolo: 'Dietro le quinte', testo: 'Didascalia due', strato: 'base', stato: 'da_approvare' },
      ],
      extra_premium: [{ voce: 'Pubblicità su Meta', cosa: 'Campagna', costo_fuori_canone: '≈ 150 €' }], misure: [{ kpi: 'Diagnosi', obiettivo: '15', come_si_misura: 'Form' }], regole: ['Esce solo ciò che approva Nicola'],
    });
    const r = await monta(createElement(PianoEditorialeConsegnato, { social }));
    const t = r.textContent ?? '';
    expect(t).toMatch(/mar 1 dic/);
    expect(t).toContain('12:30');
    expect(t).toContain('Strato Premium');
    expect(t).toContain('Da approvare');
    expect(t).toContain('da aprire');
    expect(t).toContain('30%');
    expect(r.querySelectorAll('details').length).toBe(2);
    expect(t).toContain('Pubblicità su Meta');
    expect(t).toContain('Esce solo ciò che approva Nicola');
    const filtro = r.querySelector('#piano-filtro') as HTMLSelectElement;
    await act(async () => { filtro.value = 'TikTok'; filtro.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(r.querySelectorAll('details').length).toBe(1);
    expect(r.textContent).toContain('Dietro le quinte');
    expect(r.textContent).not.toContain('Il bar prima e dopo');
  });

  it('analisi: sintesi, numeri con fonte, concorrenti, SWOT in 4 riquadri, raccomandazioni, link esterni sicuri', async () => {
    const analisi = AnalisiSchema.parse({
      titolo: 'Analisi di SDG', aggiornata_il: '2026-11-27T16:00:00+01:00', sintesi: 'SDG sta in mezzo al mercato.',
      numeri_chiave: [{ voce: 'Imprese', valore: '≈ 28.000', fonte: 'https://fonte.example.it/a' }],
      mercato: [{ titolo: 'Mercato locale', testo: 'Grande', fonti: ['https://fonte.example.it/b'] }],
      concorrenti: [{ nome: 'Agenzia Rossi', tipo: 'agenzia locale', cosa_fanno: 'Social', prezzo_indicativo: 'da 400 €/mese', punti_forti: ['Nome'], punti_deboli: ['Prezzo'], fonte: 'https://fonte.example.it/c' }],
      swot: { forze: ['Prezzo chiaro'], debolezze: ['Poca storia'], opportunita: ['Negozi del centro'], minacce: ['Fai da te'] },
      clienti_tipo: [{ nome: 'Bar del centro', bisogno: 'Più clienti', abbonamento_adatto: 'business', perche: 'Costa poco' }],
      prezzi: [{ voce: 'Base 300 €', confronto: 'Sotto la media' }],
      presenza_online_sdg: [{ canale: 'Instagram', stato: 'da verificare', indirizzo: null, nota: 'controllare' }],
      raccomandazioni: [{ priorita: 2, cosa: 'Seconda mossa', perche: 'p', quando: 'entro il 31/12', costo: '0 €' }, { priorita: 1, cosa: 'Prima mossa', perche: 'p', quando: 'entro il 15/12', costo: '≈ 150 €' }],
      fonti: ['https://fonte.example.it/d'],
    });
    const r = await monta(createElement(AnalisiConsegnata, { analisi }));
    const t = r.textContent ?? '';
    expect(t).toContain('SDG sta in mezzo al mercato.');
    expect(t).toContain('≈ 28.000');
    expect(t).toContain('Agenzia Rossi');
    for (const q of ['Prezzo chiaro', 'Poca storia', 'Negozi del centro', 'Fai da te']) expect(t).toContain(q);
    expect(r.querySelectorAll('section[aria-labelledby="an-swot"] > div > div').length).toBe(4);
    expect(t.indexOf('Prima mossa')).toBeLessThan(t.indexOf('Seconda mossa'));
    expect(t).toContain('entro il 15/12');
    const esterni = Array.from(r.querySelectorAll('a[href^="https://"]'));
    expect(esterni.length).toBe(4);
    for (const a of esterni) expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
