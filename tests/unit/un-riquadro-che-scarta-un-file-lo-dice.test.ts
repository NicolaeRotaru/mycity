import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * GUARDIANO — un riquadro di caricamento che scarta un file deve DIRLO.
 *
 * ── Perche' esiste, con la data ──────────────────────────────────────────────────────────────
 * Il 6/9/2026 una squadra ha stretto il filtro dei file a JPG/PNG/WEBP in tre riquadri. In uno
 * (StoreMediaManager) ha aggiunto anche l'avviso di rifiuto; negli altri due no. Risultato: chi
 * trascinava una foto fatta con l'iPhone — che di serie e' in formato HEIC, quindi fuori dai tre
 * ammessi — la vedeva sparire senza un messaggio, e restava a fissare un riquadro vuoto senza
 * sapere se stesse caricando, se avesse sbagliato, o se il sito fosse rotto.
 * Stessa malattia, piu' vecchia e nel posto peggiore, in SellerApplicationForm: il tetto dei 3 MB
 * scartava in silenzio nel PRIMO modulo che compila un negozio nuovo.
 *
 * ── Che tipo di prova e' questa ──────────────────────────────────────────────────────────────
 * Non e' una ricerca di parole in un file: e' un guardiano che CAMMINA su tutti i riquadri di
 * caricamento del sito, legge le opzioni di ognuno e cade se ne trova uno che scarta senza
 * parlare. Tre controlli separati avrebbero coperto i tre riquadri di oggi; questo copre anche il
 * quarto, quello che qualcuno scrivera' il mese prossimo stringendo un filtro senza l'avviso.
 *
 * La regola in una riga: se un riquadro dichiara un limite (formati, peso, quantita'), allora
 * deve dichiarare `onDropRejected`, e quel gestore deve dire qualcosa alla persona (`toast`).
 * Un `onDropRejected` vuoto non conta: e' di nuovo il file che sparisce in silenzio.
 */

const RADICE = process.cwd();
const CARTELLE = ['app', 'components', 'lib'];

/** Le opzioni che fanno scartare un file: se c'e' una di queste, il riquadro puo' dire di no. */
const LIMITI = ['accept', 'maxSize', 'minSize', 'maxFiles', 'validator'];

/**
 * I riquadri gia' muti PRIMA di questo guardiano, che stanno fuori dal territorio del lotto del
 * 6/9/2026 (altre squadre ci lavorano dentro adesso: riscriverne il codice significa perdere il
 * loro). Questa lista puo' solo ACCORCIARSI: se uno di questi viene riparato, il controllo qui
 * sotto diventa rosso finche' non lo togli da qui. Non aggiungerne: un riquadro nuovo che scarta
 * in silenzio e' il difetto che questo file esiste per fermare.
 */
const MUTI_NOTI = new Map<string, string>([
  ['components/admin/home/HomeSectionConfigForm.tsx', 'caricamento video della home, solo staff — fuori territorio il 6/9/2026'],
  ['components/seller/site/GalleryFields.tsx', 'galleria del sito del negozio — fuori territorio il 6/9/2026'],
  ['components/seller/site/ImageUpload.tsx', 'banner del sito del negozio — fuori territorio il 6/9/2026'],
]);

function tuttiIFile(dir: string, out: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const pieno = join(dir, voce);
    if (statSync(pieno).isDirectory()) tuttiIFile(pieno, out);
    else if (/\.(ts|tsx)$/.test(voce)) out.push(pieno);
  }
  return out;
}

type Blocco = { testo: string; prof: number[]; codice: boolean[] };

/**
 * Legge il blocco `{ … }` che comincia a `inizio` tenendo il conto della profondita' e sapendo
 * distinguere il codice dalle stringhe e dai commenti (dentro un commento ci sono apostrofi, e
 * dentro una stringa ci sono parentesi: contarli sarebbe sbagliare).
 */
