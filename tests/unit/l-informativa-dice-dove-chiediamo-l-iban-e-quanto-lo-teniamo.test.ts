/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  DOVE_CHIEDIAMO_L_IBAN,
  L_AVVISO_A_CHI_PAGA,
  PERCHE_TENIAMO_L_IBAN,
  QUANTO_TENIAMO_L_IBAN,
} from '@/lib/privacy/iban-per-email';

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
 * 17/10/2026 — Decisione di Nicola («Semplifica»): sul sito non c'e' piu' un campo per l'IBAN, e
 * nessuna colonna del database lo tiene (tests/sql/rls/40-nessuna-colonna-tiene-l-iban-del-rimborso).
 * L'IBAN arriva rispondendo all'email del rimborso; la cancellazione dell'account non aspetta piu'
 * nessun bonifico (provato da `l-avviso-del-bonifico-resta-utile-dopo-la-cancellazione.test.ts`).
 *
 * Dove lo chiediamo e quanto lo teniamo sono scritti UNA volta (`lib/privacy/iban-per-email.ts`) e
 * la pagina li legge da li'. La prova MONTA la pagina vera e guarda cosa legge chi la apre: la riga
 * nella tabella, con base giuridica e conservazione, e la voce dei dati raccolti con il «dove» e
 * l'avviso a chi paga, che porta l'email del cliente.
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

  it('fra i dati raccolti dice dove chiediamo l IBAN davvero, e che chi paga riceve la tua email', () => {
    const s = accendi(Pagina);
    const voci = Array.from(s.radice.querySelectorAll('#dati li')).map((li) => testoVisibile(li));
    const voce = voci.find((t) => t.startsWith('Dati per il rimborso con bonifico'));
    expect(voce, 'la voce dell IBAN e sparita dai dati raccolti').toBeTruthy();
    expect(voce).toContain(DOVE_CHIEDIAMO_L_IBAN);
    expect(voce, 'l avviso a chi paga porta l email del cliente e l informativa non lo dice').toContain(L_AVVISO_A_CHI_PAGA);
    s.smonta();
  }, 60000);
});

describe('le parole dicono quello che il codice fa adesso', () => {
  // Le regole tolte il 17/10 non si promettono piu': nessun IBAN nel modulo di reso, nessuna
  // cancellazione dell'IBAN col bonifico «fatto» (il «fatto» non esiste), nessuna attesa della
  // cancellazione dell'account.
  it('non promette il modulo di reso, il «fatto» ne l attesa della cancellazione', () => {
    const tutto = `${DOVE_CHIEDIAMO_L_IBAN} ${QUANTO_TENIAMO_L_IBAN} ${L_AVVISO_A_CHI_PAGA}`;
    expect(tutto).not.toMatch(/modulo di reso|bonifico (è|risulti) fatto|cancellazione aspetta/);
  });

  it('dice la strada vera: la risposta all email, e il messaggio dai Contatti come eccezione', () => {
    expect(DOVE_CHIEDIAMO_L_IBAN).toMatch(/rispondendo all'email/);
    expect(DOVE_CHIEDIAMO_L_IBAN).toMatch(/Non scrivere l'IBAN nel modulo Contatti/);
  });
});
