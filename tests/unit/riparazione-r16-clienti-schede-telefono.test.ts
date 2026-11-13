/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

// R16-006: sul telefono la pagina Clienti mostra una scheda per cliente (nome, spesa, ultimo ordine, targhetta)
// senza dover trascinare la tabella larga 700 px.
const globale = globalThis as Record<string, unknown>;

afterEach(() => {
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__', '__PROFILO__']) delete globale[k];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('R16-006 clienti sul telefono', () => {
  it('le schede (solo telefono) portano nome, spesa, ultimo ordine e VIP; la tabella resta solo da md in su', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    const pagina = (await monta('app/seller/customers/page.tsx')).default;
    globale.__CLIENT_SUPABASE__ = {};
    globale.__UTENTE__ = { id: 'n1' };
    globale.__ESITO_QUERY__ = () => undefined;
    globale.__DATI_QUERY__ = () => ({
      ordiniLetti: 6,
      clienti: [
        { userId: 'u1', fullName: 'Cliente Uno', totalSpent: 105, ordersCount: 5, lastOrderAt: '2026-11-10T10:00:00Z', lastOrderId: 'a', firstOrderAt: '2026-09-01T10:00:00Z' },
        { userId: 'u3', fullName: 'Cliente Tre', totalSpent: 45, ordersCount: 1, lastOrderAt: '2026-09-29T10:00:00Z', lastOrderId: 'b', firstOrderAt: '2026-09-29T10:00:00Z' },
      ],
    });
    const s = accendi(pagina, {});
    await attendi();
    const schede = s.radice.querySelector('[data-testid="clienti-schede"]') as HTMLElement | null;
    expect(schede, 'manca la vista a schede').toBeTruthy();
    expect(schede!.className).toContain('md:hidden');
    const t = schede!.textContent ?? '';
    expect(t).toContain('Cliente Uno');
    expect(t).toMatch(/105/);
    expect(t).toContain('Ultimo ordine');
    expect(t).toContain('VIP');
    expect(t).toContain('Inattivo');
    const tabella = s.radice.querySelector('table') as HTMLElement;
    expect(tabella.className).toContain('hidden');
    expect(tabella.className).toContain('md:table');
    s.smonta();
  }, 30000);

  it('R16-006 tocchi: filtri, ricerca e link alti 44 px sul telefono, e spazio in fondo per il pulsante assistenza', async () => {
    const pagina = (await monta('app/seller/customers/page.tsx')).default;
    globale.__CLIENT_SUPABASE__ = {};
    globale.__UTENTE__ = { id: 'n1' };
    globale.__ESITO_QUERY__ = () => undefined;
    globale.__DATI_QUERY__ = () => ({
      ordiniLetti: 1,
      clienti: [{ userId: 'u1', fullName: 'Cliente Uno', totalSpent: 10, ordersCount: 1, lastOrderAt: '2026-11-10T10:00:00Z', lastOrderId: 'a', firstOrderAt: '2026-11-10T10:00:00Z' }],
    });
    const s = accendi(pagina, {});
    await attendi();
    const filtri = Array.from(s.radice.querySelectorAll('button[aria-pressed]')) as HTMLElement[];
    expect(filtri.length).toBeGreaterThan(0);
    for (const b of filtri) expect(b.className, 'filtro basso').toContain('min-h-11');
    const ricerca = s.radice.querySelector('input[type="search"]') as HTMLElement;
    expect(ricerca.className, 'ricerca bassa').toContain('min-h-11');
    const link = s.radice.querySelector('a[href="/terms#venditori"]') as HTMLElement;
    expect(link.textContent).toBe('Punto 9 delle condizioni');
    expect(link.className, 'link basso').toContain('min-h-11');
    expect(link.className).toContain('inline-flex');
    const contenitore = s.radice.querySelector('div.space-y-6') as HTMLElement;
    expect(contenitore.className, 'niente spazio in fondo').toMatch(/pb-24/);
    s.smonta();
  }, 30000);
});
