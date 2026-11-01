import { describe, it, expect } from 'vitest';
import { veloceNonConfermataTemplate } from '@/lib/email/templates';
import { fraseDelFreno, fraseNonSpostato } from '@/lib/ordini/veloce-non-confermata';

/**
 * 1/11/2026 — L'email «la consegna veloce non è partita» si legge spesso ore dopo. Chiudeva con
 * «puoi annullarlo senza costi finché il negozio non lo conferma»: letta alle 13:10, col forno che
 * alle 12:58 aveva già accettato la fascia nuova, prometteva un annullo che la rotta
 * (app/api/orders/[id]/cancel, solo ordini NEW) non fa più. Caso concreto: 24,50 € in contanti.
 */
describe("l'email della veloce dice fino a quando si annulla", () => {
  const frase = fraseDelFreno({ fascia: 'Oggi · 13:00–15:00', euro: 'tolto-contanti', totaleCents: 2450 });
  const email = veloceNonConfermataTemplate({ orderId: 'ord-1', frase });

  it('non promette l’annullo senza costi senza dire che finisce quando il negozio accetta la fascia', () => {
    expect(email.text).not.toMatch(/senza costi dalla sua pagina finché il negozio non lo conferma/);
    expect(email.text).toMatch(/solo finché il negozio non lo conferma nella fascia nuova/);
    expect(email.text).toMatch(/il tasto Annulla non c’è più/);
    expect(email.html).toMatch(/solo finché il negozio non lo conferma nella fascia nuova/);
  });

  it('il resto della frase resta: fascia e importo alla porta', () => {
    expect(email.text).toMatch(/Oggi · 13:00–15:00/);
    expect(email.text).toMatch(/24,50/);
    // Una sola chiusura sull'annullo, non due.
    expect(email.text.match(/Se non ti va bene/g)?.length).toBe(1);
  });

  it('senza fascia la frase non parla di annullo e resta com’è', () => {
    const adesso = new Date('2026-11-01T19:00:00Z');
    const f = fraseNonSpostato(new Date('2026-11-02T05:00:00Z'), adesso, false);
    const e = veloceNonConfermataTemplate({ orderId: 'ord-2', frase: f, senzaFascia: true });
    expect(e.text.startsWith(f)).toBe(true);
    expect(e.text).not.toMatch(/Se non ti va bene/);
  });
});
