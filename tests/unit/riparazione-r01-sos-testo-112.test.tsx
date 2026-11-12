/**
 * @vitest-environment jsdom
 */
/**
 * R01-007 — L'SOS prometteva una chiamata al 112 («Verrà avviata la chiamata»), ma `tel:` apre
 * solo il tastierino col numero composto: la chiamata parte quando il fattorino preme CHIAMA.
 * I due avvisi dopo la conferma erano gia' stati corretti; restava il dialogo di conferma.
 * Qui si monta il pulsante, si apre il dialogo e si legge cosa dice davvero.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: {}, from: () => ({}) } }));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SOSButton from '@/components/rider/SOSButton';

const accesi: Root[] = [];
afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); document.body.innerHTML = ''; });

describe('R01-007 · il dialogo SOS non promette una chiamata che non parte da sola', () => {
  it('dice che si apre il tastierino e che la chiamata parte premendo CHIAMA', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    accesi.push(root);
    await act(async () => { root.render(createElement(SOSButton, {})); });
    await act(async () => { radice.querySelector<HTMLButtonElement>('button[aria-label="SOS emergenza"]')!.click(); });
    const testo = document.body.textContent ?? '';
    expect(testo).not.toMatch(/avviata la chiamata|stiamo chiamando|chiamata .* in corso/i);
    expect(testo).toMatch(/tastierino/i);
    expect(testo).toMatch(/premi CHIAMA/);
  });
});
