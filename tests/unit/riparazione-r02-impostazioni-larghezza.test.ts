import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R02-022 (12/11/2026) — Prova leggera di stile. Al telefono, coi caratteri grandi, le schede
 * Notifiche e Zona pericolosa delle impostazioni uscivano di lato. La pagina sommava un suo px-6
 * alla cornice px-4 di AccountShell, e dentro c'erano altri p-6.
 */
const pagina = readFileSync('app/profile/settings/page.tsx', 'utf8');
const guscio = readFileSync('components/account/AccountShell.tsx', 'utf8');

describe('R02-022 · le impostazioni non scorrono di lato al telefono', () => {
  it('la cornice laterale la mette solo il guscio dell account', () => {
    expect(guscio).toMatch(/px-4[^"]*sm:px-6/);
    expect(pagina).not.toMatch(/className="container mx-auto px-6 /);
    expect(pagina).toMatch(/<div className="mx-auto py-8 max-w-5xl">/);
  });

  it('Notifiche e Zona pericolosa hanno un margine interno più stretto al telefono e possono restringersi', () => {
    const notifiche = pagina.slice(0, pagina.indexOf('Preferenze notifiche'));
    const sezioneNotifiche = notifiche.slice(notifiche.lastIndexOf('<section'));
    expect(sezioneNotifiche).toMatch(/className="min-w-0 bg-white border rounded-xl p-4 sm:p-6 /);
    expect(pagina).not.toMatch(/<section className="bg-white border-2 border-red-200 rounded-xl p-6">/);
    expect(pagina).toMatch(/<section className="min-w-0 bg-white border-2 border-red-200 rounded-xl p-4 sm:p-6">/);
    expect(pagina).toMatch(/w-full sm:w-auto justify-center items-center gap-2 bg-red-600/);
  });
});
