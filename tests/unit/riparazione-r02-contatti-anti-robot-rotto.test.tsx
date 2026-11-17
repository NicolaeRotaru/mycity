/**
 * @vitest-environment jsdom
 */
/**
 * R02-007 — Quando il controllo anti-robot non si carica, la pagina Contattaci diceva ancora
 * «Puoi provare lo stesso a inviare» e lasciava partire il modulo senza gettone. Ma /api/contact,
 * senza gettone, rifiuta il messaggio («Verifica anti-bot fallita»): la promessa era falsa.
 * Come sull'iscrizione (R24-016) la pagina dice che il messaggio non può partire e cosa fare
 * davvero (ricaricare, o scrivere all'email che la pagina già mostra), e il modulo non parte.
 *
 * Il riquadro anti-robot è finto: segnala il guasto con lo stesso motivo del componente vero.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => {
  // La chiave pubblica di prova di Cloudflare: niente di vero. La pagina la legge all'import.
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
  return { errori: [] as string[] };
});

const MOTIVO = 'Il controllo anti-bot non si è aperto.';

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return ce('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: (m: unknown) => { stato.errori.push(String(m)); } } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => undefined }));
vi.mock('@/components/Turnstile', async () => {
  const { forwardRef } = await import('react');
  return {
    default: forwardRef(function TurnstileRotto(props: { onError?: (m: string) => void }, _ref) {
      useEffect(() => { props.onError?.(MOTIVO); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }),
  };
});

import ContactPage from '@/app/contact/page';
import { indirizzoContatto } from '@/lib/contatti-pubblici';

const accesi: Root[] = [];
const fetchFinto = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Verifica anti-bot fallita. Riprova.' } }), { status: 400 }));

beforeEach(() => {
  stato.errori = [];
  fetchFinto.mockClear();
  vi.stubGlobal('fetch', fetchFinto);
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(ContactPage)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return radice;
}

function rigaDelGuasto(radice: HTMLElement): HTMLElement {
  const riga = Array.from(radice.querySelectorAll('p')).find((p) => (p.textContent ?? '').includes(MOTIVO));
  expect(riga, 'il riquadro finto non ha segnalato il guasto: la prova non guarda niente').toBeTruthy();
  return riga!;
}

function scrivi(radice: HTMLElement, etichetta: string, valore: string) {
  const label = Array.from(radice.querySelectorAll('label')).find((l) => (l.textContent ?? '').includes(etichetta))!;
  const campo = (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input,textarea')) as HTMLInputElement;
  const proto = campo.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(campo, valore);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

describe('R02-007 · la pagina contatti non promette un invio che il server rifiuta', () => {
  it('col riquadro anti-robot rotto non dice «puoi provare lo stesso»: dice che non può partire, ricaricare o scrivere all’email', async () => {
    const radice = await monta();
    const riga = rigaDelGuasto(radice);
    const testo = riga.textContent ?? '';
    expect(testo).not.toMatch(/provare lo stesso/i);
    expect(testo).toMatch(/non può partire/);
    expect(testo).toMatch(/ricarica la pagina/);
    expect(riga.querySelector('a')?.getAttribute('href')).toBe(`mailto:${indirizzoContatto('info')}`);
  });

  it('premuto «Invia» senza gettone il modulo non parte, e il messaggio a comparsa dice lo stesso guasto e la stessa strada', async () => {
    const radice = await monta();
    rigaDelGuasto(radice);
    scrivi(radice, 'Nome', 'Maria Rossi');
    scrivi(radice, 'Email', 'maria@example.com');
    scrivi(radice, 'Messaggio', 'Vorrei sapere gli orari.');
    const oraVera = Date.now;
    Date.now = () => oraVera() + 5_000; // oltre la guardia dei 2 secondi
    try {
      await act(async () => {
        radice.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    } finally {
      Date.now = oraVera;
    }
    expect(fetchFinto, 'senza gettone il modulo è partito: /api/contact lo rifiuta sempre').not.toHaveBeenCalled();
    const avviso = stato.errori.at(-1) ?? '';
    expect(avviso.startsWith(MOTIVO)).toBe(true);
    expect(avviso).not.toMatch(/provare lo stesso/i);
    expect(avviso).toMatch(/non può partire/);
    expect(avviso).toContain(indirizzoContatto('info'));
  });
});
