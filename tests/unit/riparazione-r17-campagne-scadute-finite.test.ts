import { describe, it, expect, afterEach, vi } from 'vitest';
import { statoEffettivoDellaCampagna, condizioneDelFiltro } from '@/lib/admin/vista-delle-campagne';

/** R17-008 — una campagna oltre la data di fine si mostra e si filtra come «finita». */
afterEach(() => vi.useRealTimers());

describe('R17-008 — campagne scadute', () => {
  it('active con fine passata (giorno di Piacenza) e\' finita', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
    expect(statoEffettivoDellaCampagna({ status: 'active', end_date: '2026-11-23' })).toBe('ended');
  });
  it('il giorno di fine e\' ancora attiva; la pausa resta pausa', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T21:00:00Z'));
    expect(statoEffettivoDellaCampagna({ status: 'active', end_date: '2026-11-23' })).toBe('active');
    expect(statoEffettivoDellaCampagna({ status: 'paused', end_date: '2026-11-01' })).toBe('paused');
  });
  it('a mezzanotte di Piacenza scatta il giorno dopo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T23:30:00Z'));
    expect(statoEffettivoDellaCampagna({ status: 'active', end_date: '2026-11-23' })).toBe('ended');
  });
  it('il filtro «finite» prende anche le active scadute, «attive» le esclude', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
    expect(condizioneDelFiltro('ended').oppure).toContain('and(status.eq.active,end_date.lt.2026-12-01)');
    expect(condizioneDelFiltro('active')).toEqual({ status: 'active', fineDaOggi: '2026-12-01' });
    expect(condizioneDelFiltro('all')).toEqual({});
  });
});
