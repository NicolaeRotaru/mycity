/**
 * 30/10/2026 (ondata 23) — IL NEGOZIO ACCETTA ENTRO L'ULTIMO RITIRO POSSIBILE, NON ENTRO LA FINE DELLA FASCIA.
 *
 * Il difetto, nato con la regola del ritiro dell'ondata 22: lunedì alle 12:00 Maria ordina da Pane
 * Quotidiano per «Oggi · 13:00–16:30». Il forno chiude alle 13:00 e riapre alle 16:30: la spesa si
 * ritira prima delle 13. Ma il forno leggeva «accettalo entro le 16:30», e se accettava alle 14
 * nessuno poteva più ritirarla. Lo stesso alle 12:45 quando il freno della veloce sposta la spesa
 * sulla 13:00–16:30, e la sera con la 19:30–21:00 (il forno chiude alle 19:30).
 *
 * La regola (scelta di Nicola): l'ora che legge il negozio è l'ultimo momento in cui la merce si può
 * ancora ritirare per quella fascia, dalla stessa regola delle rotte (lib/store-hours.ts), col quarto
 * d'ora di negozio aperto. Se il negozio è aperto fino alla fine della fascia, l'ora resta quella di
 * oggi. E la fascia si legge dalla casa unica (lib/quando-arriva.ts), non da un parser suo.
 *
 * Pane Quotidiano: lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio e domenica chiuso.
 * Settimana di lunedì 2/11/2026: ora solare, Roma = UTC+1.
 */
import { describe, it, expect } from 'vitest';
import { fasceAncoraPossibili, fasceDiDomaniPossibili } from '@/lib/quando-arriva';
import { fasciaDopoLaVeloce } from '@/lib/ordini/veloce-non-confermata';
import { fineDellaFascia, rigaScadenzaPerIlNegozio } from '@/lib/ordini/scadenza-accettazione';

type Orari = Partial<Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', [string, string][]>>;
const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
const PQ: Orari = { mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA };

/** L'istante vero (UTC) di un'ora di Roma, `giorni` dopo lunedì 2/11/2026. */
const roma = (h: number, m = 0, giorni = 0) => new Date(Date.UTC(2026, 10, 2 + giorni, h - 1, m));
/** La stessa ora come orologio da parete, come la leggono la cassa e il freno. */
const parete = (h: number, m = 0, giorni = 0) => new Date(2026, 10, 2 + giorni, h, m);

const riga = (nato: Date, fascia: string, adesso: Date = nato, orari: unknown = PQ) =>
  rigaScadenzaPerIlNegozio({ created_at: nato.toISOString(), delivery_slot: fascia }, adesso, orari);

