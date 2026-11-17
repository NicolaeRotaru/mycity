import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R02-011 — Due guardie sulla consegna veloce controllavano il testo del sorgente della cassa
 * (una riga di DeliverySlotPicker, tre stringhe di app/checkout/page.tsx, tre regex dentro handleSubmit)
 * e non il comportamento: si rompevano a ogni riscrittura innocua e restavano verdi davanti a un
 * difetto scritto con altre parole. Le hanno sostituite due prove che montano la cassa vera
 * (riparazione-r22-veloce-cassa-chiede-al-server e riparazione-r22-veloce-l-invio-rilegge-l-ora).
 * Questa guardia leggera tiene fuori dalle due prove vecchie i controlli sul testo, e dentro le due
 * nuove i casi di comportamento che li sostituiscono.
 */
const leggi = (p: string) => readFileSync(p, 'utf8');

describe('R02-011 — le guardie sulla veloce guardano il comportamento, non il testo della cassa', () => {
  it('la prova del fattorino non legge più il testo di DeliverySlotPicker e della cassa', () => {
    const prova = leggi('tests/unit/la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino.test.ts');
    expect(prova).not.toContain('const expressAvailable = expressSiPuo(ora) && veloceDisponibile === true;');
    expect(prova).not.toContain('veloceDisponibile={veloceDisponibile}');
    expect(prova).not.toContain("readFileSync('components/checkout/DeliverySlotPicker.tsx'");
  });

  it("la prova dell'appuntamento passato non cerca più regex dentro handleSubmit", () => {
    const prova = leggi('tests/unit/l-ordine-con-un-appuntamento-gia-passato.test.ts');
    expect(prova).not.toContain("checkout.indexOf('const handleSubmit')");
    expect(prova).not.toMatch(/romeNow\\\(\\\)\\\.getHours/);
  });

  it('le prove montate che le sostituiscono ci sono e hanno i loro casi', () => {
    const cassa = leggi('tests/unit/riparazione-r22-veloce-cassa-chiede-al-server.test.ts');
    expect(cassa).toContain('«Adesso» si offre solo col sì del server');
    const invio = leggi('tests/unit/riparazione-r22-veloce-l-invio-rilegge-l-ora.test.ts');
    expect(invio).toContain('confermata alle 20:05, senza che la pagina ridisegni');
  });
});
