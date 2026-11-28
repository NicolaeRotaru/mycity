/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R03-021 — Dentro il pannello dell'amministratore c'è la campanella.
 *
 * Su /admin la barra del sito è spenta e il pannello monta solo AdminSidebar e
 * AdminMobileTopbar: nessuna voce portava alle notifiche, dove `notifyAdmins` scrive gli avvisi
 * sui soldi da sistemare a mano. Qui si montano i due pezzi veri con 3 notifiche non lette.
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__DATI_QUERY__', '__PROFILO__', '__UTENTE__', '__PERCORSO_FINTO__']) globali[k] = undefined;
});

function preparaNicola() {
  globali.__UTENTE__ = { id: 'admin-1', email: 'nicola@test.it' };
  globali.__PROFILO__ = { isAuthenticated: true, isAdmin: true, profile: { id: 'admin-1', full_name: 'Nicola', role: 'admin' } };
  globali.__PERCORSO_FINTO__ = '/admin/orders';
  globali.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const k = JSON.stringify(o.queryKey);
    // 28/11/2026 — La tendina della barra in alto legge l'elenco delle ultime: qui è vuoto.
    if (k.includes('notifications') && k.includes('list')) return [];
    if (k.includes('notifications')) return 3;
    if (k.includes('utente') || k.includes('auth')) return { userId: 'admin-1', id: 'admin-1' };
    return undefined;
  };
}

const campanelle = () =>
  Array.from(document.querySelectorAll('a')).filter((a) => a.getAttribute('href') === '/notifications');

describe('R03-021 — la campanella dentro il pannello', () => {
  it('la barra laterale porta alle notifiche', async () => {
    preparaNicola();
    const mod = await monta('components/admin/AdminSidebar.tsx');
    const s = accendi(mod.default as never, {});
    await attendi();
    expect(campanelle().length, 'nessuna voce del pannello porta alle notifiche').toBeGreaterThan(0);
    s.smonta();
  }, 60000);

  // 28/11/2026 — La barra in alto è quella bianca del negozio (Nicola): la campanella apre la tendina
  // delle ultime notifiche, e da lì «Vedi tutte nel Centro notifiche» porta alla pagina.
  it('la barra in alto dice quante sono da leggere e porta alle notifiche', async () => {
    preparaNicola();
    const mod = await monta('components/admin/AdminSidebar.tsx');
    const s = accendi(mod.AdminMobileTopbar as never, {});
    await attendi();
    const bottone = document.querySelector('header button[aria-controls="pannello-notifiche-admin"]') as HTMLButtonElement | null;
    expect(bottone, 'nella barra in alto la campanella non c è').toBeTruthy();
    expect(bottone!.getAttribute('aria-label') ?? '').toMatch(/Notifiche: 3 da leggere/);
    expect(bottone!.closest('header')?.className ?? '', 'la barra in alto è ancora nera').not.toMatch(/bg-ink-900/);
    bottone!.click();
    await attendi();
    expect(document.getElementById('pannello-notifiche-admin'), 'la tendina non si apre').toBeTruthy();
    expect(campanelle().length, 'dalla tendina non si arriva al Centro notifiche').toBeGreaterThan(0);
    s.smonta();
  }, 60000);
});
