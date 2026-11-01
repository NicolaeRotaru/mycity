/**
 * @vitest-environment jsdom
 */
/**
 * 1/11/2026 — IL SOS NON DICEVA MAI QUALE CONSEGNA STAVA PORTANDO IL FATTORINO.
 *
 * RiderShell montava <SOSButton /> senza orderId, e SOSButton scrive
 * `order_id: orderId ?? null`. Risultato: ogni allarme arrivava con order_id
 * nullo e la consolle mostrava «Non era in consegna» anche a meta' consegna.
 * Qui si monta il guscio VERO su /rider/orders/abc e si guarda cosa riceve il
 * pulsante SOS.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({ path: '/rider', props: [] as Array<{ orderId?: string }> }));

vi.mock('next/navigation', () => ({ usePathname: () => stato.path }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement('a', { href }, children as never),
}));
vi.mock('@/components/rider/SOSButton', () => ({
  default: (p: { orderId?: string }) => {
    stato.props.push(p);
    return createElement('button', { 'data-order': p.orderId ?? '' }, 'SOS');
  },
}));

import RiderShell from '@/components/rider/RiderShell';

let root: Root | null = null;
let box: HTMLDivElement;

beforeEach(() => {
  stato.props = [];
  box = document.createElement('div');
  document.body.appendChild(box);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  box.remove();
});

function monta(path: string) {
  stato.path = path;
  root = createRoot(box);
  act(() => root!.render(createElement(RiderShell, null, createElement('p', null, 'x'))));
  return stato.props.at(-1);
}

describe('RiderShell passa al SOS la consegna in corso', () => {
  it('a meta\' consegna (/rider/orders/abc) il SOS riceve orderId abc', () => {
    expect(monta('/rider/orders/abc')?.orderId).toBe('abc');
  });
  it('anche nelle sotto-pagine della consegna', () => {
    expect(monta('/rider/orders/abc/foto')?.orderId).toBe('abc');
  });
  it('fuori da una consegna non inventa un ordine', () => {
    expect(monta('/rider/guadagni')?.orderId).toBeUndefined();
    act(() => root?.unmount());
    root = null;
    expect(monta('/rider')?.orderId).toBeUndefined();
  });
});
