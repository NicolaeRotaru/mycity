import { describe, it, expect, beforeEach } from 'vitest';
import { frameTitolare, ilModuloArrivaSenzaDatabase, titolare } from '@/lib/legal/titolare';
import { mittenteFuoriDominio } from '@/lib/contatti-pubblici';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** S08 (5/11/2026) — I dati del titolare e i recapiti della posta. */

beforeEach(() => {
  delete process.env.SUPPORT_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.NEXT_PUBLIC_CONTATTI_DOMINIO;
});

describe('scheda 2535 — la frase del titolare nomina chi gestisce', () => {
  it('senza sede né P.IVA non dice solo «MyCity.»', () => {
    const t = { ...titolare(), gestore: 'Nicolae Rotaru', indirizzo: null, partitaIva: null };
    expect(frameTitolare(t)).toBe(`Nicolae Rotaru (${t.denominazione}).`);
  });
  it('senza gestore resta il nome legale da solo', () => {
    const t = { ...titolare(), gestore: null, indirizzo: null, partitaIva: null };
    expect(frameTitolare(t)).toBe(`${t.denominazione}.`);
  });
});

describe('schede 2058 e 2004 — il modulo arriva a una persona solo se la posta è nostra', () => {
  it('col supporto su un dominio altrui (support@mycity.it, quello dell esempio) risponde no', () => {
    process.env.SUPPORT_EMAIL = 'support@mycity.it';
    process.env.RESEND_API_KEY = 're_x';
    process.env.RESEND_FROM = 'MyCity <no-reply@mycity-marketplace.com>';
    expect(ilModuloArrivaSenzaDatabase()).toBe(false);
  });
  it('col mittente fuori dominio risponde no', () => {
    process.env.SUPPORT_EMAIL = 'support@mycity-marketplace.com';
    process.env.RESEND_API_KEY = 're_x';
    process.env.RESEND_FROM = 'MyCity <no-reply@altrodominio.com>';
    expect(ilModuloArrivaSenzaDatabase()).toBe(false);
  });
  it('con supporto e mittente sul nostro dominio risponde sì', () => {
    process.env.SUPPORT_EMAIL = 'support@mycity-marketplace.com';
    process.env.RESEND_API_KEY = 're_x';
    process.env.RESEND_FROM = 'MyCity <no-reply@send.mycity-marketplace.com>';
    expect(ilModuloArrivaSenzaDatabase()).toBe(true);
  });
  it('il mittente si chiede alla stessa regola di sendEmail (env.resendFrom), non a process.env', () => {
    const sorgente = readFileSync(path.resolve(__dirname, '../../lib/legal/titolare.ts'), 'utf8');
    const corpo = /export function ilModuloArrivaSenzaDatabase\(\)[\s\S]*?\n\}/.exec(sorgente)?.[0] ?? '';
    expect(corpo).toContain('env.resendFrom()');
    expect(corpo).not.toContain('process.env.RESEND_FROM');
  });
});

describe('scheda 5 — un sottodominio nostro non è «fuori dominio»', () => {
  it('no-reply@send.<dominio> è in regola', () => {
    expect(mittenteFuoriDominio('MyCity <no-reply@send.mycity-marketplace.com>', 'mycity-marketplace.com')).toBeNull();
  });
  it('un dominio diverso resta un allarme', () => {
    expect(mittenteFuoriDominio('no-reply@mycity.it', 'mycity-marketplace.com')).not.toBeNull();
    // e non basta che finisca con le stesse lettere
    expect(mittenteFuoriDominio('no-reply@nomycity-marketplace.com', 'mycity-marketplace.com')).not.toBeNull();
  });
  it('il file d esempio non suggerisce più mycity.it per mittente, risposta e supporto', () => {
    const esempio = readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8');
    for (const v of ['RESEND_FROM', 'RESEND_REPLY_TO', 'SUPPORT_EMAIL']) {
      const riga = esempio.split('\n').find((l) => l.startsWith(`${v}=`)) ?? '';
      expect(riga, v).toContain('mycity-marketplace.com');
    }
  });
});
