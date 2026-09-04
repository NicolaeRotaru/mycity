/**
 * 3/9/2026 — «ARRIVA TRA ~4 MIN», CALCOLATO SU UN PUNTINO FERMO DA MEZZ'ORA.
 *
 * Sul web la posizione del fattorino si aggiorna solo mentre lo schermo è acceso e la pagina è
 * davanti: appena il telefono va in tasca, gli aggiornamenti si fermano. Le ultime coordinate
 * restano lì, e il conto le prendeva per fresche.
 *
 * La scena vera, quella della radiografia: il fattorino parte dal negozio alle 14:00 col telefono in
 * tasca. Alle 14:25 il cliente apre l'ordine e legge «~4 min». Non è un'imprecisione: è una bugia
 * detta al minuto, e chi la legge chiama il negozio.
 *
 * Qui si prova la regola, non il disegno: **il numero esce solo da un dato fresco**. Le stesse
 * identiche coordinate danno un numero se sono di un minuto fa e non danno niente se sono di
 * mezz'ora fa — l'unica cosa che cambia fra i due casi è l'orario.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  statoPosizioneRider,
  stimaArrivoMinuti,
  daQuantoTempo,
  minutiDa,
  POSIZIONE_FRESCA_MIN,
  POSIZIONE_SCADUTA_MIN,
} from '@/lib/ordini/posizione-rider';

/** Il negozio in centro a Piacenza e una casa a un chilometro e mezzo. */
const NEGOZIO = { lat: 45.0526, lng: 9.6929 };
const CASA = { lat: 45.0655, lng: 9.6995 };

const ORE_14_25 = new Date('2026-09-03T14:25:00+02:00').getTime();
const quandoIl = (hhmm: string) => `2026-09-03T${hhmm}:00+02:00`;

describe('il fattorino parte alle 14:00 col telefono in tasca, il cliente guarda alle 14:25', () => {
  const posizioneFerma = { ...NEGOZIO, aggiornataIl: quandoIl('14:00') };

  it('non esce nessun tempo di arrivo: il numero sarebbe inventato', () => {
    const stima = stimaArrivoMinuti(posizioneFerma, CASA, { inViaggio: true, adesso: ORE_14_25 });
    expect(stima, 'con una posizione di 25 minuti fa non si promette nessun minuto').toBeNull();
  });

  it('al posto del numero il cliente legge da quanto la posizione è ferma', () => {
    const stato = statoPosizioneRider(posizioneFerma, ORE_14_25);
    expect(stato.minuti).toBe(25);
    expect(stato.fresca).toBe(false);
    expect(stato.testo).toBe('Ultima posizione 25 minuti fa');
  });

  it('le stesse coordinate, ma di un minuto fa, danno un tempo di arrivo', () => {
    const appenaMandata = { ...NEGOZIO, aggiornataIl: quandoIl('14:24') };
    const stima = stimaArrivoMinuti(appenaMandata, CASA, { inViaggio: true, adesso: ORE_14_25 });
    expect(stima, "l'unica differenza è l'orario: qui il numero ci deve essere").toBeGreaterThan(0);
    expect(statoPosizioneRider(appenaMandata, ORE_14_25).testo).toBe('Posizione aggiornata 1 minuto fa');
  });
});

describe('quando il puntino sulla mappa smette di essere una posizione', () => {
  it('fino a mezz\'ora si vede ancora, dopo no', () => {
    const dopo = (minuti: number) => statoPosizioneRider(
      { ...NEGOZIO, aggiornataIl: new Date(ORE_14_25 - minuti * 60_000).toISOString() },
      ORE_14_25,
    );
    expect(dopo(POSIZIONE_SCADUTA_MIN).mostraPin).toBe(true);
    expect(dopo(POSIZIONE_SCADUTA_MIN + 1).mostraPin, 'un puntino di mezz\'ora fa si legge come «è qui adesso»').toBe(false);
  });

  it('il confine della freschezza è quello dichiarato, non uno a caso', () => {
    const dopo = (minuti: number) => statoPosizioneRider(
      { ...NEGOZIO, aggiornataIl: new Date(ORE_14_25 - minuti * 60_000).toISOString() },
      ORE_14_25,
    );
    expect(dopo(POSIZIONE_FRESCA_MIN).fresca).toBe(true);
    expect(dopo(POSIZIONE_FRESCA_MIN + 1).fresca).toBe(false);
  });
});

