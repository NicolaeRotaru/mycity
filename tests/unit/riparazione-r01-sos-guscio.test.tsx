/**
 * @vitest-environment jsdom
 */
/**
 * R01-004/006 — Il pulsante SOS nasceva sempre senza orderId: anche premuto durante una
 * consegna, la consolle degli admin non sapeva da quale ordine partiva l'allarme.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({ pathname: '/rider', props: [] as Array<Record<string, unknown>> }));
vi.mock('next/navigation', () => ({ usePathname: () => stato.pathname }));
vi.mock('next/link', () => ({ default: (p: { children: unknown }) => p.children }));
vi.mock('@/components/rider/SOSButton', () => ({
  default: (p: Record<string, unknown>) => { stato.props.push(p); return null; },
}));

import RiderShell from '@/components/rider/RiderShell';

const accesi: Root[] = [];
afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); stato.props = []; });

async function monta(pathname: string) {
  stato.pathname = pathname;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(RiderShell, null, 'contenuto')); });
  return stato.props.at(-1);
}

describe('R01-004/006 · il guscio del fattorino passa l\'ordine al pulsante SOS', () => {
  it('durante una consegna il pulsante riceve l\'id dell\'ordine', async () => {
    expect(await monta('/rider/orders/8f0c2b6e-1111-2222-3333-444455556666')).toMatchObject({
      orderId: '8f0c2b6e-1111-2222-3333-444455556666',
    });
  });

  it('fuori da una consegna l\'ordine non c\'e\'', async () => {
    expect((await monta('/rider/earnings'))?.orderId).toBeUndefined();
  });
});
