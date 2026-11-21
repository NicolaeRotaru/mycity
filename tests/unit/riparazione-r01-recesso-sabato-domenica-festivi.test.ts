/**
 * R01-021 — La scadenza del recesso si sposta quando l'ultimo giorno cade di sabato, di domenica o
 * in un giorno festivo: il termine finisce col primo giorno lavorativo dopo (regolamento CEE
 * 1182/71, richiamato dalla direttiva 2011/83 da cui viene il Codice del Consumo). Prima il reso si
 * chiudeva la domenica sera, e il lunedì il cliente lo trovava scaduto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { recessoAperto, ultimoGiornoDelRecesso } from '@/lib/ordini/termine-del-recesso';

afterEach(() => { vi.useRealTimers(); });

describe('l\'ultimo giorno del recesso non cade di sabato, di domenica o in un festivo', () => {
  it('il quattordicesimo giorno è sabato: si chiude il lunedì', () => {
    // Consegna sabato 7/11/2026: il 21/11 è sabato.
    expect(ultimoGiornoDelRecesso('2026-11-07T10:00:00Z')).toBe('2026-11-23');
  });

  it('il quattordicesimo giorno è domenica: si chiude il lunedì', () => {
    // Consegna domenica 1/3/2026: il 15/3 è domenica.
    expect(ultimoGiornoDelRecesso('2026-03-01T09:00:00Z')).toBe('2026-03-16');
  });

  it('Natale di venerdì, Santo Stefano di sabato, poi la domenica: si chiude lunedì 28/12', () => {
    expect(ultimoGiornoDelRecesso('2026-12-11T10:00:00Z')).toBe('2026-12-28');
  });

  it('festa della Repubblica di martedì: si chiude mercoledì 3/6', () => {
    expect(ultimoGiornoDelRecesso('2026-05-19T10:00:00Z')).toBe('2026-06-03');
  });

  it('lunedì dell\'Angelo (Pasqua 2027 il 28/3): si chiude martedì 30/3', () => {
    expect(ultimoGiornoDelRecesso('2027-03-15T10:00:00Z')).toBe('2027-03-30');
  });

  it('controprova: un giorno feriale qualunque resta quello', () => {
    expect(ultimoGiornoDelRecesso('2026-10-20T08:00:00Z')).toBe('2026-11-03');
    expect(ultimoGiornoDelRecesso('2026-11-05T10:00:00Z')).toBe('2026-11-19');
  });

  it('il lunedì dopo la domenica il reso si chiede ancora, il martedì no (orologio di Piacenza)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T20:00:00Z'));
    expect(recessoAperto('2026-03-01T09:00:00Z'), 'lunedì 16/3 alle 21: il reso doveva essere ancora aperto').toBe(true);
    vi.setSystemTime(new Date('2026-03-16T23:30:00Z'));
    expect(recessoAperto('2026-03-01T09:00:00Z'), 'martedì 17/3 alle 00:30 il reso è chiuso').toBe(false);
  });
});
