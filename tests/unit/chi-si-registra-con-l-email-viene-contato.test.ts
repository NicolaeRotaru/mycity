/**
 * 27/8/2026 (R160) — CHI SI REGISTRA CON L'EMAIL NON VENIVA MAI CONTATO COME
 * ISCRITTO.
 *
 * Il numero in cima al funnel — «quante persone si iscrivono» — nasceva da un
 * solo evento, e quell'evento partiva solo se il ritorno dal link portava
 * `auth=signup`. A decidere se era una registrazione o un accesso era una
 * finestra di sessanta secondi: «se l'account è nato da meno di un minuto,
 * allora è nuovo».
 *
 * Solo che con email e password l'account nasce quando si compila il modulo, e
 * il link di conferma si apre dopo — si va a prendere il telefono, si cerca la
 * mail, a volte finisce nello spam e si torna il giorno dopo. Oltre il minuto,
 * cioè quasi sempre, il sistema diceva «accesso».
 *
 * Due danni in uno: gli iscritti da email risultavano zero, e gli accessi
 * risultavano gonfiati di uno per ogni nuovo iscritto. Ogni tasso «iscritto →
 * primo ordine» calcolato su quei numeri era falso.
 *
 * Seconda perdita, nello stesso percorso: se manca la versione dei testi
 * legali il ritorno passa da /accetta-condizioni, e quel giro perde `auth` e
 * `via` per strada — quindi non partiva nessun evento del tutto.
 *
 * La riparazione non deduce più «è nuovo» dal tempo: l'intenzione viaggia
 * dentro il link di conferma, che è l'unico posto in cui la si conosce per
 * certo. Le prove qui sotto rifanno il giro intero — modulo → link → ritorno —
 * e diventano rosse se si torna a indovinare.
 */
import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/safe-redirect';
import { decidiEventoDiAccesso, ritornoDopoLaConferma } from '@/lib/analytics/porta-di-ingresso';

const SITO = 'https://mycity.test';

/**
 * Rifà quello che fa `app/auth/callback/route.ts` quando si apre il link di
 * conferma: legge `next`, lo sanifica, e ci attacca l'esito della finestra dei
 * sessanta secondi — che a quel punto è scaduta, perché la mail si conferma
 * dopo.
 */
function ritornoDalLinkDiConferma(
  emailRedirectTo: string,
  opzioni: { passaDaAccettaCondizioni?: boolean } = {},
): URL {
  const next = safeInternalPath(new URL(emailRedirectTo).searchParams.get('next') ?? '/', '/');

  if (opzioni.passaDaAccettaCondizioni) {
    // Il ritorno anticipato: qui `auth` e `via` non vengono mai aggiunti.
    const chiedi = new URL('/accetta-condizioni', SITO);
    chiedi.searchParams.set('next', next);
    // …e la pagina, dopo la spunta, fa `router.replace(next)`.
    return new URL(chiedi.searchParams.get('next')!, SITO);
  }

  const destinazione = new URL(next, SITO);
  destinazione.searchParams.set('auth', 'signin'); // la finestra è scaduta
  destinazione.searchParams.set('via', 'email');
  return destinazione;
}

describe('chi si registra con email e password', () => {
  it("IL CASO CHE ROMPEVA — dopo la conferma della mail risulta iscritto, non «rientrato»", () => {
    const link = ritornoDopoLaConferma(SITO, null);
    const arrivo = ritornoDalLinkDiConferma(link);

    const evento = decidiEventoDiAccesso(arrivo.searchParams);
    expect(evento, "dal ritorno non parte nessun evento: l'iscrizione non si conta").toBeTruthy();
    expect(evento?.tipo, 'chi si iscrive con la mail viene contato come un accesso, non come un iscritto')
      .toBe('signup');
    expect(evento?.canale, "non si sa da quale porta è entrato").toBe('email');
  });

  it('IL CASO CHE ROMPEVA — vale anche per chi deve prima accettare i testi', () => {
    const link = ritornoDopoLaConferma(SITO, null);
    const arrivo = ritornoDalLinkDiConferma(link, { passaDaAccettaCondizioni: true });

    const evento = decidiEventoDiAccesso(arrivo.searchParams);
    expect(evento, 'passando da /accetta-condizioni non si conta più niente').toBeTruthy();
    expect(evento?.tipo).toBe('signup');
    expect(evento?.canale).toBe('email');
  });

  it('chi tornava al checkout ci torna lo stesso: il ritorno non si perde', () => {
    const link = ritornoDopoLaConferma(SITO, '/checkout');
    const arrivo = ritornoDalLinkDiConferma(link);

    expect(arrivo.pathname, 'chi si registrava dal checkout riatterrava sulla home').toBe('/checkout');
    expect(decidiEventoDiAccesso(arrivo.searchParams)?.tipo).toBe('signup');
  });

  it('un ritorno verso un sito esterno non passa: si torna a casa nostra', () => {
    const link = ritornoDopoLaConferma(SITO, 'https://sito-cattivo.example/rubo');
    const arrivo = ritornoDalLinkDiConferma(link);

    expect(arrivo.origin).toBe(SITO);
    expect(arrivo.pathname).toBe('/');
  });
});

describe("chi entra con Google, che già funzionava, continua a funzionare", () => {
  const params = (q: string) => new URLSearchParams(q);

  it('un accesso resta un accesso', () => {
    expect(decidiEventoDiAccesso(params('auth=signin&via=google'))).toEqual({ tipo: 'signin', canale: 'google' });
  });

  it('una registrazione resta una registrazione', () => {
    expect(decidiEventoDiAccesso(params('auth=signup&via=google'))).toEqual({ tipo: 'signup', canale: 'google' });
  });

  it('senza niente nell indirizzo non parte nessun evento', () => {
    expect(decidiEventoDiAccesso(params(''))).toBeNull();
    expect(decidiEventoDiAccesso(params('auth=qualcosaltro'))).toBeNull();
  });

  it("un canale scritto a mano nell'indirizzo non entra nei dati così com'è", () => {
    // `via` sta in un indirizzo, e un indirizzo lo scrive chiunque: senza
    // questo controllo bastava un link per riempire il grafico dei canali di
    // testo arbitrario.
    expect(decidiEventoDiAccesso(params('auth=signin&via=<script>alert(1)</script>'))?.canale)
      .toBe('sconosciuto');
    expect(decidiEventoDiAccesso(params('auth=signin'))?.canale).toBe('sconosciuto');
  });
});
