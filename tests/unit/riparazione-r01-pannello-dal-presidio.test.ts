/**
 * @vitest-environment jsdom
 */
/**
 * 17/11/2026 — CINQUE PAGINE DEL PANNELLO DECIDONO COL PRESIDIO, NON COI RAMI SCRITTI A MANO.
 *
 * Rimesse contanti, bonifici ai negozi, assistenza, prodotti e registro delle azioni decidevano
 * scheletro, errore e vuoto con `isLoading` / `isError` / `.length === 0` scritti a mano, invece
 * di passare dal presidio comune `vistaDaQuery` (lib/vista-query.ts) come il cruscotto di oggi.
 *
 * La differenza si vede quando la lettura è IN ATTESA ma ferma — React Query 5 senza rete:
 * `isPending` vero, `isLoading` falso, nessun dato. Coi rami a mano `isLoading` è falso, il ripiego
 * `= []` prende il posto del dato e la pagina scrive «Nessuna rimessa COD in attesa», «Nessun payout
 * da riconciliare», «0 di 0» prodotti: un vuoto che nessuno ha letto. Col presidio resta lo scheletro.
 *
 * Per ognuna delle cinque pagine: ① lettura ferma → scheletro, niente frase di vuoto;
 * ② lettura caduta → «Non riesco a leggere» e «Riprova» che rilegge; ③ lettura riuscita e vuota →
 * la stessa frase di vuoto di prima (l'aspetto per chi guarda non cambia).
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const G = globalThis as Record<string, unknown>;

const PAGINE = [
  { nome: 'rimesse contanti', file: 'app/admin/cod-remittance/page.tsx', vuoto: 'Nessuna rimessa COD in attesa' },
  { nome: 'bonifici ai negozi', file: 'app/admin/payouts/page.tsx', vuoto: 'Nessun payout da riconciliare' },
  { nome: 'assistenza', file: 'app/admin/support/page.tsx', vuoto: 'Nessun messaggio in questo stato' },
  { nome: 'prodotti', file: 'app/admin/products/page.tsx', vuoto: '0 di 0' },
  { nome: 'registro delle azioni', file: 'app/admin/audit/page.tsx', vuoto: 'Nessuna voce nel log' },
];

afterEach(() => {
  for (const k of ['__ESITO_QUERY__', '__DATI_QUERY__']) delete G[k];
  document.body.innerHTML = '';
});

describe.each(PAGINE)('pannello · $nome passa dal presidio', (p) => {
  it('lettura in attesa ma ferma (senza rete, nessun dato): scheletro, non «vuoto»', async () => {
    G.__ESITO_QUERY__ = { isPending: true, isLoading: false, isSuccess: false, isError: false, data: undefined, fetchStatus: 'paused' };
    const mod = await monta(p.file);
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';
    expect(testo, `«${p.vuoto}» su una lettura mai arrivata: è un vuoto che nessuno ha letto`).not.toContain(p.vuoto);
    expect(testo).not.toContain('Non riesco a leggere');
    expect(s.radice.querySelector('.skeleton, [role="status"][aria-live]'), 'deve restare sullo scheletro').not.toBeNull();
    s.smonta();
  });

  it('lettura caduta: dice che non ha letto e «Riprova» rilegge', async () => {
    let riletture = 0;
    G.__ESITO_QUERY__ = {
      isError: true,
      isSuccess: false,
      error: new Error('statement timeout'),
      data: undefined,
      refetch: () => { riletture++; return Promise.resolve({}); },
    };
    const mod = await monta(p.file);
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';
    expect(testo).not.toContain(p.vuoto);
    expect(testo).toContain('Non riesco a leggere');
    const riprova = s.radice.querySelector('[role="alert"] button') as HTMLButtonElement | null;
    expect(riprova, 'nessun pulsante per riprovare').not.toBeNull();
    expect(riprova!.textContent ?? '').toContain('Riprova');
    s.agisci(() => clicca(riprova!));
    expect(riletture, '«Riprova» non rilegge niente').toBeGreaterThan(0);
    s.smonta();
  });

  it('lettura riuscita e vuota: la frase di vuoto di sempre', async () => {
    G.__DATI_QUERY__ = [];
    const mod = await monta(p.file);
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain(p.vuoto);
    expect(testo).not.toContain('Non riesco a leggere');
    s.smonta();
  });
});
