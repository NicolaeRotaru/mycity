/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement, useState } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  controllaIndirizzoImmagine,
  hostImmagineAmmesso,
  HOST_IMMAGINI_AMMESSI,
} from '@/lib/indirizzo-immagine-ammesso';

/**
 * 8/9/2026 — INCOLLAVI L'INDIRIZZO DI UN'IMMAGINE E LA PAGINA MOSTRAVA UN BUCO, SENZA DIRE PERCHE'.
 *
 * ── Il difetto, in parole semplici ───────────────────────────────────────────────────────────
 * Nel pannello di amministrazione, sotto il riquadro «Carica da dispositivo», c'e' un campo che
 * dice: «oppure incolla un URL https://…». L'invito e' aperto: incolla quello che vuoi. Ma il
 * sito le immagini le sa mostrare solo da quattro domini. L'admin incollava l'indirizzo di una
 * locandina trovata sul sito del locale, il campo accettava in silenzio, lui salvava — e la
 * copertina dell'evento restava un riquadro vuoto in home e sulla pagina Eventi. Nessun avviso,
 * ne' mentre scriveva ne' dopo aver salvato: per capirlo doveva andare a guardare la pagina
 * pubblica e indovinare da solo.
 *
 * ── Perche' quattro domini ───────────────────────────────────────────────────────────────────
 * Due muri, non uno. L'ottimizzatore di Next accetta solo gli indirizzi elencati in
 * `images.remotePatterns` (`next.config.js`) e a tutti gli altri risponde 400. E il browser, per
 * conto suo, blocca ogni immagine che non stia nella direttiva `img-src` della politica di
 * sicurezza (`middleware.ts`). Un indirizzo fuori elenco sbatte contro l'uno, contro l'altro, o
 * contro tutti e due.
 *
 * ── La malattia, che e' la cosa vera da chiudere ─────────────────────────────────────────────
 * L'elenco viveva in due file di configurazione che l'interfaccia non ha mai letto. Riparare il
 * singolo campo non basterebbe: basta che qualcuno aggiunga o tolga un dominio in `next.config.js`
 * e il campo ricomincerebbe a mentire, in silenzio come prima. Per questo la lista adesso ha UNA
 * casa — `lib/indirizzo-immagine-ammesso.ts` — il campo la interroga, e l'ultimo blocco di questa
 * prova lega quella casa alla configurazione: il giorno che divergono, qui diventa rosso.
 *
 * ── Che prova e' questa ──────────────────────────────────────────────────────────────────────
 * Tre blocchi, in ordine di forza. Il primo ESEGUE la funzione che decide. Il secondo MONTA il
 * campo vero e scrive dentro come ci scrive una persona, poi guarda cosa c'e' a video prima che
 * qualcuno abbia salvato niente. Il terzo tiene insieme la lista e i due file che la impongono.
 */

