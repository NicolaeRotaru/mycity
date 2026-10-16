/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  DOVE_CHIEDIAMO_L_IBAN,
  PERCHE_TENIAMO_L_IBAN,
  QUANTO_TENIAMO_L_IBAN,
} from '@/lib/rimborsi/iban-del-rimborso';

/**
 * 16/10/2026 — L'INFORMATIVA DICEVA DOVE E QUANTO TENIAMO L'IBAN, E NON ERA VERO.
 *
 * La riga sull'IBAN per il rimborso diceva «raccolto solo se scegli il bonifico nella richiesta di
 * reso, conservato sulla richiesta e usato solo per quel bonifico». Due cose false:
 *  · per un reclamo (e per un reso arrivato senza IBAN) lo chiediamo per email, e il cliente lo
 *    manda con un messaggio dalla pagina Contatti — che finisce fra i messaggi dell'assistenza e
 *    nella sua casella email, non «sulla richiesta»;
 *  · la tabella delle conservazioni non aveva nessuna riga per questo dato, e il codice non lo
 *    cancellava mai.
 *
 * Adesso dove lo chiediamo e quanto lo teniamo sono scritti UNA volta, accanto al codice che lo
 * cancella (`lib/rimborsi/iban-del-rimborso.ts`, provato da
 * `l-iban-del-rimborso-si-tiene-solo-finche-il-bonifico-e-da-fare.test.ts`), e la pagina li legge
 * da li'. La prova MONTA la pagina vera e guarda cosa legge chi la apre: la riga nella tabella, con
 * base giuridica e conservazione, e la voce dei dati raccolti con il «dove».
 *
 * ⚪ Che le parole siano giuste per la legge non lo dice una prova: lo dice il legale.
 */

let Pagina: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Pagina = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

describe('l informativa, come la legge chi la apre', () => {
  it('nella tabella delle conservazioni c e la riga dell IBAN, con base giuridica e tempo', () => {
    const s = accendi(Pagina);
    const righe = Array.from(s.radice.querySelectorAll('#finalita tbody tr'));
    expect(righe.length, 'la tabella non e comparsa: la prova non sta guardando niente').toBeGreaterThan(5);

    const riga = righe.find((r) => /bonifico/i.test(testoVisibile(r.querySelector('td'))));
    expect(riga, 'nessuna riga per l IBAN del rimborso: un dato senza tempo di conservazione').toBeTruthy();
    const celle = Array.from(riga!.querySelectorAll('td')).map((c) => testoVisibile(c));
    expect(celle[1]).toBe(PERCHE_TENIAMO_L_IBAN);
    expect(celle[2]).toBe(QUANTO_TENIAMO_L_IBAN);
    s.smonta();
  }, 60000);

  it('fra i dati raccolti dice dove chiediamo l IBAN davvero: modulo di reso e, per i reclami, il messaggio', () => {
    const s = accendi(Pagina);
    const voci = Array.from(s.radice.querySelectorAll('#dati li')).map((li) => testoVisibile(li));
    const voce = voci.find((t) => t.startsWith('Dati per il rimborso con bonifico'));
    expect(voce, 'la voce dell IBAN e sparita dai dati raccolti').toBeTruthy();
    expect(voce).toContain(DOVE_CHIEDIAMO_L_IBAN);
    expect(voce, 'dice ancora che l IBAN si raccoglie solo nel reso').not.toMatch(/raccolto solo se scegli il bonifico/);
    s.smonta();
  }, 60000);
});

describe('le parole dicono la regola che il codice applica', () => {
  // Non e' una ricerca nel file della pagina: sono le frasi che la pagina mostra, confrontate con
  // i quattro casi della regola che l'altra prova esegue sul codice.
  it('i quattro casi ci sono tutti: fatto, chiuso senza bonifico, account cancellato con e senza debito', () => {
    expect(QUANTO_TENIAMO_L_IBAN).toMatch(/bonifico è fatto/);
    expect(QUANTO_TENIAMO_L_IBAN).toMatch(/si chiude senza bonifico/);
    expect(QUANTO_TENIAMO_L_IBAN).toMatch(/non ti dobbiamo nessun bonifico, l'IBAN se ne va con l'account/);
    expect(QUANTO_TENIAMO_L_IBAN).toMatch(/restano solo l'IBAN e il tuo nome come intestatario, fino al pagamento/);
  });

  it('dice anche il percorso dei reclami: email, poi messaggio dalla pagina Contatti', () => {
    expect(DOVE_CHIEDIAMO_L_IBAN).toMatch(/modulo di reso/);
    expect(DOVE_CHIEDIAMO_L_IBAN).toMatch(/reclamo/);
    expect(DOVE_CHIEDIAMO_L_IBAN).toMatch(/pagina Contatti/);
  });
});