describe('i casi in cui non sappiamo niente', () => {
  it('senza coordinate non si mostra né puntino né tempo', () => {
    const stato = statoPosizioneRider({ lat: null, lng: null, aggiornataIl: quandoIl('14:24') }, ORE_14_25);
    expect(stato).toEqual({ minuti: null, fresca: false, mostraPin: false, testo: null });
    expect(stimaArrivoMinuti({ lat: null, lng: null, aggiornataIl: quandoIl('14:24') }, CASA, { inViaggio: true, adesso: ORE_14_25 })).toBeNull();
  });

  it('coordinate senza orario: nessun tempo, e lo dice', () => {
    const senzaOrario = { ...NEGOZIO, aggiornataIl: null };
    expect(stimaArrivoMinuti(senzaOrario, CASA, { inViaggio: true, adesso: ORE_14_25 })).toBeNull();
    expect(statoPosizioneRider(senzaOrario, ORE_14_25).testo).toBe('Posizione non aggiornata');
  });

  it('senza l\'indirizzo di consegna non si stima niente', () => {
    const fresca = { ...NEGOZIO, aggiornataIl: quandoIl('14:24') };
    expect(stimaArrivoMinuti(fresca, { lat: null, lng: null }, { inViaggio: true, adesso: ORE_14_25 })).toBeNull();
  });

  it('se il fattorino non è ancora in viaggio non si stima niente', () => {
    const fresca = { ...NEGOZIO, aggiornataIl: quandoIl('14:24') };
    expect(stimaArrivoMinuti(fresca, CASA, { inViaggio: false, adesso: ORE_14_25 })).toBeNull();
  });

  it('un orologio avanti di qualche secondo non diventa «nel futuro»', () => {
    expect(minutiDa(quandoIl('14:26'), ORE_14_25)).toBe(0);
  });
});

describe('come si dice l\'età al cliente', () => {
  it('parole di tutti i giorni, senza orari da confrontare a mente', () => {
    expect(daQuantoTempo(0)).toBe('adesso');
    expect(daQuantoTempo(1)).toBe('1 minuto fa');
    expect(daQuantoTempo(25)).toBe('25 minuti fa');
    expect(daQuantoTempo(75)).toBe("più di un'ora fa");
    expect(daQuantoTempo(200)).toBe('più di 3 ore fa');
  });
});

describe('la pagina dell\'ordine non rifà il conto per conto suo', () => {
  const pagina = readFileSync('app/orders/[id]/page.tsx', 'utf8');

  it('chiede il tempo di arrivo alla funzione che guarda anche l\'orario', () => {
    expect(pagina).toContain('stimaArrivoMinuti(');
    expect(
      /deliveryEtaMinutes|haversineKm/.test(pagina),
      'la pagina rifà il conto da sola: così il controllo sulla freschezza si può saltare',
    ).toBe(false);
  });

  it('accanto alla mappa non c\'è più un orario secco, ma da quanto è ferma', () => {
    expect(
      /rider_position_updated_at\)\.toLocaleTimeString/.test(pagina),
      '«agg. 14:00» è un orario che chi legge alle 14:25 non confronta con l\'orologio',
    ).toBe(false);
    expect(pagina).toContain('posizioneRider.testo');
  });

  it('il puntino del fattorino si disegna solo finché ha senso', () => {
    expect(pagina).toContain('posizioneRider.mostraPin');
  });
});
