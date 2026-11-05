import { describe, expect, it, vi } from 'vitest';

// La base della consegna a zero, gli euro in più accesi: 8 € di pane pagano 1 € in cassa.
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), PLATFORM_DELIVERY_FEE_CENTS: 0 }));

import { promessaSpedizione, riquadroTariffaConsegna, rispostaCostoSpedizione } from '@/lib/promesse-pubbliche';

describe('S07 · con la base a zero nessuna frase dice «gratuita» né «0,00 €»', () => {
  it('la scheda prodotto e la card non dicono «Consegna gratuita» (la cassa fa pagare 1 € su 8 €)', () => {
    const p = promessaSpedizione();
    expect(p.breve).not.toMatch(/gratuita/i);
    expect(p.titolo).not.toMatch(/gratuita/i);
    expect(p.dettaglioConsegna).not.toBeNull();
  });
  it('la FAQ non scrive «0,00 € all’ora che scegli»', () => {
    const a = rispostaCostoSpedizione().a;
    expect(a).not.toMatch(/(^|[^\d])0,00/);
    expect(a).toContain('1,00');
  });
  it('il riquadro di Spedizioni non scrive «Consegna da 0,00 €»', () => {
    const r = riquadroTariffaConsegna();
    expect(r.siPaga).toBe(true);
    expect(r.titolo).not.toMatch(/(^|[^\d])0,00/);
  });
  it('la frase della tariffa non comincia con «0,00 € una volta sola»', () => {
    expect(promessaSpedizione().dettaglioConsegna).not.toMatch(/(^|[^\d])0,00 €/);
  });
});

describe('S07 · a negozio chiuso la frase pubblica dice la regola della cassa', async () => {
  const { NEGOZIO_CHIUSO_COSA_SUCCEDE, QUANDO_ARRIVA_SENZA_NEGOZIO, rispostaTempiDiConsegna } = await import('@/lib/promesse-pubbliche');
  const { fasceDiDomaniPossibili, fasceAncoraPossibili } = await import('@/lib/quando-arriva');
  const lunSab = [['07:00', '13:00']];
  const forno = { mon: lunSab, tue: lunSab, wed: lunSab, thu: lunSab, fri: lunSab, sat: lunSab, sun: [] };
  it('sabato 31/10 alle 21:30, forno chiuso la domenica: nessuna fascia di domani, e la frase non promette «domani»', () => {
    expect(fasceDiDomaniPossibili(new Date(2026, 9, 31, 21, 30), [forno])).toEqual([]);
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).not.toMatch(/puoi prenotare per domani/);
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).toMatch(/solo quelle in cui il negozio fa in tempo/);
  });
  it('lunedì alle 14 col forno 9-13 e 16:30-19:30 chiuso: si prenota ancora per oggi, e la frase lo dice', () => {
    const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
    expect(fasceAncoraPossibili(new Date(2026, 10, 2, 14, 0), [{ mon: giorno }]).length).toBeGreaterThan(0);
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).toMatch(/oggi o di domani/);
  });
  it('senza un negozio davanti non promette «negli orari di apertura»', () => {
    expect(QUANDO_ARRIVA_SENZA_NEGOZIO).not.toMatch(/orari di apertura/);
  });
  it('la FAQ dice il confine in km, non «nei comuni serviti»', () => {
    expect(rispostaTempiDiConsegna().a).not.toMatch(/comuni serviti/);
    expect(rispostaTempiDiConsegna().a).toMatch(/km dal negozio/);
  });
});

describe('S07 · la frase di come arriva la spesa', async () => {
  const { fraseComeArriva } = await import('@/lib/promesse-pubbliche');
  it('dice che l\'ora la sceglie il cliente', () => {
    expect(fraseComeArriva(false)).toMatch(/che scegli/);
    expect(fraseComeArriva(true)).toMatch(/che scegli/);
  });
  it('la descrizione Google degli alimentari sta nei 160 caratteri', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/category/[slug]/layout.tsx', 'utf8');
    const prefisso = src.match(/alimentari: `([^$]*)\$\{fraseComeArriva\(\)\}`/)?.[1] ?? '';
    expect(prefisso.length).toBeGreaterThan(0);
    expect((prefisso + fraseComeArriva()).length).toBeLessThanOrEqual(160);
  });
});

describe('S07 · il reso nomina tutte e due le esclusioni decise', async () => {
  const { FRASE_RESO, SPIEGAZIONE_RESO, RESO_ESCLUSI } = await import('@/lib/promesse-pubbliche');
  it('freschi e prodotti su ordinazione, nella frase breve e in quella lunga', () => {
    for (const f of [FRASE_RESO, SPIEGAZIONE_RESO, RESO_ESCLUSI]) {
      expect(f).toMatch(/fresch/);
      expect(f).toMatch(/su ordinazione/);
    }
  });
});

describe('S07 · la FAQ sul costo non manda a una sezione che col carrello vuoto non c’è', async () => {
  const { rispostaCostoSpedizione } = await import('@/lib/promesse-pubbliche');
  it('dice che gli esempi compaiono quando il carrello ha qualcosa', () => {
    expect(rispostaCostoSpedizione().a).toMatch(/Quando hai messo qualcosa nel carrello/);
  });
});