/** Una copertina caricata da noi: sta nello Storage di casa. */
const NOSTRA = 'https://abcdefgh.supabase.co/storage/v1/object/public/products/home/locandina.jpg';
/** Quella che l'admin incolla dal sito del locale: il sito non la sapra' mostrare. */
const ESTRANEA = 'https://www.locale-di-piacenza.it/img/locandina.jpg';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. La decisione, eseguita.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('quali indirizzi il sito sa davvero mostrare', () => {
  it('la copertina caricata da noi passa', () => {
    const esito = controllaIndirizzoImmagine(NOSTRA);
    expect(esito.stato).toBe('ammesso');
    expect(esito.messaggio).toBeNull();
  });

  it('un indirizzo qualunque NON passa, e il messaggio dice il dominio e cosa fare', () => {
    const esito = controllaIndirizzoImmagine(ESTRANEA);
    expect(esito.stato).toBe('non_ammesso');
    // Il messaggio deve nominare il colpevole e dare la via d'uscita: senza «carica il file»
    // l'admin sa solo che qualcosa non va, non cosa fare al posto suo.
    expect(esito.messaggio).toContain('www.locale-di-piacenza.it');
    expect(esito.messaggio?.toLowerCase()).toContain('carica il file');
  });

  it('gli altri tre domini ammessi passano', () => {
    for (const indirizzo of [
      'https://images.pexels.com/photos/1234/foto.jpeg',
      'https://placehold.co/600x400.png',
      'https://api.iconify.design/mdi/store.svg',
    ]) {
      expect(controllaIndirizzoImmagine(indirizzo).stato, indirizzo).toBe('ammesso');
    }
  });

  it('il dominio giusto ma in http non passa: la politica di sicurezza elenca solo https', () => {
    const esito = controllaIndirizzoImmagine('http://images.pexels.com/photos/1/foto.jpeg');
    expect(esito.stato).toBe('non_ammesso');
    expect(esito.messaggio).toContain('https://');
  });

  it('un dominio che si limita a CONTENERE quello ammesso non passa', () => {
    // `*.supabase.co` non e' «contiene supabase.co»: se lo fosse, basterebbe registrare
    // `supabase.co.qualcosa.it` per farsi mostrare un'immagine da casa nostra.
    expect(hostImmagineAmmesso('abc.supabase.co.attaccante.it')).toBe(false);
    expect(hostImmagineAmmesso('nonimages.pexels.com')).toBe(false);
    // E il jolly vale per un livello solo, come in Next.
    expect(hostImmagineAmmesso('supabase.co')).toBe(false);
    expect(hostImmagineAmmesso('a.b.supabase.co')).toBe(false);
    expect(hostImmagineAmmesso('abcdefgh.supabase.co')).toBe(true);
  });

  it('mentre si scrive il campo tace: nessuno urla addosso a chi digita', () => {
    for (const mezzo of ['', '   ', 'h', 'https:/', 'https://loca', 'www.locale']) {
      const esito = controllaIndirizzoImmagine(mezzo);
      expect(esito.messaggio, `«${mezzo}» non e' un errore, e' una persona che sta scrivendo`).toBeNull();
      expect(['vuoto', 'incompleto']).toContain(esito.stato);
    }
  });

  it('un percorso di casa nostra passa: la politica di sicurezza lo permette con self', () => {
    expect(controllaIndirizzoImmagine('/placeholder.svg').stato).toBe('ammesso');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Il campo vero, montato, con dentro una persona che incolla.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Scrive in un campo come ci scrive una persona, e lo fa sapere a React. */
function scriviNelCampo(campo: HTMLInputElement, valore: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Il campo dove si incolla l'indirizzo, fra i controlli del componente. */
function campoIndirizzo(radice: HTMLElement): HTMLInputElement {
  const el = radice.querySelector('input[type="url"]');
  expect(el, "il campo dell'indirizzo non e' a video: la prova girerebbe a vuoto").not.toBeNull();
  return el as HTMLInputElement;
}

/** Tutto il testo che l'admin legge nel componente. */
function testoAVideo(radice: HTMLElement): string {
  return (radice.textContent ?? '').replace(/\s+/g, ' ');
}

async function campoConStato() {
  const mod = await monta('components/ImageUrlField.tsx');
  const Campo = mod.ImageUrlField as (p: Record<string, unknown>) => unknown;
  expect(Campo, 'components/ImageUrlField.tsx non esporta piu ImageUrlField').toBeTruthy();
  // Il campo e' «controllato»: il valore lo tiene chi lo usa. Qui lo tiene questo guscio, che e'
  // esattamente quello che fanno le due schermate di amministrazione.
  return function Guscio() {
    const [v, setV] = useState('');
    return createElement(Campo as never, {
      value: v,
      onChange: setV,
      pathPrefix: 'events',
      label: 'Copertina',
    });
  };
}

describe("il campo dell'amministrazione, mentre l'admin incolla", () => {
  it('incollando un indirizzo che il sito non sa mostrare, lo dice SUBITO — prima di salvare', async () => {
    const Guscio = await campoConStato();
    const s = accendi(Guscio, {});
    const campo = campoIndirizzo(s.radice);

    // Prima: campo vuoto, nessun avviso. Se ci fosse gia', il rosso dopo non direbbe niente.
    expect(testoAVideo(s.radice)).not.toContain('non e ammesso');

    s.agisci(() => scriviNelCampo(campo, ESTRANEA));

    const testo = testoAVideo(s.radice);
    // Questo e' il difetto, invertito: prima qui non compariva niente.
    expect(
      testo,
      "l'admin ha incollato un indirizzo che il sito non sa mostrare e il campo non gli dice niente: salvera' e trovera' un buco",
    ).toContain('Questo indirizzo non');
    expect(testo.toLowerCase(), "l'avviso non dice cosa fare al posto suo").toContain('carica il file');
    // E lo dice anche a chi la pagina la ascolta, non solo a chi la guarda.
    expect(campoIndirizzo(s.radice).getAttribute('aria-invalid')).toBe('true');
    const descritto = campoIndirizzo(s.radice).getAttribute('aria-describedby');
    expect(descritto, "l'avviso non e collegato al campo: un lettore di schermo non lo legge").toBeTruthy();
    // `getElementById` e non un selettore: gli id che React genera con useId contengono i due
    // punti, che dentro un selettore CSS andrebbero protetti a mano.
    expect(s.doc.getElementById(descritto as string)?.textContent ?? '').toContain('Questo indirizzo non');

    s.smonta();
  });

  it("non disegna l'anteprima di un'immagine che il browser blocchera'", async () => {
    const Guscio = await campoConStato();
    const s = accendi(Guscio, {});

    s.agisci(() => scriviNelCampo(campoIndirizzo(s.radice), ESTRANEA));

    // Disegnarla non mostra l'immagine: mostra il buco. Era meta' del difetto.
    const immagini = Array.from(s.radice.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(immagini, `il campo prova a disegnare ${ESTRANEA}, che restera un riquadro vuoto`).not.toContain(
      ESTRANEA,
    );
    expect(testoAVideo(s.radice)).toContain('Nessuna anteprima');

    s.smonta();
  });

  it("con la nostra copertina invece l'anteprima si vede e non protesta nessuno", async () => {
    const Guscio = await campoConStato();
    const s = accendi(Guscio, {});

    s.agisci(() => scriviNelCampo(campoIndirizzo(s.radice), NOSTRA));

    const immagini = Array.from(s.radice.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(immagini, "la copertina caricata da noi deve vedersi in anteprima").toContain(NOSTRA);
    expect(testoAVideo(s.radice)).not.toContain('Questo indirizzo non');
    expect(campoIndirizzo(s.radice).getAttribute('aria-invalid')).toBeNull();

    s.smonta();
  });

  it("se il dominio e giusto ma l'immagine non arriva, il buco lo dice lo stesso", async () => {
    // L'altra meta' del buco bianco: indirizzo del NOSTRO Storage, ma il file non c'e' piu' — o
    // il percorso ha una lettera sbagliata. Il controllo sul dominio non puo' saperlo: lo scopre
    // il browser, e finora non lo diceva a nessuno.
    const Guscio = await campoConStato();
    const s = accendi(Guscio, {});
    s.agisci(() => scriviNelCampo(campoIndirizzo(s.radice), NOSTRA));

    const anteprima = s.radice.querySelector('img');
    expect(anteprima, "l'anteprima doveva esserci: l'indirizzo e di casa nostra").not.toBeNull();

    s.agisci(() => {
      (anteprima as HTMLImageElement).dispatchEvent(new window.Event('error', { bubbles: false }));
    });

    expect(
      testoAVideo(s.radice),
      "l'immagine non arriva e il campo non dice niente: resta il buco bianco di prima",
    ).toContain('non arriva nessuna immagine');
    expect(campoIndirizzo(s.radice).getAttribute('aria-invalid')).toBe('true');

    // E cambiando indirizzo l'avviso se ne va da solo: non resta appiccicato al campo.
    s.agisci(() => scriviNelCampo(campoIndirizzo(s.radice), NOSTRA.replace('locandina', 'altra')));
    expect(testoAVideo(s.radice)).not.toContain('non arriva nessuna immagine');

    s.smonta();
  });

  it('e il valore continua ad arrivare a chi lo usa: avvisare non vuol dire impedire di scrivere', async () => {
    const mod = await monta('components/ImageUrlField.tsx');
    const Campo = mod.ImageUrlField as (p: Record<string, unknown>) => unknown;
    const ricevuti: string[] = [];
    const s = accendi(Campo, {
      value: '',
      onChange: (u: string) => ricevuti.push(u),
      pathPrefix: 'events',
      label: 'Copertina',
    });

    s.agisci(() => scriviNelCampo(campoIndirizzo(s.radice), ESTRANEA));

    // Un campo controllato che si rifiutasse di propagare diventerebbe impossibile da correggere:
    // l'admin non riuscirebbe piu' a cancellare quello che ha incollato.
    expect(ricevuti).toContain(ESTRANEA);
    s.smonta();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. Perche' la malattia non torni: una lista sola, legata ai due file che la impongono.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** I domini elencati in `images.remotePatterns` di next.config.js, letti dal file vero. */
function hostDelNextConfig(): string[] {
  const sorgente = readFileSync('next.config.js', 'utf8');
  const blocco = sorgente.match(/remotePatterns:\s*\[([\s\S]*?)\n\s{4}\],/);
  expect(blocco, 'in next.config.js non trovo piu remotePatterns: la prova girerebbe a vuoto').toBeTruthy();
  const trovati = Array.from((blocco as RegExpMatchArray)[1].matchAll(/hostname:\s*'([^']+)'/g)).map(
    (m) => m[1],
  );
  expect(trovati.length, 'nessun hostname dentro remotePatterns').toBeGreaterThan(0);
  return Array.from(new Set(trovati)).sort();
}

/** La direttiva `img-src` della politica di sicurezza, letta dal middleware vero. */
function direttivaImgSrc(): string {
  const sorgente = readFileSync('middleware.ts', 'utf8');
  const riga = sorgente.match(/`img-src [^`]+`/);
  expect(riga, 'in middleware.ts non trovo piu la direttiva img-src').toBeTruthy();
  return (riga as RegExpMatchArray)[0];
}

describe('la lista dei domini ha una casa sola', () => {
  it('quella che il campo interroga e quella che next.config.js impone sono la stessa', () => {
    // Il giorno che qualcuno aggiunge un dominio in next.config.js e si dimentica di qui, il campo
    // direbbe «non e ammesso» di un indirizzo che il sito mostra benissimo. E viceversa: tolto un
    // dominio la', il campo continuerebbe ad accettarlo e tornerebbe il buco bianco. E' la
    // divergenza silenziosa fra i due file ad aver creato il difetto.
    expect([...HOST_IMMAGINI_AMMESSI].sort()).toEqual(hostDelNextConfig());
  });

  it('e ogni dominio della lista e anche fra quelli che il browser lascia passare', () => {
    const imgSrc = direttivaImgSrc();
    for (const schema of HOST_IMMAGINI_AMMESSI) {
      if (schema === '*.supabase.co') {
        // Il nostro Storage nella politica entra come variabile, non scritto a mano.
        expect(imgSrc, 'img-src non contiene piu il dominio Supabase').toContain('${supaHost}');
        continue;
      }
      expect(
        imgSrc,
        `${schema} e ammesso dal campo ma la politica di sicurezza lo blocca: sarebbe un via libera bugiardo`,
      ).toContain(`https://${schema}`);
    }
  });

  it('il campo chiede alla casa, non tiene una copia sua', () => {
    // Non e' la prova principale — quella e' il blocco 2, che monta il campo — ma tiene fuori la
    // ricaduta piu' probabile: qualcuno che riscrive i quattro domini dentro il componente.
    const sorgente = readFileSync('components/ImageUrlField.tsx', 'utf8');
    expect(sorgente).toContain("from '@/lib/indirizzo-immagine-ammesso'");
    expect(
      sorgente.match(/supabase\.co|placehold\.co|images\.pexels\.com|api\.iconify\.design/g),
      'i domini sono stati ricopiati dentro il componente: fra un mese saranno diversi da next.config.js',
    ).toBeNull();
  });
});
