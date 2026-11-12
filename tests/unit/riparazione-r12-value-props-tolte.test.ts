/**
 * R12-007 — VALUE_PROPS («le quattro promesse») non lo mostrava nessuna pagina:
 * lo correggevano solo le prove, e una delle «cinque case» delle promesse non
 * arrivava a nessun utente. Tolto: le frasi vere stanno in lib/promesse-pubbliche.
 */
import { describe, it, expect } from 'vitest';
import * as costanti from '@/lib/constants';

describe('R12-007 nessuna promessa che nessuno vede', () => {
  it('lib/constants non esporta più VALUE_PROPS', () => {
    expect('VALUE_PROPS' in costanti).toBe(false);
  });
});
