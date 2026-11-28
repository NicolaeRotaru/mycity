/**
 * ARMONIA NASCOSTA (Nicola, 28/11/2026) — proporzioni, numeri, cielo, forme e magia dentro ogni sito.
 * Queste prove dicono che i calcoli sono quelli della tradizione, che i vietati non escono mai,
 * e che dentro la bozza del sito e nel piè di pagina la trama è muta e non copre il testo.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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
    for (const n of [14, 17, 18, 88, 666, 1488]) expect(numeroAmmesso(n)).toBe(false);
    expect(numeroAmmesso(333)).toBe(true);
    expect(ammessoVicino(17)).toBe(19);
  });

  it('nessuna durata di nessuna firma cade su un numero vietato', () => {
    for (let numero = 1; numero <= 9; numero++) {
      for (const e of Object.values(ELEMENTI)) expect(numeroAmmesso(ammessoVicino(numero * 111 * e.fattoreTempo))).toBe(true);
    }
  });
});

describe('il cielo', () => {
  it('trova il segno ai confini', () => {
    expect(segnoDi(giorno('2026-03-20'))).toBe('Pesci');
    expect(segnoDi(giorno('2026-03-21'))).toBe('Ariete');
    expect(segnoDi(giorno('2026-01-19'))).toBe('Capricorno');
    expect(segnoDi(giorno('2026-01-20'))).toBe('Acquario');
    expect(segnoDi(giorno('2026-12-22'))).toBe('Capricorno');
    expect(segnoDi(giorno('2026-11-28'))).toBe('Sagittario');
  });

  it("dà l'elemento cinese dell'anno, che comincia il 4 febbraio", () => {
    expect(elementoCinese(giorno('2026-11-28'))).toBe('fuoco');
    expect(elementoCinese(giorno('2026-02-03'))).toBe('legno');
  });

  it('la luna è nuova durante un\'eclissi di sole e piena durante un\'eclissi di luna', () => {
    const nuova = faseLuna(Date.UTC(2024, 3, 8, 18, 21)); // eclissi totale di sole, 8 aprile 2024
    expect(Math.min(nuova, 1 - nuova)).toBeLessThan(0.03);
    expect(Math.abs(faseLuna(Date.UTC(2024, 8, 18, 2, 34)) - 0.5)).toBeLessThan(0.03); // eclissi di luna, 18 settembre 2024
  });
});

describe('la magia', () => {
  const pianeti: Pianeta[] = ['Sole', 'Luna', 'Mercurio', 'Venere', 'Marte', 'Giove', 'Saturno'];

  it('ogni quadrato dei pianeti è magico, e il 6×6 del Sole (666) non si usa', () => {
    for (const p of pianeti) expect(eMagico(quadratoDi(p))).toBe(true);
    expect(pianeti.some((p) => quadratoDi(p).length === 6)).toBe(false);
    expect(quadratoDi('Saturno')).toEqual([[4, 9, 2], [3, 5, 7], [8, 1, 6]]);
  });

  it("l'ordine di accensione è una permutazione e segue il quadrato", () => {
    for (const n of [3, 9, 20]) expect([...ordineDiAccensione('Giove', n)].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    expect(ordineDiAccensione('Saturno', 3)).toEqual([1, 2, 0]);
  });

  it('il sigillo è sempre lo stesso, senza vocali né ripetizioni, e cade sulle caselle del quadrato', () => {
    const s = sigillo('Clienti felici');
    expect(s.lettere).toBe('CLNTF');
    expect(sigillo('Clienti felici')).toEqual(s);
    expect(s.tracciato.startsWith('M')).toBe(true);
    for (const [x, y] of s.punti) {
      expect([10, 50, 90]).toContain(x);
      expect([10, 50, 90]).toContain(y);
    }
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
    expect(tokenCss(FIRMA_MYCITY)).toMatchObject({ '--armonia-durata': `${FIRMA_MYCITY.durata}ms` });
  });
});

describe('dentro i siti', () => {
  it('la trama è muta per i lettori di schermo e non supera mai l\'8% di opacità', () => {
    const html = renderToStaticMarkup(<TramaNascosta firma={FIRMA_MYCITY} opacita={0.5} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('opacity:0.08');
    expect(html.replace(/<[^>]+>/g, '')).toBe('');
  });

  it('sul server la luna non disegna una fase (la pagina può restare in cache)', () => {
    const html = renderToStaticMarkup(<LunaDiOggi />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<path');
  });

  it('la bozza del sito del cliente nasce dalla sua firma, con le sezioni in sezione aurea', () => {
    const html = renderToStaticMarkup(<AnteprimaServizio id="sito_web" nome="Ora del Gusto" tipo="bar" giorno="2026-12-01" />);
    const f = firmaDi({ nome: 'Ora del Gusto', data: '2026-12-01' });
    expect(html).toContain(`data-armonia-numero="${f.numero}"`);
    expect(html).toContain(`--armonia-durata:${f.durata}ms`);
    expect(html).toContain('sm:grid-cols-[1.618fr_1fr]');
    expect(html).toContain(`data-armonia="${f.motivo}"`);
  });
});
