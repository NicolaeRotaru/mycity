import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R12-010 — Le semine 005 e 006 scrivevano nel codice l'email personale del
 * titolare per promuoverlo ad admin o retrocederlo a buyer, e il deposito e'
 * pubblico.
 *
 * Adesso l'email arriva da fuori, dall'impostazione `mycity.email_titolare`
 * (una riga `SET` prima del file): nel codice restano solo gli indirizzi finti
 * delle semine (`@piacenza-demo.local`). Che le semine girino ancora, con e
 * senza l'impostazione, lo prova il Postgres locale
 * (tests/sql/harness/riparazione-r12-le-semine-girano.sh e la prova a mano nel referto).
 */

const SEMINE = ['seeds/005_admin_and_rider.sql', 'seeds/006_admin_swap.sql'];
const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const UN_EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;
const DOMINIO_FINTO = '@piacenza-demo.local';

describe('R12-010 — le semine non portano l email del titolare nel codice', () => {
  it.each(SEMINE)('%s: nessuna email vera, solo quelle finte delle semine', (f) => {
    const vere = (leggi(f).match(UN_EMAIL) ?? []).filter((e) => !e.toLowerCase().endsWith(DOMINIO_FINTO));
    // Si conta, non si stampa: l'email non deve finire neanche nel log della prova.
    expect(vere.length, `${f}: ${vere.length} email fuori dal dominio delle semine`).toBe(0);
  });

  it.each([
    ['seeds/005_admin_and_rider.sql', "SET role = 'admin'"],
    ['seeds/006_admin_swap.sql', "SET role = 'buyer'"],
  ])('%s: il titolare si trova con l impostazione mycity.email_titolare', (f, cambio) => {
    const testo = leggi(f);
    expect(testo).toMatch(/email_titolare\s+text\s*:=\s*nullif\(current_setting\('mycity\.email_titolare',\s*true\),\s*''\)/);
    const dopo = testo.slice(testo.indexOf(cambio));
    expect(dopo).toMatch(/^[^;]*WHERE id = \(SELECT id FROM auth\.users WHERE email = email_titolare\)/);
  });
});