function leggiBlocco(sorgente: string, inizio: number): Blocco | null {
  if (sorgente[inizio] !== '{') return null;
  const testo: string[] = [];
  const prof: number[] = [];
  const codice: boolean[] = [];
  let profondita = 0;
  let stato: 'codice' | 'stringa' | 'commentoRiga' | 'commentoBlocco' = 'codice';
  let apice = '';
  let i = inizio;
  const spingi = (c: string, p: number, isCodice: boolean) => { testo.push(c); prof.push(p); codice.push(isCodice); };

  while (i < sorgente.length) {
    const c = sorgente[i];
    const succ = sorgente[i + 1];
    if (stato === 'codice') {
      if (c === '/' && succ === '/') { stato = 'commentoRiga'; spingi(c, profondita, false); i++; continue; }
      if (c === '/' && succ === '*') { stato = 'commentoBlocco'; spingi(c, profondita, false); i++; continue; }
      if (c === "'" || c === '"' || c === '`') { stato = 'stringa'; apice = c; spingi(c, profondita, false); i++; continue; }
      if (c === '{' || c === '(' || c === '[') { profondita++; spingi(c, profondita, true); i++; continue; }
      if (c === '}' || c === ')' || c === ']') {
        spingi(c, profondita, true); profondita--; i++;
        if (profondita === 0) return { testo: testo.join(''), prof, codice };
        continue;
      }
      spingi(c, profondita, true); i++; continue;
    }
    if (stato === 'stringa') {
      if (c === '\\') { spingi(c, profondita, false); i++; if (i < sorgente.length) { spingi(sorgente[i], profondita, false); i++; } continue; }
      if (c === apice) stato = 'codice';
      spingi(c, profondita, false); i++; continue;
    }
    if (stato === 'commentoRiga') {
      if (c === '\n') stato = 'codice';
      spingi(c, profondita, false); i++; continue;
    }
    // commentoBlocco
    if (c === '*' && succ === '/') { spingi(c, profondita, false); i++; spingi(sorgente[i], profondita, false); i++; stato = 'codice'; continue; }
    spingi(c, profondita, false); i++;
  }
  return null; // blocco mai chiuso: sorgente incompleto
}

/** Solo i caratteri di codice al primo livello: le opzioni del riquadro, senza il loro contenuto. */
function scheletro(b: Blocco): string {
  return [...b.testo].map((c, k) => (b.codice[k] && b.prof[k] === 1 ? c : ' ')).join('');
}

function chiaviDiPrimoLivello(b: Blocco): Set<string> {
  const chiavi = new Set<string>();
  for (const m of scheletro(b).matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)) chiavi.add(m[1]);
  return chiavi;
}

/** Il testo del gestore `onDropRejected`, dalla chiave fino alla virgola che chiude l'opzione. */
function corpoDelGestore(b: Blocco): string | null {
  const scheletroTesto = scheletro(b);
  const inizio = scheletroTesto.indexOf('onDropRejected');
  if (inizio === -1) return null;
  let fine = b.testo.length;
  for (let k = inizio + 'onDropRejected'.length; k < b.testo.length; k++) {
    if (b.codice[k] && b.prof[k] === 1 && b.testo[k] === ',') { fine = k; break; }
  }
  return b.testo.slice(inizio, fine);
}

type Riquadro = { file: string; limiti: string[]; parla: boolean };

