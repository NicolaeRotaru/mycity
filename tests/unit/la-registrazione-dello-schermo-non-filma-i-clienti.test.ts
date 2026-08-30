import { describe, it, expect } from 'vitest';
import {
  PAGINE_CON_DATI_DI_TERZI,
  laPaginaSiPuoFilmare,
  opzioniRegistrazioneSchermo,
  applicaRegistrazioneSchermo,
} from '@/lib/analytics/posthog';

/**
 * 27/8/2026 (R055) — LA REGISTRAZIONE DELLO SCHERMO FILMAVA I CLIENTI.
 *
 * PostHog registra un filmato di quello che si vede sullo schermo. La
 * configurazione mascherava i CAMPI DA COMPILARE — password, email — e basta:
 * il testo già scritto nella pagina finiva nel filmato così com'era.
 *
 * Il punto è chi appare in quel testo. Sulla pagina degli ordini del negoziante
 * ci sono nome, telefono e indirizzo del CLIENTE; nell'amministrazione c'è
 * l'elenco degli utenti. Il consenso ai cookie lo dà il negoziante, non le
 * persone che compaiono sul suo schermo: quei video sono l'unico punto in cui
 * indirizzi e telefoni escono dal database e finiscono su un servizio esterno,
 * negli Stati Uniti, senza che l'interessato lo sappia.
 *
 * Adesso il testo è mascherato ovunque, e sulle pagine che mostrano dati di
 * terzi la registrazione si spegne del tutto. Queste prove diventano rosse se
 * si torna indietro.
 */

/** Un finto PostHog che ricorda quando gli si accende e spegne la telecamera. */
function fintoPosthog() {
  const mosse: string[] = [];
  return {
    mosse,
    ph: {
      capture: () => {},
      identify: () => {},
      reset: () => {},
      opt_in_capturing: () => {},
      opt_out_capturing: () => {},
      register: () => {},
      startSessionRecording: () => { mosse.push('accesa'); },
      stopSessionRecording: () => { mosse.push('spenta'); },
    },
  };
}

describe('cosa entra nel filmato della sessione', () => {
  it('anche il testo già scritto nella pagina è mascherato, non solo i campi da compilare', () => {
    const opzioni = opzioniRegistrazioneSchermo();
    expect(
      opzioni.maskTextSelector,
      'senza questo il filmato mostra in chiaro nome, telefono e indirizzo del cliente scritti nella pagina',
    ).toBe('*');
    expect(opzioni.maskAllInputs).toBe(true);
  });
});

describe('dove la telecamera resta spenta', () => {
  const conDatiDiAltri = [
    '/seller/orders',
    '/seller',
    '/admin/users',
    '/rider/consegne',
    '/orders/1234',
    '/checkout',
    '/profile/settings',
    '/messages/abc',
  ];

  for (const percorso of conDatiDiAltri) {
    it(`su ${percorso} non si filma`, () => {
      expect(
        laPaginaSiPuoFilmare(percorso),
        `su ${percorso} sullo schermo ci sono i dati di persone che non hanno dato nessun consenso`,
      ).toBe(false);
    });
  }

  const senzaDatiDiAltri = ['/', '/product/pane-2kg', '/search?q=pane', '/stores', '/cart'];
  for (const percorso of senzaDatiDiAltri) {
    it(`su ${percorso} si filma come prima`, () => {
      expect(
        laPaginaSiPuoFilmare(percorso),
        'spegnere la registrazione anche in vetrina butta via il motivo per cui la si è accesa',
      ).toBe(true);
    });
  }

  it('un percorso che inizia per le stesse lettere non viene scambiato per una pagina protetta', () => {
    // «/sellers-del-mese» non è «/seller»: il confronto è sul segmento intero.
    expect(laPaginaSiPuoFilmare('/sellers-del-mese')).toBe(true);
    expect(laPaginaSiPuoFilmare('/ordersommario')).toBe(true);
  });

  it("l'elenco delle pagine protette non è vuoto", () => {
    expect(PAGINE_CON_DATI_DI_TERZI.length).toBeGreaterThan(0);
  });
});

describe('la telecamera si spegne e si riaccende navigando', () => {
  it('entrando negli ordini del negozio la registrazione viene spenta', () => {
    const { ph, mosse } = fintoPosthog();
    applicaRegistrazioneSchermo(ph, '/seller/orders');
    expect(
      mosse,
      'la registrazione è rimasta accesa sulla pagina con nome, telefono e indirizzo dei clienti',
    ).toEqual(['spenta']);
  });

  it('tornando in vetrina la registrazione riparte', () => {
    const { ph, mosse } = fintoPosthog();
    applicaRegistrazioneSchermo(ph, '/seller/orders');
    applicaRegistrazioneSchermo(ph, '/product/pane-2kg');
    expect(mosse).toEqual(['spenta', 'accesa']);
  });

  it('se la libreria non sa spegnere la telecamera non si schianta la pagina', () => {
    const senzaComandi = {
      capture: () => {}, identify: () => {}, reset: () => {},
      opt_in_capturing: () => {}, opt_out_capturing: () => {}, register: () => {},
    };
    expect(() => applicaRegistrazioneSchermo(senzaComandi, '/admin')).not.toThrow();
  });
});
