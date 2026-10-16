/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { DOVE_CHIEDIAMO_L_IBAN, QUANTO_TENIAMO_L_IBAN } from '@/lib/rimborsi/iban-del-rimborso';

/**
 * Riesame del 16/10, quinto giro — LE DOMANDE FREQUENTI PROMETTEVANO SULL'IBAN PIU' DELL'INFORMATIVA.
 *
 * Alla domanda «Il pagamento è sicuro?» la risposta diceva: l'IBAN te lo chiediamo «solo se vuoi un
 * rimborso con bonifico», e «resta sulla richiesta di reso». Per un reclamo in contanti pero' il
 * bonifico non lo sceglie nessuno, l'IBAN lo chiediamo noi per email e arriva con un messaggio dai
 * Contatti, che resta fra i messaggi dell'assistenza fino a 2 anni — come dice, giustamente,
 * l'informativa. Due pagine pubbliche dicevano due cose diverse sullo stesso dato bancario.
 *
 * Adesso la risposta dice per cosa lo chiediamo e, per il dove e il quanto, rimanda all'informativa,
 * che li legge dall'unico posto dove sono scritti. La prova monta le due pagine vere, apre la domanda
 * come farebbe una persona e segue il collegamento.
 */

let Faq: ComponentType<Record<string, unknown>>;
let Informativa: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Faq = (await monta('app/faq/page.tsx')).default as ComponentType<Record<string, unknown>>;
  Informativa = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 120000);

function laRisposta(domanda: string) {
  const s = accendi(Faq);
  const pulsante = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes(domanda));
  expect(pulsante, `la domanda «${domanda}» non c e: la prova non sta guardando niente`).toBeTruthy();
  s.agisci(() => clicca(pulsante!));
  const risposta = pulsante!.parentElement!.querySelector('div');
  return { s, risposta };
}

describe('la risposta sull IBAN e l informativa dicono la stessa cosa', () => {
  it('IL CASO CHE ROMPEVA — la risposta non dice dove resta l IBAN: rimanda all informativa, che lo dice', () => {
    const { s, risposta } = laRisposta('Il pagamento è sicuro?');
    const testo = testoVisibile(risposta);
    expect(testo, 'la risposta non e comparsa').toContain('IBAN');
    // Una promessa sua sul «dove resta» (o sul «solo se vuoi») contraddice l'informativa nel caso del reclamo.
    expect(testo, 'la risposta promette dove resta l IBAN, piu stretto dell informativa').not.toMatch(/resta sulla richiesta|solo se vuoi/u);

    const collegamenti = Array.from(risposta?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href'));
    expect(collegamenti, 'la risposta non porta all informativa').toContain('/privacy');
    s.smonta();

    // Dove porta il collegamento c'e' quello che la risposta non dice piu': il dove e il quanto veri.
    const pagina = accendi(Informativa);
    const informativa = testoVisibile(pagina.radice);
    expect(informativa).toContain(DOVE_CHIEDIAMO_L_IBAN);
    expect(informativa).toContain(QUANTO_TENIAMO_L_IBAN);
    pagina.smonta();
  }, 60000);
});
