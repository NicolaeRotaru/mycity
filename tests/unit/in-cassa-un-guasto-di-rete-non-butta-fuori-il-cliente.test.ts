import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { friendlyError } from '@/lib/errors';
import { leggiJson, messaggioDiRete } from '@/lib/api/leggi-json';

/**
 * «LA SESSIONE È SCADUTA. ACCEDI DI NUOVO» — DETTO A CHI AVEVA LA CARTA IN MANO.
 *
 * Il cliente preme «Paga con carta». La rotta non risponde in tempo e il gateway
 * restituisce la SUA pagina HTML («504 GATEWAY TIMEOUT»). La cassa faceva
 * `res.json()` su quella pagina: il parser lancia «Unexpected token '<'» su
 * Chrome e «JSON Parse error: Unrecognized token '<'» su Safari. La parola
 * «token» accendeva il ramo «sessione scaduta»: il cliente usciva dall'account,
 * rientrava, e spesso non tornava. Ordine perso al passo che incassa.
 *
 * Qui l'errore si produce DAVVERO, facendo parsare una pagina HTML.
 */

async function erroreDelParser(html: string): Promise<unknown> {
  try {
    await new Response(html, { status: 504, headers: { 'content-type': 'text/html' } }).json();
    throw new Error('il parser non ha fallito: la prova non prova piu niente');
  } catch (e) {
    return e;
  }
}

describe('la pagina di errore del gateway non è una sessione scaduta', () => {
  it('l’errore vero prodotto da una pagina HTML non manda fuori nessuno', async () => {
    const err = await erroreDelParser('<!DOCTYPE html><html><body>504 GATEWAY_TIMEOUT</body></html>');
    const messaggio = friendlyError(err);
    expect(messaggio).not.toMatch(/sessione/i);
    expect(messaggio).toMatch(/non ha risposto/i);
  });

  it('il messaggio di Chrome/Android', () => {
    const messaggio = friendlyError({ message: "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" });
    expect(messaggio).not.toMatch(/sessione/i);
  });

  it('il messaggio di Safari/iPhone', () => {
    const messaggio = friendlyError({ message: "JSON Parse error: Unrecognized token '<'" });
    expect(messaggio).not.toMatch(/sessione/i);
  });

  it('ma una sessione scaduta vera continua a dirlo', () => {
    expect(friendlyError({ message: 'jwt expired' })).toMatch(/sessione è scaduta/);
    expect(friendlyError({ message: 'Invalid Refresh Token: Already Used' })).toMatch(/sessione è scaduta/);
    expect(friendlyError({ status: 401 })).toMatch(/accedere|sessione/i);
  });
});

describe('leggere una risposta che non è JSON non fa esplodere niente', () => {
  it('pagina HTML → null, non un errore', async () => {
    const res = new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    await expect(leggiJson(res)).resolves.toBeNull();
  });

  it('risposta nostra → l’oggetto', async () => {
    const res = new Response(JSON.stringify({ ok: true, data: { url: 'https://stripe' } }), { status: 200 });
    await expect(leggiJson(res)).resolves.toEqual({ ok: true, data: { url: 'https://stripe' } });
  });

  it('senza risposta nostra si parla dello stato, e si dice la cosa utile', () => {
    expect(messaggioDiRete(504)).toMatch(/non ha risposto/i);
    expect(messaggioDiRete(413)).toMatch(/troppo grande/i);
  });
});

describe('la cassa non chiama più json() senza rete di sicurezza', () => {
  const src = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8');

  it('nessun `await res.json()` nudo nel ramo della carta', () => {
    expect(src).not.toMatch(/await res\.json\(\)\s*;/);
  });

  it('e chi paga con carta sa che non gli è stato addebitato niente', () => {
    expect(src).toContain('leggiJson(res)');
    expect(src).toMatch(/non ti è stato addebitato niente/);
  });
});
