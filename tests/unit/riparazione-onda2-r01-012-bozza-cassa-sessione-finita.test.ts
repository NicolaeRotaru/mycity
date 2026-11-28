import { describe, it, expect } from 'vitest';
import {
  CHIAVE_UTENTE_DEL_BROWSER,
  allineaUtenteDelBrowser,
  dopoEventoAccesso,
  ricordaSessione,
} from '@/lib/account/piu-account';

/**
 * R01-012 (onda 2) — La bozza della cassa (nome, telefono, indirizzo: `mc_checkout_draft`) si
 * toglieva solo su SIGNED_OUT (components/providers/QueryProvider.tsx). Un accesso finito da solo
 * arriva invece come INITIAL_SESSION vuota, senza il cookie: la bozza restava a chi apriva la cassa
 * dopo. E le copie messe da parte al cambio d'account non devono restare dopo l'uscita.
 */

/** Un deposito come quello del browser, con `length` e `key` (servono a trovare le copie messe da parte). */
function deposito(iniziale: Record<string, string> = {}) {
  const m = new Map(Object.entries(iniziale));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    chiavi: () => [...m.keys()],
  };
}

const BOZZA = JSON.stringify({ form: { fullName: 'Anna Rossi', phone: '3331234567', address: 'Via Roma 1' }, sceltaIl: 1 });
const sessione = (id: string) => ({ access_token: `a-${id}`, refresh_token: `r-${id}`, user: { id, email: `${id}@x.it` } });

describe('R01-012 · la bozza della cassa non resta a chi viene dopo', () => {
  it('accesso finito da solo (INITIAL_SESSION vuota, senza cookie) con i dati di un account: la bozza se ne va', () => {
    const d = deposito({ [CHIAVE_UTENTE_DEL_BROWSER]: 'anna', mc_checkout_draft: BOZZA });
    const s = deposito({ mc_checkout_draft: BOZZA });
    dopoEventoAccesso('INITIAL_SESSION', null, d, s, { sessioneNelDeposito: false });
    expect(d.getItem('mc_checkout_draft')).toBeNull();
    expect(s.getItem('mc_checkout_draft')).toBeNull();
  });

  it('ospite che va ad accedere (nessun account prima): la bozza resta, serve dopo l\'accesso', () => {
    const d = deposito({ mc_checkout_draft: BOZZA });
    const s = deposito();
    dopoEventoAccesso('INITIAL_SESSION', null, d, s, { sessioneNelDeposito: false });
    expect(d.getItem('mc_checkout_draft')).toBe(BOZZA);
  });

  it('rete caduta all\'apertura (sessione vuota ma cookie ancora lì): niente si tocca', () => {
    const d = deposito({ [CHIAVE_UTENTE_DEL_BROWSER]: 'anna', mc_checkout_draft: BOZZA });
    dopoEventoAccesso('INITIAL_SESSION', null, d, deposito(), { sessioneNelDeposito: true });
    expect(d.getItem('mc_checkout_draft')).toBe(BOZZA);
  });

  it('dopo l\'uscita non restano le copie della bozza messe da parte per un altro account', () => {
    const d = deposito({ mc_checkout_draft: BOZZA });
    const s = deposito();
    ricordaSessione(sessione('anna'), d);
    allineaUtenteDelBrowser('anna', d);
    // Entra Bruno: la bozza di Anna va da parte sotto il suo id.
    ricordaSessione(sessione('bruno'), d);
    allineaUtenteDelBrowser('bruno', d);
    expect(d.chiavi().some((k) => k.endsWith(':mc_checkout_draft'))).toBe(true);
    dopoEventoAccesso('SIGNED_OUT', null, d, s);
    expect(d.chiavi().filter((k) => k.includes('mc_checkout_draft'))).toEqual([]);
  });
});