describe('entro quando accettare: l’ultimo ritiro possibile per la fascia', () => {
  it('caso 1 — lunedì 12:00, «Oggi · 13:00–16:30»: entro le 12:45, non le 16:30', () => {
    expect(riga(roma(12), 'Oggi · 13:00–16:30')).toBe('Accettalo o rifiutalo entro le 12:45 di oggi.');
    // Alle 14 il forno è chiuso fino a fascia finita: non può più leggere «entro le 16:30».
    const alle14 = riga(roma(12), 'Oggi · 13:00–16:30', roma(14));
    expect(alle14).not.toMatch(/entro le 16:30/);
    // Ondata 24: alle 14 il ritiro non è più possibile e la riga lo dice (l'ordine si annulla).
    expect(alle14).toMatch(/^Il ritiro per questa fascia non è più possibile/);
  });

  it('caso 2 — lunedì 12:45 il freno della veloce sposta sulla 13:00–16:30: la scadenza è prima delle 13 e non è già passata', () => {
    expect(fasciaDopoLaVeloce(parete(12, 45), [PQ])).toBe('Oggi · 13:00–16:30');
    // L'ordine è nato alle 12:35 come veloce; alle 12:45 il freno gli scrive la fascia nuova.
    expect(riga(roma(12, 35), 'Oggi · 13:00–16:30', roma(12, 45))).toBe('Accettalo o rifiutalo entro le 12:45 di oggi.');
  });

  it('caso 3 — lunedì 14:00, «Oggi · 19:30–21:00»: entro le 19:15, non le 21:00', () => {
    expect(riga(roma(14), 'Oggi · 19:30–21:00')).toBe('Accettalo o rifiutalo entro le 19:15 di oggi.');
  });

  // Ondata 24 (scelta dell'AD, coi 60 minuti): anche col forno aperto per tutta la fascia la scadenza
  // è l'ultimo ritiro, la fine della fascia meno 60 minuti. Senza orari resta la fine della fascia.
  it('caso 4 — lunedì 9:30, «Oggi · 9:00–11:00»: entro le 10:00, l’ultimo ritiro anche col forno aperto in tutta la fascia', () => {
    expect(riga(roma(9, 30), 'Oggi · 9:00–11:00')).toBe('Accettalo o rifiutalo entro le 10:00 di oggi.');
    expect(riga(roma(9, 30), 'Oggi · 9:00–11:00', roma(9, 30), null)).toBe('Accettalo o rifiutalo entro le 11:00 di oggi.');
  });

  it('caso 5 — lunedì 18:00, «Domani · 13:00–16:30»: entro le 12:45 di martedì', () => {
    expect(riga(roma(18), 'Domani · 13:00–16:30')).toBe('Accettalo o rifiutalo entro le 12:45 di domani.');
  });

  // Ogni cinque minuti, tutta la settimana: orari del forno e fasce stanno sui quarti d'ora, quindi ogni bordo
  // (le 12:45 ultimo minuto buono per la 13:00–16:30, le 12:50 primo no) cade sulla griglia. Al minuto pieno la prova
  // durava 56 secondi: il costo e' l'orologio di Roma letto a ogni riga, non la regola.
  it('caso 6 — una settimana, minuto per minuto ogni cinque: per ogni fascia proposta la scadenza cade a negozio aperto e non dopo l’ultimo ritiro', () => {
    const CHIAVI = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
    const min = (hhmm: string) => Number(hhmm.split(':')[0]) * 60 + Number(hhmm.split(':')[1]);
    // Il negozio minuto per minuto, giorno per giorno (0 = lunedì 2/11 … 7 = lunedì 9/11).
    const aperto = Array.from({ length: 8 }, (_, g) => {
      const giorno = new Array<boolean>(1440).fill(false);
      for (const [o, c] of PQ[CHIAVI[(1 + g) % 7]] ?? []) for (let m = min(o); m < min(c); m++) giorno[m] = true;
      return giorno;
    });
    const fasciaInMinuti = (f: string) => {
      const [, da, a] = f.match(/(\d{1,2}:\d{2})–(\d{1,2}:\d{2})$/) ?? [];
      return { da: min(da), a: min(a) };
    };
    let controllate = 0;
    const errori: string[] = [];
    const verifica = (ok: boolean, perche: string) => { if (!ok && errori.length < 20) errori.push(perche); };
    for (let g = 0; g < 7; g++) {
      for (let t = 0; t < 1440; t += 5) {
        const h = Math.floor(t / 60);
        const m = t % 60;
        const proposte = [...fasceAncoraPossibili(parete(h, m, g), [PQ]), ...fasceDiDomaniPossibili(parete(h, m, g), [PQ])];
        for (const f of proposte) {
          const domani = f.startsWith('Domani');
          const giorno = domani ? g + 1 : g;
          const { a } = fasciaInMinuti(f);
          // L'oracolo, a forza bruta: l'ultimo minuto fra la nascita (domani: la mezzanotte) e 60
          // minuti prima della fine in cui il forno è aperto per un quarto d'ora di fila.
          let ultimoRitiro = -1;
          for (let r = a - 60; r >= (domani ? 0 : t) && ultimoRitiro < 0; r--) {
            if (aperto[giorno].slice(r, r + 15).every(Boolean)) ultimoRitiro = r;
          }
          verifica(ultimoRitiro >= 0, `${f} alle ${h}:${m} del giorno ${g}: la cassa la propone, ma nessun ritiro`);
          if (ultimoRitiro < 0) continue;

          const testo = riga(roma(h, m, g), f) ?? '';
          const letto = testo.match(/^Accettalo o rifiutalo entro le (\d{1,2}):(\d{2}) di (oggi|domani)\.$/);
          verifica(letto !== null, `${f} alle ${h}:${m} del giorno ${g}: «${testo}»`);
          if (!letto) continue;
          const [, hh, mm, quale] = letto;
          verifica(quale === (domani ? 'domani' : 'oggi'), `${f} alle ${h}:${m} del giorno ${g}: «${testo}» — giorno sbagliato`);
          const scadenza = Number(hh) * 60 + Number(mm);
          // «entro le 12:45» vale tutto il minuto delle 12:45 (ondata 24: sempre l'ultimo ritiro).
          const ultimoMinutoUtile = scadenza;
          const dove = `${f} alle ${h}:${m} del giorno ${g}: «${testo}»`;
          verifica(aperto[giorno][ultimoMinutoUtile] === true, `${dove} — il negozio è chiuso alla scadenza`);
          verifica(scadenza <= a, `${dove} — oltre la fine della fascia`);
          verifica(scadenza === ultimoRitiro, `${dove} — non è l’ultimo ritiro possibile`);
          controllate++;
        }
      }
    }
    expect(errori).toEqual([]);
    expect(controllate).toBeGreaterThan(1000);
  }, 60_000);
});

describe('la fascia si legge dalla casa unica di lib/quando-arriva.ts', () => {
  it('un’etichetta che la cassa non propone non sposta la scadenza: vale la regola delle tre ore', () => {
    const nato = roma(18);
    expect(fineDellaFascia({ created_at: nato.toISOString(), delivery_slot: 'Domani · 10:00–14:00' })).toBeNull();
    expect(fineDellaFascia({ created_at: nato.toISOString(), delivery_slot: 'Domani' })).toBeNull();
    expect(riga(nato, 'Domani · 10:00–14:00', nato, undefined)).toBe('Accettalo o rifiutalo entro le 21:00 di oggi.');
  });

  it('le fasce vere, anche quelle di prima, finiscono dove dice la casa unica', () => {
    const nato = roma(6);
    expect(fineDellaFascia({ created_at: nato.toISOString(), delivery_slot: 'Oggi · 13:00–16:30' })?.toISOString()).toBe(roma(16, 30).toISOString());
    expect(fineDellaFascia({ created_at: nato.toISOString(), delivery_slot: 'Domani · 9:00–12:00' })?.toISOString()).toBe(roma(12, 0, 1).toISOString());
    expect(fineDellaFascia({ created_at: nato.toISOString(), delivery_slot: 'Stasera · 18:00–20:00' })?.toISOString()).toBe(roma(20).toISOString());
  });
});
