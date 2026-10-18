import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DUE PROMESSE CHE IL CODICE NON MANTENEVA.
 *
 * ① «Invita un amico, prendete €5 entrambi». Il premio lo prende SOLO chi
 *    invita, e solo quando il primo ordine dell'invitato viene consegnato
 *    (migrazione 089: `wallet_credit(v_ref.referrer_id, …)`). Per l'invitato,
 *    dall'invito, non arriva nessuno sconto. Maria invita Luca, Luca ordina 30 €
 *    e ne paga 30, non 25: si sente preso in giro al primo contatto, e Maria fa
 *    la figura di chi ha promesso una cosa falsa.
 *
 * ② Il reso pagato in contanti: dopo la decisione di Nicola del 17/10/2026
 *    («Semplifica») i contanti tornano sempre col bonifico e l'IBAN lo chiede
 *    l'email del rimborso. Le pagine pubbliche che lo dicono le monta
 *    le-pagine-pubbliche-dicono-come-tornano-i-contanti.test.ts; qui resta l'invito.
 *
 * ── Cosa prova questo file ─────────────────────────────────────────────────
 * Non che il testo contenga la parola giusta: che la PROMESSA e il MECCANISMO
 * dicano la stessa cosa. Si legge il meccanismo (la migrazione, il tipo della
 * tabella, la funzione di rimborso) e si pretende che nessuna pagina prometta
 * di più. Se un giorno il meccanismo cambia — credito anche all'invitato, campo
 * IBAN nel modulo — la riga che lo dichiara qui cade, ed è il momento in cui la
 * promessa può tornare.
 */

const radice = process.cwd();
const leggi = (f: string) => readFileSync(join(radice, f), 'utf8');

describe('l’invito: il premio va a chi invita, e il testo lo dice', () => {
  const meccanismo = leggi('migrations/089_referral_reward_on_delivery.sql');

  it('il meccanismo accredita SOLO chi ha invitato', () => {
    expect(meccanismo).toMatch(/wallet_credit\(\s*v_ref\.referrer_id/);
    // Se un giorno si accredita anche l'invitato, questa riga cade: allora la
    // promessa «€5 a testa» torna vera e si può riscrivere.
    expect(meccanismo).not.toMatch(/wallet_credit\(\s*v_ref\.referred_id/);
  });

  it('e il premio arriva alla CONSEGNA del primo ordine, non all’iscrizione', () => {
    expect(meccanismo).toMatch(/delivery_status\s*=\s*'DELIVERED'/);
  });

  const pagine = [
    'app/profile/referral/page.tsx',
    'app/profile/page.tsx',
    'app/sign-up/page.tsx',
    'lib/account-menu.ts',
    'lib/email/templates.ts',
  ];

  for (const pagina of pagine) {
    it(`${pagina} non promette più €5 anche all’amico invitato`, () => {
      // Solo il testo che l'utente legge: i commenti raccontano il difetto.
      const testo = leggi(pagina)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(testo).not.toMatch(/entrambi\s*€?5|€5\s*(a testa|entrambi)|prendete\s*€?5/i);
      expect(testo).not.toMatch(/anche il tuo amico riceve/i);
      expect(testo).not.toMatch(/(lui|l'amico) paga €5 in meno/i);
    });
  }

  it('la pagina degli inviti dice dove si spende quel credito', () => {
    // Il credito MyCity si applica solo agli ordini pagati alla consegna
    // (app/checkout/page.tsx: `usaCredito: paymentMethod === 'cod' && useCredit`).
    expect(leggi('app/checkout/page.tsx')).toMatch(/usaCredito:\s*paymentMethod === 'cod'/);
    expect(leggi('app/profile/referral/page.tsx')).toMatch(/pagati alla consegna/i);
  });
});
