/**
 * @vitest-environment jsdom
 */
/**
 * 27/8/2026 (R100) — IL PANNELLO CON CUI SI APPROVA UN NEGOZIO NON SI CHIUDEVA
 * CON ESC E NON TRATTENEVA IL FUOCO.
 *
 * È il pannello «Richiesta venditore»: si apre da «Esamina» e dentro ci sono i
 * due pulsanti che decidono se un negozio di Piacenza va online oppure no.
 * Era un velo scritto a mano —
 *
 *     <div className="fixed inset-0 z-[90] bg-black/60 …" onClick={onClose}>
 *
 * — e basta. Niente `role="dialog"`, niente `aria-modal`: per un lettore di
 * schermo non era un dialogo, era un pezzo di pagina comparso dal nulla, con
 * tutto il resto del sito ancora leggibile sotto. Niente tasto Esc e niente
 * trappola del fuoco: premendo Tab si usciva dal pannello e si finiva a
 * navigare la tabella dietro il velo, senza vederla e senza modo di tornare
 * indietro. Chi lavora da tastiera doveva ricaricare la pagina.
 *
 * La cosa che fa più male: la correzione stava nello stesso file. La riga 18
 * importa già `components/ui/Modal.tsx` — che ha dialogo, Esc, trappola del
 * fuoco, blocco dello scorrimento e ritorno del fuoco — e lo usa per la
 * finestra «Modifica utente». Solo che per questo pannello, quello che decide
 * di un negozio vero, non lo usava.
 *
 * Qui la pagina viene montata davvero, il pannello aperto come lo apre una
 * persona, e poi si prova a uscirne da tastiera.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, clicca, premi } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;

/** Un venditore vero in attesa di approvazione: è la riga che fa comparire «Esamina». */
const IN_ATTESA = {
  id: 'venditore-1', role: 'seller', is_approved: false, approval_status: 'pending',
  approval_requested_at: '2026-08-20T09:00:00Z', approved_at: null, rejection_reason: null,
  store_name: 'Pane Quotidiano', full_name: 'Mario Rossi', phone: '0523111222',
  store_address: 'via Roma 1', legal_first_name: 'Mario', legal_last_name: 'Rossi',
  legal_fiscal_code: null, business_legal_name: 'Pane Quotidiano srl', business_vat_number: null,
  business_form: 'SRL', business_address: 'via Roma 1', business_city: 'Piacenza',
  business_pec: 'pane@pec.it', created_at: '2026-08-01T09:00:00Z', email: 'mario@pane.it',
  auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
};

function conUnVenditoreInAttesa() {
  globale.__DATI_QUERY__ = (o: { queryKey?: unknown[] }) => {
    const chiave = o.queryKey ?? [];
    if (chiave[2] === 'kyc') return { legal_fiscal_code: null, business_vat_number: null };
    return [IN_ATTESA];
  };
}

/** Apre il pannello come lo apre una persona: col fuoco sul pulsante che lo apre. */
async function apriIlPannello() {
  const mod = await monta('app/admin/users/page.tsx');
  const s = accendi(mod.default as ComponentType);
  const esamina = Array.from(s.radice.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Esamina'),
  );
  expect(esamina, 'la pagina Utenti non mostra nessun pulsante «Esamina»').toBeTruthy();
  s.agisci(() => {
    (esamina as HTMLButtonElement).focus();
    clicca(esamina as HTMLButtonElement);
  });
  return { s, esamina: esamina as HTMLButtonElement };
}

const dialogo = () => document.querySelector('[role="dialog"][aria-modal="true"]');

afterEach(() => {
  delete globale.__DATI_QUERY__;
  document.body.style.overflow = '';
  // Una prova rossa non arriva a smontare: senza questo, il pannello di una
  // prova resterebbe nella pagina della successiva.
  document.body.replaceChildren();
});

