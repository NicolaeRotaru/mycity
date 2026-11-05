/**
 * Il lettore del file CSV del caricamento prodotti, fuori dalla pagina perché
 * una prova lo possa eseguire (un file di pagina di Next non può esportare
 * altro che la pagina).
 */

/** Quante volte compare `sep` fuori dalle virgolette. */
function contaFuoriVirgolette(line: string, sep: string): number {
  let n = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === sep && !inQuotes) n++;
  }
  return n;
}

/**
 * 01/11/2026 — ondata 6. Il lettore divideva solo sulla virgola: un file
 * salvato dall'Excel italiano (punto e virgola) arrivava come UNA colonna e il
 * negozio si sentiva dire «Colonne mancanti» su un file giusto. Il separatore
 * si riconosce dalla prima riga (quella dei nomi delle colonne), e il BOM che
 * Excel mette in testa ai CSV UTF-8 si toglie, se no la prima colonna si
 * chiama «\uFEFFname».
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][]; separatore: ';' | ',' } {
  const pulito = text.replace(/^\uFEFF/, '');
  // La prima riga (i nomi delle colonne) non ha mai un a capo dentro le virgolette.
  const primaRiga = pulito.split(/\r?\n/, 1)[0] ?? '';
  if (primaRiga.trim().length === 0) return { headers: [], rows: [], separatore: ',' };
  const separatore: ';' | ',' =
    contaFuoriVirgolette(primaRiga, ';') > contaFuoriVirgolette(primaRiga, ',') ? ';' : ',';

  // 01/11/2026 — collaudo finale. Il lettore divideva il file in righe PRIMA di
  // guardare le virgolette: una cella con l'a capo (Alt+Invio in Excel) faceva
  // due prodotti rotti. Ora si legge carattere per carattere, e un a capo dentro
  // le virgolette resta nella cella.
  const righe: string[][] = [];
  let riga: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < pulito.length; i++) {
    const ch = pulito[i];
    if (inQuotes) {
      if (ch === '"' && pulito[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      cur += ch;
      continue;
    }
    // Le virgolette aprono una cella solo all'inizio: una virgoletta sola in
    // mezzo al testo (5" di schermo) e' un carattere, e non si mangia le righe dopo.
    if (ch === '"' && cur.length === 0) { inQuotes = true; continue; }
    if (ch === separatore) { riga.push(cur); cur = ''; continue; }
    if (ch === '\r' && pulito[i + 1] === '\n') continue;
    if (ch === '\n' || ch === '\r') { riga.push(cur); righe.push(riga); riga = []; cur = ''; continue; }
    cur += ch;
  }
  riga.push(cur);
  righe.push(riga);

  const pieni = righe
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0));
  if (pieni.length === 0) return { headers: [], rows: [], separatore };
  const headers = pieni[0].map((h) => h.toLowerCase());
  return { headers, rows: pieni.slice(1), separatore };
}

/**
 * 01/11/2026 — collaudo finale. Excel per Windows in italiano salva il CSV «di
 * serie» (delimitato dal separatore di elenco) in Windows-1252, senza BOM:
 * letto come UTF-8, «Caffè» diventava «Caff�». Si prova UTF-8 in modo stretto
 * e, se il file non lo e', si legge come Windows-1252.
 */
export function decodificaCsv(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export async function leggiFile(file: File): Promise<string> {
  if (typeof file.arrayBuffer === 'function') return decodificaCsv(await file.arrayBuffer());
  return file.text();
}

/**
 * Il prezzo come lo scrive Excel italiano: «4,50», «19,90 €», «1.234,50».
 * Con la virgola, la virgola e' il decimale e i punti sono le migliaia.
 */
export function leggiPrezzo(grezzo: string): number {
  const s = grezzo.replace(/[^\d,.-]/g, '');
  if (s === '') return NaN;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
}


/**
 * 579 — Le intestazioni si accettano anche in italiano, come le scrive chi
 * prepara il file da sé: «nome», «descrizione», «prezzo», «scorta», «categoria».
 */
const SINONIMI: Record<string, string> = {
  nome: 'name',
  descrizione: 'description',
  prezzo: 'price',
  scorta: 'stock',
  quantita: 'stock',
  'quantità': 'stock',
  categoria: 'category_slug',
};

export function normalizzaIntestazioni(headers: string[]): string[] {
  return headers.map((h) => SINONIMI[h.trim().toLowerCase()] ?? h.trim().toLowerCase());
}

/**
 * 579 — Una riga con più celle delle intestazioni: quasi sempre un prezzo come
 * «4,50» scritto senza virgolette in un file a virgole, che si spezza in due e
 * sposta le colonne dopo (4 € di prezzo e 50 di scorta). Si rifiuta, e si dice perché.
 */
export function colonneDiTroppo(cols: string[], headers: string[], separatore: ';' | ','): string | null {
  if (cols.length <= headers.length) return null;
  return separatore === ','
    ? "C'è una virgola di troppo, forse nel prezzo? Scrivi 4.50 oppure metti il prezzo fra virgolette."
    : "C'è un punto e virgola di troppo: controlla le celle di questa riga.";
}
