import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { anonimizzaTestoLibero, TABELLE_CON_DATI_PERSONALI } from '@/lib/account/cancellazione';
import { giftCardRecipientTemplate } from '@/lib/email/templates';
import { aggiornamentiSu, fintoMondo } from './aiuti/finta-cancellazione-account';

/**
 * 3/9/2026 — IL BUONO REGALO TENEVA PER SEMPRE L'INDIRIZZO DI UNA PERSONA CHE
 * NON È NOSTRA CLIENTE.
 *
 * Marco regala 50 € a Chiara Rossi il 3 settembre. Per farlo scrive il nome di
 * Chiara, la sua email e la frase «Buon compleanno, ti aspetto da Pane
 * Quotidiano!». Quei tre dati passano da Stripe, tornano indietro col webhook
 * e restano nella tabella dei buoni regalo. Chiara riceve un'email da noi.
 *
 * Chiara non ha un account, non ha mai letto la nostra informativa e non sa
 * nemmeno che siamo noi ad avere il suo indirizzo. A novembre Marco cancella
 * l'account: nel database restano «Chiara Rossi», la sua email e quella frase,
 * senza più nemmeno il legame con chi le ha scritte.
 *
 * La causa non è una svista: la cancellazione elencava le tabelle da ripulire
 * una per una, dentro il codice, quindi ogni tabella nata dopo nasceva fuori
 * dall'elenco. Adesso l'elenco è un dato solo — `TABELLE_CON_DATI_PERSONALI` —
 * la cancellazione lo percorre, e questa prova lo percorre insieme a lei: una
 * tabella scritta nell'elenco e non eseguita diventa rossa, e una tabella
 * nuova con dati personali va aggiunta in un posto solo.
 */

const MARCO = '33333333-3333-4333-8333-333333333333';

describe('l elenco unico delle tabelle da ripulire', () => {
  it('i buoni regalo ci sono, con i tre dati del destinatario', () => {
    const buoni = TABELLE_CON_DATI_PERSONALI.find((t) => t.tabella === 'gift_cards' && t.colonna === 'buyer_id');
    expect(
      buoni,
      'i buoni regalo non sono nell’elenco: nome, email e messaggio di chi ha ricevuto il regalo restano da noi per sempre',
    ).toBeTruthy();
    expect(buoni?.colonna).toBe('buyer_id');
    expect(buoni?.azzera).toEqual({ recipient_name: null, recipient_email: null, message: null });
  });

  it('la riga del buono resta in vita dopo la cancellazione, quindi va ripulita prima', () => {
    // gift_cards.buyer_id punta ai profili con ON DELETE SET NULL
    // (migrations/030): la riga non sparisce, perde solo il proprietario. È
    // esattamente il motivo per cui nessuno l'avrebbe più ritrovata.
    for (const voce of TABELLE_CON_DATI_PERSONALI.filter((t) => t.tabella === 'gift_cards')) {
      expect(voce.sopravvive, `gift_cards per ${voce.colonna}`).toBe(true);
    }
  });

  it('vale anche quando a cancellarsi è chi il regalo lo ha ricevuto', () => {
    // La riga si può ripulire da due parti: chi ha comprato il buono
    // (`buyer_id`) e chi lo ha riscattato (`redeemed_by`). Guardarne una sola
    // lascia il nome e l’email dell’altra scritti nella riga per sempre.
    const perRiscatto = TABELLE_CON_DATI_PERSONALI.find(
      (t) => t.tabella === 'gift_cards' && t.colonna === 'redeemed_by',
    );
    expect(
      perRiscatto,
      'chi ha riscattato il regalo e poi chiede di sparire resta scritto nella riga del buono',
    ).toBeTruthy();
    expect(perRiscatto?.azzera).toEqual({ recipient_name: null, recipient_email: null, message: null });
  });

  it('non è un elenco decorativo: ogni voce viene eseguita davvero', async () => {
    const { admin, diario } = fintoMondo();
    await anonimizzaTestoLibero(admin as never, MARCO);

    for (const t of TABELLE_CON_DATI_PERSONALI) {
      const scritte = aggiornamentiSu(diario, t.tabella).filter((s) => s.colonna === t.colonna);
      expect(
        scritte.length,
        `${t.tabella} (per ${t.colonna}) è nell’elenco ma non la ripulisce nessuno: ${t.perche}`,
      ).toBe(1);
      expect(scritte[0].valori).toEqual(t.azzera);
      expect(scritte[0].valore).toBe(MARCO);
    }
  });

  it('il credito del buono non viene toccato', async () => {
    // Chi ha ricevuto il regalo non c’entra niente con chi cancella l’account:
    // i soldi sono stati pagati e devono restare spendibili. Si tolgono i dati
    // della persona, non la riga.
    const { admin, diario } = fintoMondo();
    await anonimizzaTestoLibero(admin as never, MARCO);

    const scritta = aggiornamentiSu(diario, 'gift_cards')[0];
    expect(scritta, 'nessuna scrittura sui buoni regalo').toBeTruthy();
    for (const campo of ['balance_cents', 'amount_cents', 'code', 'expires_at']) {
      expect(scritta.valori, `la cancellazione dell’account brucia il credito del buono (${campo})`).not.toHaveProperty(campo);
    }
  });
});

describe('l email che arriva a chi riceve il regalo', () => {
  const email = giftCardRecipientTemplate({
    code: 'MC-ABCDEFGHJKLM',
    amountEuro: 50,
    senderName: 'Marco',
    message: 'Buon compleanno!',
  });

  it('le dice perché ce l’abbiamo, il suo indirizzo', () => {
    expect(
      email.html,
      'la persona non sa da dove arriviamo: è il primo contatto con dati presi da qualcun altro (art. 14 GDPR)',
    ).toContain('ha comprato un buono regalo per te e ci ha lasciato il tuo');
  });

  it('non le dice la bugia del piede standard', () => {
    // Il piede comune dice «hai ricevuto questa email perché hai un account su
    // MyCity». Lei un account non ce l’ha.
    expect(email.html).not.toContain('perché hai un account');
  });

  it('le dice come farsi cancellare, e dove leggere il resto', () => {
    expect(email.html).toContain('/privacy');
    expect(email.html.toLowerCase()).toContain('cancellare');
    // Vale anche per chi legge la posta in solo testo.
    expect(email.text.toLowerCase()).toContain('cancellare');
    expect(email.text).toContain('/privacy');
  });
});

describe('l informativa pubblicata', () => {
  const pagina = readFileSync(path.join(process.cwd(), 'app/privacy/page.tsx'), 'utf8');

  it('dichiara i buoni regalo fra le finalità, con base giuridica e conservazione', () => {
    expect(
      pagina,
      'un trattamento che non compare nell’informativa è un trattamento senza informativa',
    ).toContain('Buoni regalo');
    expect(pagina).toContain('dati del destinatario');
    expect(pagina).toMatch(/art\.\s*6\.1\.f/);
  });
});