/** Tutti i riquadri di caricamento di un sorgente, con cosa vietano e se lo dicono. */
export function riquadriDi(sorgente: string, file = '<testo>'): Riquadro[] {
  const trovati: Riquadro[] = [];
  for (const m of sorgente.matchAll(/useDropzone\s*\(\s*/g)) {
    const apertura = m.index! + m[0].length;
    const blocco = leggiBlocco(sorgente, apertura);
    if (!blocco) continue;
    const chiavi = chiaviDiPrimoLivello(blocco);
    const limiti = LIMITI.filter((l) => chiavi.has(l));
    if (/multiple\s*:\s*false/.test(scheletro(blocco))) limiti.push('multiple: false');
    const corpo = corpoDelGestore(blocco);
    trovati.push({ file, limiti, parla: corpo !== null && /toast\s*\./.test(corpo) });
  }
  return trovati;
}

describe('un riquadro che scarta un file lo dice', () => {
  const riquadri = CARTELLE.flatMap((c) => tuttiIFile(join(RADICE, c)))
    .filter((f) => readFileSync(f, 'utf8').includes('useDropzone'))
    .flatMap((f) => riquadriDi(readFileSync(f, 'utf8'), relative(RADICE, f)));

  it('trova davvero i riquadri di caricamento del sito (se no non sta misurando niente)', () => {
    expect(riquadri.length).toBeGreaterThanOrEqual(6);
    // e li legge sul serio: di ognuno sa che limiti dichiara
    expect(riquadri.filter((r) => r.limiti.length > 0).length).toBeGreaterThanOrEqual(6);
  });

  it('nessun riquadro scarta un file senza dirlo alla persona', () => {
    const muti = riquadri
      .filter((r) => r.limiti.length > 0 && !r.parla && !MUTI_NOTI.has(r.file))
      .map((r) => `${r.file} — vieta [${r.limiti.join(', ')}] e non ha un onDropRejected che parla`);
    expect(
      muti,
      'questi riquadri buttano via il file che non passa il filtro senza dire niente: chi carica ' +
        "una foto dell'iPhone (HEIC) o troppo pesante la vede sparire e non sa cosa e' successo. " +
        'Aggiungi onDropRejected con un toast, con le stesse parole di components/StoreMediaManager.tsx.\n  ' +
        muti.join('\n  '),
    ).toEqual([]);
  });

  it("i muti gia' noti esistono ancora e sono ancora muti (la lista puo' solo accorciarsi)", () => {
    for (const [rel, perche] of MUTI_NOTI) {
      expect(() => statSync(join(RADICE, rel)), `${rel} e' nella lista dei muti noti «${perche}» ma non esiste piu'`).not.toThrow();
      const suoi = riquadriDi(readFileSync(join(RADICE, rel), 'utf8'), rel);
      expect(
        suoi.some((r) => r.limiti.length > 0 && !r.parla),
        `${rel} adesso l'avviso ce l'ha: togli la riga da MUTI_NOTI, se no la lista copre un buco che non c'e' piu' e ne nasconderebbe uno nuovo`,
      ).toBe(true);
    }
  });

  it('i tre riquadri riparati il 6/9/2026 parlano davvero', () => {
    for (const rel of ['components/VendorForm.tsx', 'components/ImageUrlField.tsx', 'components/SellerApplicationForm.tsx', 'components/StoreMediaManager.tsx']) {
      const suoi = riquadriDi(readFileSync(join(RADICE, rel), 'utf8'), rel);
      expect(suoi.length, `${rel}: nessun riquadro letto, il lettore si e' perso`).toBeGreaterThan(0);
      for (const r of suoi) expect(r.parla, `${rel} scarta [${r.limiti.join(', ')}] senza dirlo`).toBe(true);
    }
  });

  it("il lettore non e' cieco: su un testo costruito distingue il muto dal parlante", () => {
    const muto = `useDropzone({
      accept: { 'image/jpeg': ['.jpg'] },
      maxFiles: 1,
      // qui c'era l'avviso, e non c'e' piu'
      onDrop: async (files) => { const f = files[0]; if (!f) return; await carica(f, 'a,b'); },
    })`;
    const parlante = `useDropzone({
      accept: { 'image/jpeg': ['.jpg'] },
      onDropRejected: (r) => { toast.error('Formato non accettato: servono foto in JPG, PNG o WEBP.'); },
      onDrop: async (files) => { await carica(files[0]); },
    })`;
    const finto = `useDropzone({ onDropRejected: () => {}, accept: { 'image/png': ['.png'] } })`;
    const libero = `useDropzone({ onDrop: (files) => carica(files) })`;

    expect(riquadriDi(muto).map((r) => [r.limiti, r.parla])).toEqual([[['accept', 'maxFiles'], false]]);
    expect(riquadriDi(parlante).map((r) => r.parla)).toEqual([true]);
    expect(riquadriDi(finto).map((r) => r.parla), 'un onDropRejected vuoto non e\' un avviso').toEqual([false]);
    expect(riquadriDi(libero).map((r) => r.limiti), 'un riquadro senza limiti non ha niente da rifiutare').toEqual([[]]);
  });
});