describe('il pannello «Richiesta venditore»', () => {
  it('si annuncia come dialogo, col suo nome', async () => {
    conUnVenditoreInAttesa();
    const { s } = await apriIlPannello();

    const d = dialogo();
    expect(
      d,
      'Il pannello che decide se un negozio va online non si dichiarava dialogo: per un lettore di schermo era un pezzo di pagina, con tutto il sito ancora leggibile sotto',
    ).toBeTruthy();
    expect(
      nomeAccessibile(d as Element),
      'Il dialogo non dice come si chiama: chi lo sente aperto non sa di cosa parla',
    ).toContain('Richiesta venditore');
    s.smonta();
  }, 60000);

  it('si chiude col tasto Esc', async () => {
    conUnVenditoreInAttesa();
    const { s } = await apriIlPannello();
    expect(dialogo(), 'il pannello doveva essere aperto').toBeTruthy();

    s.agisci(() => premi('Escape'));

    expect(
      dialogo(),
      'Esc non chiudeva niente: da tastiera si restava dentro un pannello senza uscita, e l\'unico modo di uscirne era ricaricare la pagina',
    ).toBeNull();
    s.smonta();
  }, 60000);

  it('blocca lo scorrimento della pagina dietro, e lo restituisce alla chiusura', async () => {
    conUnVenditoreInAttesa();
    const { s } = await apriIlPannello();
    expect(
      document.body.style.overflow,
      'La pagina dietro il velo continuava a scorrere: si scorreva la tabella degli utenti invece del pannello',
    ).toBe('hidden');

    s.agisci(() => premi('Escape'));
    expect(document.body.style.overflow, 'chiuso il pannello, la pagina deve tornare a scorrere').not.toBe('hidden');
    s.smonta();
  }, 60000);

  it('tiene il fuoco dentro: da Tab non si esce dal pannello', async () => {
    conUnVenditoreInAttesa();
    const { s } = await apriIlPannello();
    const d = dialogo() as HTMLElement;

    const dentro = Array.from(
      d.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    expect(dentro.length, 'il pannello deve avere dei comandi').toBeGreaterThan(1);

    // Il fuoco è sull'ULTIMO comando del pannello: è lì che Tab lo faceva
    // scappare dietro il velo, sulla tabella degli utenti.
    s.agisci(() => dentro[dentro.length - 1].focus());
    s.agisci(() => premi('Tab'));

    expect(
      d.contains(document.activeElement),
      'Premendo Tab sull\'ultimo comando il fuoco usciva dal pannello e finiva sulla pagina dietro, che non si vede: chi naviga da tastiera si perdeva',
    ).toBe(true);
    s.smonta();
  }, 60000);

  it('chiuso, riporta il fuoco sul pulsante «Esamina» da cui era partito', async () => {
    conUnVenditoreInAttesa();
    const { s, esamina } = await apriIlPannello();

    // Come succede davvero: si arriva su un comando DENTRO il pannello, e da lì
    // si esce. Il fuoco è dentro qualcosa che sta per sparire.
    const dentro = (dialogo() ?? document.body).querySelectorAll<HTMLElement>('button');
    s.agisci(() => dentro[dentro.length - 1]?.focus());
    s.agisci(() => premi('Escape'));

    expect(
      document.body.textContent ?? '',
      'Il pannello non si è chiuso affatto: Esc non lo toccava',
    ).not.toContain('Richiesta venditore');
    expect(
      document.activeElement,
      'Chiuso il pannello il fuoco cadeva sul corpo della pagina: si ripartiva dall\'inizio della tabella per tornare dov\'era',
    ).toBe(esamina);
    s.smonta();
  }, 60000);
});

/**
 * La prova qui sopra misura QUESTO pannello. Questa misura la REGOLA di casa —
 * «nessun overlay scritto a mano: o passa da `components/ui/Modal.tsx`, o passa
 * da `useBottomSheetA11y`» — su tutta l'amministrazione, così il difetto non
 * può rientrare da una pagina nuova.
 */
describe('gli altri veli dell\'amministrazione', () => {
  const cartella = join(process.cwd(), 'app/admin');
  const pagine = readdirSync(cartella, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && d.name.endsWith('.tsx'))
    .map((d) => join(d.parentPath ?? cartella, d.name))
    .filter((p) => existsSync(p));

  it('ci sono pagine da misurare: una lista vuota non è un verde', () => {
    expect(pagine.length).toBeGreaterThan(5);
  });

  /**
   * Il testo senza commenti: questi file SPIEGANO nei commenti la forma che
   * sorvegliano — la pagina Utenti cita il vecchio velo per dire com'era — e
   * contarlo sarebbe un rosso su una spiegazione. È successo davvero mentre
   * scrivevo questa prova.
   */
  const senzaCommenti = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('nessun velo a tutto schermo è scritto a mano', () => {
    // Non basta che il file IMPORTI `Modal`: la pagina Utenti lo importava già,
    // e lo usava per un'altra finestra. Qui la forma stessa è il difetto.
    const scrittiAMano = pagine.filter((p) =>
      /fixed inset-0[^"']*"\s+onClick=\{onClose\}/.test(senzaCommenti(readFileSync(p, 'utf8'))),
    );
    expect(
      scrittiAMano.map((p) => p.replace(process.cwd() + '/', '')),
      'Un velo scritto a mano non ha Esc, non trattiene il fuoco e non è un dialogo: da tastiera è una trappola',
    ).toEqual([]);
  });
});
