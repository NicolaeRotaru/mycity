/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta, nomeAccessibile, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca, attendi } from './aiuti/schermo';

/**
 * 30/8/2026 (R105) — CINQUE INTERRUTTORI CHE SI ANNUNCIAVANO TUTTI UGUALI.
 *
 * In «Impostazioni account» si decidono notifiche, email commerciali e lingua.
 * I comandi erano `<button role="switch">` messi DENTRO un `<label>` che
 * conteneva titolo e descrizione. Ruolo e stato erano giusti; il nome no.
 *
 * Per un `<button>` il nome accessibile si prende da `aria-label`,
 * `aria-labelledby` o dal proprio contenuto — il `<label>` che lo avvolge i
 * browser NON lo usano (vale per i campi, non per i pulsanti). Qui il contenuto
 * era una `<span>` decorativa, la pallina che scorre: nome vuoto.
 *
 * Cosa sentiva una persona cieca: «interruttore, attivato» cinque volte di
 * fila, indistinguibili. Poteva premerli, non sapere quale. O prova a caso, o
 * lascia tutto com'è — e restare senza controllo sulle proprie preferenze non è
 * un dettaglio estetico: è il criterio WCAG 4.1.2, livello A.
 *
 * Questa prova monta la pagina vera, va sulla scheda «Notifiche» e chiede a
 * ogni interruttore il nome che un browser calcolerebbe.
 */

afterEach(() => {
  document.body.innerHTML = '';
});

beforeEach(() => {
  (globalThis as Record<string, unknown>).__UTENTE__ = { id: 'u1', email: 'chi@prova.it' };
  (globalThis as Record<string, unknown>).__RISPOSTA_SUPABASE__ = {
    data: [{
      notif_order_updates: true,
      notif_promos: false,
      notif_groups: true,
      notif_newsletter: false,
      email_marketing: false,
    }],
    error: null,
  };
  // La pagina chiede allo sportello se c'è una cancellazione in corso: senza
  // questa, il montaggio si ferma su una fetch che non esiste in jsdom.
  (globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ pending: false }), { status: 200, headers: { 'content-type': 'application/json' } });
});

function interruttori(radice: Element): HTMLElement[] {
  return Array.from(radice.querySelectorAll<HTMLElement>('[role="switch"]'));
}

async function schedaNotifiche() {
  const mod = await monta('app/profile/settings/page.tsx');
  const s = accendi(mod.default as unknown);
  await attendi();
  await attendi();
  const scheda = Array.from(s.radice.querySelectorAll('button')).find(
    (b) => testoVisibile(b).trim() === 'Notifiche',
  );
  if (!scheda) throw new Error('la scheda «Notifiche» non si trova: la pagina non è arrivata in fondo al caricamento');
  s.agisci(() => clicca(scheda));
  return s;
}

describe('gli interruttori delle impostazioni account', () => {
  it('ognuno dice qual è: non sono cinque «interruttore» uguali', async () => {
    const s = await schedaNotifiche();
    const trovati = interruttori(s.radice);

    expect(trovati.length, 'nella scheda Notifiche non c è nessun interruttore: la prova non sta guardando niente')
      .toBeGreaterThanOrEqual(5);

    const muti = trovati.filter((i) => !nomeAccessibile(i));
    expect(
      muti.length,
      `${muti.length} interruttori su ${trovati.length} si annunciano solo come «interruttore»: ` +
        'chi non vede lo schermo li può premere ma non sa quale sta premendo',
    ).toBe(0);

    // E i nomi devono essere DIVERSI fra loro: cinque nomi uguali sarebbero
    // esattamente lo stesso problema, scritto meglio.
    const nomi = trovati.map((i) => nomeAccessibile(i));
    expect(new Set(nomi).size, `nomi ripetuti fra gli interruttori: ${nomi.join(' · ')}`).toBe(nomi.length);
    expect(nomi).toContain('Aggiornamenti ordini');
    s.smonta();
  }, 60000);

  it('e ognuno dice anche se è acceso o spento', async () => {
    const s = await schedaNotifiche();
    for (const i of interruttori(s.radice)) {
      expect(
        i.getAttribute('aria-checked'),
        `l interruttore «${nomeAccessibile(i)}» non dice se è acceso`,
      ).toMatch(/^(true|false)$/);
    }
    s.smonta();
  }, 60000);

  it('la descrizione sotto al titolo resta collegata, non si perde', async () => {
    // Serve a spiegare cosa si sta accendendo («Offerte dai tuoi negozi
    // preferiti»): togliendo il <label> quel testo poteva restare orfano.
    const s = await schedaNotifiche();
    const primo = interruttori(s.radice)[0];
    const descritto = primo.getAttribute('aria-describedby');
    expect(descritto, 'la spiegazione dell interruttore non è collegata a nessuno').toBeTruthy();
    expect(testoVisibile(document.getElementById(descritto as string))).not.toBe('');
    s.smonta();
  }, 60000);
});
