/**
 * ARMONIA NASCOSTA (Nicola, 28/11/2026) — proporzioni, numeri, cielo, forme e magia dentro ogni sito.
 * Queste prove dicono che i calcoli sono quelli della tradizione, che i vietati non escono mai,
 * e che dentro la bozza del sito e nel piè di pagina la trama è muta e non copre il testo.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CARATTERI,
  FIRMA_MYCITY,
  MOTIVI,
  ELEMENTI,
  ammessoVicino,
  eMagico,
  elementoCinese,
  faseLuna,
  firmaDi,
  motivoAmmesso,
  numeroAmmesso,
  numerologia,
  ordineDiAccensione,
  poligono,
  quadratoDi,
  rosaEtrusca,
  prossimaLuna,
  ritardiDiAccensione,
  motivoPerFirma,
  segnoDi,
  sigillo,
  spiraleAurea,
  tokenCss,
  trama,
  type Motivo,
  type Pianeta,
} from '@/lib/armonia';
import TramaNascosta from '@/components/armonia/TramaNascosta';
import LunaDiOggi from '@/components/armonia/LunaDiOggi';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';

// Per rendere il piè di pagina, come in minori-s08-piede.test.tsx.
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }) }));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

const giorno = (s: string) => new Date(`${s}T12:00:00Z`);

describe('i numeri', () => {
  it('fa la numerologia pitagorica del nome, accenti e spazi esclusi', () => {
    expect(numerologia('SDG Agenzia')).toMatchObject({ totale: 48, passi: [48, 12, 3], numero: 3, maestro: null });
    expect(numerologia('MyCity').numero).toBe(5);
    expect(numerologia("Caffè d'Oro").lettere).toBe('CAFFEDORO');
    expect(numerologia('').numero).toBe(0);
  });

  it('si ferma sui numeri maestri e li riduce per il disegno', () => {
    expect(numerologia('IB')).toMatchObject({ totale: 11, maestro: 11, numero: 2 });
  });

  it('i caratteri crescono di 1,618', () => {
    expect([...CARATTERI]).toEqual([16, 26, 42, 68]);
  });

  it('i numeri vietati non passano mai', () => {
    for (const n of [14, 17, 18, 88, 666, 1488, 8814]) expect(numeroAmmesso(n)).toBe(false);
    expect(numeroAmmesso(333)).toBe(true);
    expect(ammessoVicino(17)).toBe(19);
  });

  it('nessuna durata di nessuna firma cade su un numero vietato', () => {
    for (let numero = 1; numero <= 9; numero++) {
      for (const e of Object.values(ELEMENTI)) expect(numeroAmmesso(ammessoVicino(numero * 111 * e.fattoreTempo))).toBe(true);
    }
    // «F» vale 6, senza data è aria (fattore 1): 6 × 111 = 666, che la firma deve scavalcare.
    expect(firmaDi({ nome: 'F' }).durata).toBe(667);
  });
});

describe('il cielo', () => {
  it('il segno viene dal Sole vero, non da una tabella fissa: gli ingressi cambiano ogni anno', () => {
    // Ariete 2028 entra il 20/03 alle 03:11 di Roma: a mezzogiorno è già Ariete (una tabella fissa direbbe Pesci).
    expect(segnoDi(giorno('2028-03-20'))).toBe('Ariete');
    expect(segnoDi(giorno('2024-03-20'))).toBe('Ariete');
    // Toro 2024 entra il 19/04 alle 15:56: a mezzogiorno del 19 è ancora Ariete.
    expect(segnoDi(giorno('2024-04-19'))).toBe('Ariete');
    expect(segnoDi(giorno('2024-04-20'))).toBe('Toro');
  });

  it('trova il segno ai confini', () => {
    expect(segnoDi(giorno('2026-03-20'))).toBe('Pesci');
    expect(segnoDi(giorno('2026-03-21'))).toBe('Ariete');
    expect(segnoDi(giorno('2026-01-19'))).toBe('Capricorno');
    expect(segnoDi(giorno('2026-01-20'))).toBe('Acquario');
    expect(segnoDi(giorno('2026-12-22'))).toBe('Capricorno');
    expect(segnoDi(giorno('2026-11-28'))).toBe('Sagittario');
  });

  it("dà l'elemento cinese dell'anno, che comincia al lichun (Sole a 315°)", () => {
    expect(elementoCinese(giorno('2026-11-28'))).toBe('fuoco');
    expect(elementoCinese(giorno('2026-02-03'))).toBe('legno'); // lichun 2026: 3/2 alle 20:54 di Roma
    expect(elementoCinese(giorno('2026-02-04'))).toBe('fuoco');
    // lichun 2024: 4/2 alle 16:27 di Pechino, cioè le 9:27 di Roma: a mezzogiorno del 4 è già il 2024.
    expect(elementoCinese(giorno('2024-02-03'))).toBe('acqua');
    expect(elementoCinese(giorno('2024-02-04'))).toBe('legno');
  });

  it('la luna è nuova durante un\'eclissi di sole e piena durante un\'eclissi di luna', () => {
    const nuova = faseLuna(Date.UTC(2024, 3, 8, 18, 21)); // eclissi totale di sole, 8 aprile 2024
    expect(Math.min(nuova, 1 - nuova)).toBeLessThan(0.005);
    expect(Math.abs(faseLuna(Date.UTC(2024, 8, 18, 2, 34)) - 0.5)).toBeLessThan(0.005); // eclissi di luna, 18 settembre 2024
  });

  it('la luna vera sta entro poche ore dalle fasi di Meeus, dove il mese medio sbagliava di 13 ore', () => {
    const nuova = faseLuna(Date.UTC(2026, 9, 10, 15, 50)); // novilunio 10/10/2026 17:50 di Roma
    expect(Math.min(nuova, 1 - nuova)).toBeLessThan(0.005);
    const t = prossimaLuna(0, Date.UTC(2026, 9, 1)).getTime();
    expect(Math.abs(t - Date.UTC(2026, 9, 10, 15, 50))).toBeLessThan(3_600_000);
    const piena = prossimaLuna(0.5, Date.UTC(2026, 10, 20)).getTime(); // plenilunio 24/11/2026 15:53 di Roma
    expect(Math.abs(piena - Date.UTC(2026, 10, 24, 14, 53))).toBeLessThan(3_600_000);
  });
});

describe('la magia', () => {
  const pianeti: Pianeta[] = ['Sole', 'Luna', 'Mercurio', 'Venere', 'Marte', 'Giove', 'Saturno'];

  it('ogni quadrato dei pianeti è magico, e il 6×6 del Sole (666) non si usa', () => {
    for (const p of pianeti) expect(eMagico(quadratoDi(p))).toBe(true);
    expect(pianeti.some((p) => quadratoDi(p).length === 6)).toBe(false);
    expect(quadratoDi('Saturno')).toEqual([[4, 9, 2], [3, 5, 7], [8, 1, 6]]);
    // I quadrati di Agrippa, non quadrati qualunque dello stesso ordine.
    expect(quadratoDi('Venere')[0]).toEqual([22, 47, 16, 41, 10, 35, 4]);
    expect(quadratoDi('Mercurio')[0]).toEqual([8, 58, 59, 5, 4, 62, 63, 1]);
    expect(quadratoDi('Luna')[0]).toEqual([37, 78, 29, 70, 21, 62, 13, 54, 5]);
  });

  it('i ritardi di accensione non cadono mai su un numero vietato (666 compreso)', () => {
    for (const p of pianeti) for (const r of ritardiDiAccensione(p, 100)) expect(numeroAmmesso(r)).toBe(true);
    expect(ritardiDiAccensione('Saturno', 3)).toEqual([89, 178, 0]);
    // Col vecchio passo di 111 ms il sesto rango dava 666: la guardia lo deve scavalcare.
    for (const p of pianeti) expect(ritardiDiAccensione(p, 20, 111)).not.toContain(666);
  });

  it('con «riduci movimento» il respiro e le entrate si spengono del tutto, ritardo compreso', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const blocco = /@media \(prefers-reduced-motion: reduce\) \{\s*([^{}]*)\{ animation: none !important; \}\s*\}/g;
    const selettori = [...css.matchAll(blocco)].map((m) => m[1]).join(',');
    expect(selettori).toContain('.armonia-respiro');
    expect(selettori).toContain('.armonia-entra');
    expect(css).toMatch(/@media \(forced-colors: active\), \(prefers-contrast: more\) \{\s*\.armonia-trama \{ display: none !important; \}/);
  });

  it("l'ordine di accensione è una permutazione e segue il quadrato", () => {
    for (const n of [3, 9, 20]) expect([...ordineDiAccensione('Giove', n)].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    expect(ordineDiAccensione('Saturno', 3)).toEqual([1, 2, 0]);
  });

  it('il sigillo è sempre lo stesso, senza vocali né ripetizioni, e cade sulle caselle del quadrato', () => {
    const s = sigillo('Clienti felici', 'Saturno');
    expect(s.lettere).toBe('CLNTF');
    expect(sigillo('Clienti felici', 'Saturno')).toEqual(s);
    expect(s.tracciato.startsWith('M')).toBe(true);
    for (const [x, y] of s.punti) {
      expect([10, 50, 90]).toContain(x);
      expect([10, 50, 90]).toContain(y);
    }
    // Per un negozio il quadrato è Giove; niente cerchietto né barra: solo M e L.
    const g = sigillo('Piacenza compra dai suoi negozi');
    expect(g.tracciato).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)*$/);
    for (let i = 1; i < g.punti.length; i++) expect(g.punti[i]).not.toEqual(g.punti[i - 1]);
  });

  it('la rosa etrusca ha sedici raggi tutti uguali, dentro l\'anello: non può sembrare una croce celtica', () => {
    const raggi = [...rosaEtrusca(0, 0, 100).matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)]
      .map((m) => Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])));
    expect(raggi).toHaveLength(16);
    for (const l of raggi) expect(Math.abs(l - raggi[0])).toBeLessThan(0.3);
    for (const m of rosaEtrusca(0, 0, 100).matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)) expect(Math.hypot(Number(m[1]), Number(m[2]))).toBeLessThanOrEqual(100.1);
  });
});

describe('le forme e i vietati', () => {
  it('il poligono a cinque lati è un pentagono, mai una stella', () => {
    expect(poligono(0, 0, 10, 5).match(/[ML]/g)).toHaveLength(5);
  });

  it('nessun motivo richiama un simbolo vietato, e i vietati vengono riconosciuti', () => {
    for (const m of Object.keys(MOTIVI)) expect(motivoAmmesso(m)).toBe(true);
    expect(motivoAmmesso('pentagramma')).toBe(false);
    expect(motivoAmmesso('Stella di David')).toBe(false);
    expect(motivoAmmesso('croce celtica')).toBe(false);
  });

  it('la firma non sceglie mai da sola motivi che formano stelle', () => {
    expect(Object.keys(MOTIVI)).not.toContain('stelle-otto');
    for (const e of Object.keys(ELEMENTI) as Array<keyof typeof ELEMENTI>) {
      for (let n = 1; n <= 9; n++) expect(motivoPerFirma(e, n)).not.toBe('asanoha');
    }
    expect(motivoAmmesso('sayagata')).toBe(false);
    expect(motivoAmmesso('stella a otto punte')).toBe(false);
  });

  it('con un passo zero o negativo la trama finisce lo stesso', () => {
    expect(typeof trama('triangoli', 100, 100, 0)).toBe('string');
    expect(typeof trama('onde', 100, 100, -5)).toBe('string');
    expect(trama('cerchi', 0, 0)).toBe('');
  });

  it('ogni trama si disegna, senza numeri rotti', () => {
    for (const m of Object.keys(MOTIVI) as Motivo[]) {
      const d = trama(m, 610, 377, 34, 7);
      expect(d.length).toBeGreaterThan(20);
      expect(d).not.toMatch(/NaN|Infinity/);
    }
  });

  it('la spirale aurea converge dentro il rettangolo', () => {
    const s = spiraleAurea(0, 0, 987, 610, 10);
    expect(s.quadrati).toHaveLength(10);
    expect(s.occhio[0]).toBeGreaterThan(610);
    expect(s.occhio[1]).toBeGreaterThan(300);
  });
});

describe('la firma', () => {
  it('è sempre la stessa per lo stesso nome e la stessa data', () => {
    expect(firmaDi({ nome: 'Pane Quotidiano', data: '2026-11-28' })).toEqual(firmaDi({ nome: 'Pane Quotidiano', data: '2026-11-28' }));
  });

  it('dalla data prende segno, elemento e pianeta; senza data usa Mercurio', () => {
    expect(firmaDi({ nome: 'Pane Quotidiano', data: '2026-11-28' })).toMatchObject({ segno: 'Sagittario', elemento: 'fuoco', pianeta: 'Giove', giorno: 4 });
    expect(firmaDi({ nome: 'Pane Quotidiano' })).toMatchObject({ segno: null, elemento: 'aria', pianeta: 'Mercurio', giorno: 3 });
    expect(firmaDi({ nome: 'Pane Quotidiano', data: '2026-02-31' }).segno).toBeNull();
  });

  it('MyCity fa 5, e i token CSS ci sono', () => {
    expect(FIRMA_MYCITY.numero).toBe(5);
    expect(FIRMA_MYCITY.durata).toBe(555);
    expect(tokenCss(FIRMA_MYCITY)).toMatchObject({ '--armonia-durata': '555ms' });
  });

  it('un Date si legge col giorno di Piacenza, non con quello in UTC', () => {
    // 21/3/2026 alle 00:30 a Roma è ancora il 20/3 alle 23:30 in UTC.
    const f = firmaDi({ nome: 'Pane Quotidiano', data: new Date(Date.UTC(2026, 2, 20, 23, 30)) });
    expect(f.segno).toBe('Ariete');
  });
});

describe('dentro i siti', () => {
  it('la trama è muta per i lettori di schermo, non supera mai l\'8% e sta nei margini', () => {
    const html = renderToStaticMarkup(<TramaNascosta firma={FIRMA_MYCITY} opacita={0.5} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('opacity:0.08');
    expect(html).toContain('mask-image:radial-gradient(ellipse at center, transparent 38%');
    expect(html.replace(/<[^>]+>/g, '')).toBe('');
  });

  it('nel piè di pagina la trama sta dietro al testo e fuori dal contenitore che spazia le righe', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const html = renderToStaticMarkup(createElement(Footer));
    // isolate crea il livello, -z-10 manda la trama sotto al testo ma sopra lo sfondo, space-y non la tocca.
    expect(html).toMatch(/class="relative isolate overflow-hidden[^"]*"><svg[^>]*class="[^"]*-z-10[^"]*"[\s\S]*?<\/svg><div class="py-5[^"]*space-y-1/);
  });

  it('sul server la luna non disegna una fase (la pagina può restare in cache)', () => {
    const html = renderToStaticMarkup(<LunaDiOggi />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<path');
  });

  it('la bozza del sito non cambia faccia da un giorno all\'altro: nasce dal giorno d\'iscrizione', () => {
    const ieri = renderToStaticMarkup(<AnteprimaServizio id="sito_web" nome="Pane Quotidiano" tipo="bar" giorno="2026-11-21" nascita="2026-10-02" />);
    const oggi = renderToStaticMarkup(<AnteprimaServizio id="sito_web" nome="Pane Quotidiano" tipo="bar" giorno="2026-11-22" nascita="2026-10-02" />);
    expect(oggi).toBe(ieri);
  });

  it('la bozza del sito del cliente nasce dalla sua firma, con le sezioni in sezione aurea', () => {
    const html = renderToStaticMarkup(<AnteprimaServizio id="sito_web" nome="Ora del Gusto" tipo="bar" giorno="2026-12-01" nascita="2026-11-20" />);
    const f = firmaDi({ nome: 'Ora del Gusto', data: '2026-11-20' });
    expect(html).toContain(`data-armonia-numero="${f.numero}"`);
    expect(html).toContain(`--armonia-durata:${f.durata}ms`);
    expect(html).toContain('sm:grid-cols-[1.618fr_1fr]');
    expect(html).toContain(`data-armonia="${f.motivo}"`);
  });
});
