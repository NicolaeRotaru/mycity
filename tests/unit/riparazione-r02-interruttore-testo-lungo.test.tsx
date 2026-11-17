/**
 * @vitest-environment jsdom
 */
/**
 * R02-003 — Prova leggera di stile. Nelle righe delle impostazioni (Toggle) il blocco del testo è
 * un figlio flex senza `min-w-0`: con un titolo o una descrizione lunghi (o i caratteri grandi del
 * telefono) il testo non va a capo e spinge l'interruttore fuori dalla riga. Qui si monta il Toggle
 * vero e si guarda la classe del blocco che contiene titolo e descrizione.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { screen } from '@testing-library/dom';

import { Toggle } from '@/components/ui/Toggle';

const accesi: Root[] = [];

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(Toggle, {
      label: 'Notifiche sugli ordini dei negozi che segui, anche quelli che non apri da mesi',
      desc: 'Ricevi un avviso ogni volta che un negozio che segui pubblica una promozione o cambia gli orari di apertura',
      value: false,
      onChange: () => undefined,
    }));
  });
  return screen.getByRole('switch');
}

describe('R02-003 · nella riga del Toggle il testo lungo va a capo invece di spingere fuori l’interruttore', () => {
  it('il blocco del testo (figlio flex accanto all’interruttore) ha min-w-0', async () => {
    const interruttore = await monta();
    const titolo = document.getElementById(interruttore.getAttribute('aria-labelledby') ?? '');
    expect(titolo).not.toBeNull();
    const blocco = titolo!.parentElement!;
    const riga = blocco.parentElement!;
    expect(riga.classList.contains('flex')).toBe(true);
    expect(riga.contains(interruttore)).toBe(true);
    expect(blocco.classList.contains('min-w-0')).toBe(true);
  });

  it('l’interruttore non si restringe (shrink-0)', async () => {
    const interruttore = await monta();
    expect(interruttore.classList.contains('shrink-0')).toBe(true);
  });
});
