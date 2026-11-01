// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * IL PROFILO DEL FATTORINO DICE «SCADUTO» QUANDO IL DOCUMENTO E' SCADUTO.
 *
 * 1/11/2026 — La pagina /rider/profile calcolava «in scadenza» come «meno di 60 giorni
 * da oggi»: una patente scaduta da un mese ha una differenza negativa, quindi finiva
 * anche lei in «In scadenza», con la scritta «Scade <data passata>». Il fattorino con
 * patente o polizza scaduta non veniva avvisato di niente. E il documento d'identita'
 * risultava «Verificato» appena caricato, prima che l'admin lo guardasse.
 *
 * Qui si monta la pagina vera col profilo finto e si legge cosa vede il fattorino.
 */

const stato = vi.hoisted(() => ({ profilo: {} as Record<string, unknown> }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => {
  const vuoto = { data: [], count: 0, error: null };
  const catena: Record<string, unknown> = {};
  catena.select = () => catena;
  catena.eq = () => catena;
  catena.then = (r: (v: unknown) => unknown) => Promise.resolve(vuoto).then(r);
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'r1', email: 'rider@test.it' } } }),
        signOut: async () => ({}),
      },
      from: (tabella: string) => {
        if (tabella === 'profiles') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'r1', ...stato.profilo }, error: null }) }) }),
          };
        }
        return catena;
      },
    },
  };
});

import RiderProfilePage from '@/app/rider/profile/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;

const isoTraGiorni = (giorni: number) => {
  const d = new Date();
  d.setDate(d.getDate() + giorni);
  return d.toLocaleDateString('sv-SE');
};

async function monta(profilo: Record<string, unknown>) {
  stato.profilo = profilo;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(RiderProfilePage))));
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const riga = (etichetta: string) =>
  Array.from(contenitore.querySelectorAll('div.flex.items-center.gap-3')).find((el) =>
    (el.textContent ?? '').includes(etichetta),
  )?.textContent ?? '';

afterEach(async () => {
  await act(async () => root.unmount());
  contenitore.remove();
});

describe('il profilo del fattorino distingue scaduto da in scadenza', () => {
  it('patente scaduta da 30 giorni: «Scaduto», non «In scadenza», e un avviso chiaro', async () => {
    await monta({ rider_license_expires_on: isoTraGiorni(-30), rider_insurance_expires_on: isoTraGiorni(300) });
    const patente = riga('Patente di guida');
    expect(patente).toMatch(/Scaduto/);
    expect(patente).not.toMatch(/In scadenza/);
    expect(patente).not.toMatch(/Scade \d/);
    expect(contenitore.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/patente scaduta/);
  });

  it('assicurazione scaduta ieri: «Scaduto» e avviso', async () => {
    await monta({ rider_license_expires_on: isoTraGiorni(500), rider_insurance_expires_on: isoTraGiorni(-1) });
    expect(riga('Assicurazione RC')).toMatch(/Scaduto/);
    expect(contenitore.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/assicurazione scaduta/);
  });

  it('scadenza fra 20 giorni: resta «In scadenza», niente avviso di scaduto', async () => {
    await monta({ rider_license_expires_on: isoTraGiorni(20), rider_insurance_expires_on: isoTraGiorni(300) });
    expect(riga('Patente di guida')).toMatch(/In scadenza/);
    expect(contenitore.querySelector('[role="alert"]')).toBeNull();
  });

  it('scade oggi: vale ancora oggi, quindi «In scadenza» e non «Scaduto»', async () => {
    await monta({ rider_license_expires_on: isoTraGiorni(0), rider_insurance_expires_on: isoTraGiorni(300) });
    expect(riga('Patente di guida')).toMatch(/In scadenza/);
    expect(contenitore.querySelector('[role="alert"]')).toBeNull();
  });

  it('documento caricato ma fattorino non ancora approvato: non e\' «Verificato»', async () => {
    await monta({ kyc_id_doc_front_url: 'kyc/r1/fronte.jpg', approval_status: 'pending' });
    expect(riga('Documento identità')).not.toMatch(/Verificato/);
    expect(riga('Documento identità')).toMatch(/in verifica/);
  });

  it('documento caricato e fattorino approvato: «Verificato»', async () => {
    await monta({ kyc_id_doc_front_url: 'kyc/r1/fronte.jpg', approval_status: 'approved' });
    expect(riga('Documento identità')).toMatch(/Verificato/);
  });
});
