/**
 * Lo stesso difetto degli stati che mentivano, visto dal lato della SCRITTURA e dei CONTATORI.
 *
 * Là il sito diceva «non c'è niente» senza aver guardato. Qui dice «fatto» senza aver fatto, e
 * «zero» senza essere riuscito a contare.
 *
 * Le tre forme, misurate il 23/8 in `components/hooks/`:
 *
 * · **La scrittura muta.** `useFavorites` faceva `await supabase.from('favorites').insert(...)`
 *   senza guardare `error`. Se l'inserimento falliva, la mutazione riusciva lo stesso: il cuore
 *   faceva la sua animazione, la lista si rileggeva, il prodotto non c'era, e nessuno diceva
 *   niente. Un clic che non fa niente dopo un'animazione che diceva di sì.
 *
 * · **La lettura muta.** Stessa cosa in lettura: l'insieme dei preferiti tornava vuoto e chi ne
 *   aveva trenta vedeva trenta cuori grigi.
 *
 * · **`if (error) return 0`.** Quattro hook lo facevano. Non è solo un numero falso: marca la
 *   lettura come RIUSCITA, e una lettura riuscita react-query non la riprova. Un guasto di rete di
 *   un secondo spegneva il pallino delle notifiche fino al ricaricamento della pagina.
 *
 * La prova ha due metà. I casi sulla regola dei tre stati, e **l'invariante di struttura** sugli
 * hook veri: senza quella avrei una regola scritta bene e nessuno obbligato a passarci.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eAcceso, siPuoPremere, statoInterruttore } from '@/lib/stato-interruttore';

const RADICE = process.cwd();
const CARTELLA_HOOK = join(RADICE, 'components/hooks');

// Un commento che CITA la forma malata per spiegarla non è la forma malata. Senza questo taglio
// l'invariante accusa le spiegazioni scritte apposta per non ripetere il difetto — è già successo.
const senzaCommenti = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const hooks = readdirSync(CARTELLA_HOOK)
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({ nome: f, percorso: join(CARTELLA_HOOK, f) }));

describe('la regola dei tre stati', () => {
  it('senza aver letto lo stato è «non lo so», qualunque cosa dica il valore', () => {
    expect(statoInterruttore({ letto: false, dentro: true })).toBe('non-lo-so');
    expect(statoInterruttore({ letto: false, dentro: false })).toBe('non-lo-so');
  });

  it('«non lo so» non è mai un sì', () => {
    // È la riga per cui esiste tutto il resto: il cuore diceva «non è fra i preferiti» a chi ce
    // l'aveva salvato, perché la terza risposta finiva nella seconda.
    expect(eAcceso(statoInterruttore({ letto: false, dentro: true }))).toBe(false);
  });

  it('«non lo so» non è nemmeno un no: non si può premere', () => {
    // E questo è il danno vero, non l'etichetta. Chi comanda l'interruttore sceglie fra aggiungere
    // e togliere guardando lo stato letto: su uno stato non letto sceglie a caso.
    expect(siPuoPremere(statoInterruttore({ letto: false, dentro: false }))).toBe(false);
    expect(siPuoPremere(statoInterruttore({ letto: true, dentro: false }))).toBe(true);
    expect(siPuoPremere(statoInterruttore({ letto: true, dentro: true }))).toBe(true);
  });

  it('letto e dentro è acceso, letto e fuori è spento', () => {
    expect(statoInterruttore({ letto: true, dentro: true })).toBe('acceso');
    expect(statoInterruttore({ letto: true, dentro: false })).toBe('spento');
    expect(eAcceso(statoInterruttore({ letto: true, dentro: true }))).toBe(true);
    expect(eAcceso(statoInterruttore({ letto: true, dentro: false }))).toBe(false);
  });
});

describe("l'invariante di STRUTTURA sugli hook veri", () => {
  it('la cartella degli hook esiste e non è vuota: senza, questo blocco non misura niente', () => {
    expect(hooks.length).toBeGreaterThan(5);
  });

  it('nessuna lettura lega `data` senza legare anche `error`', () => {
    // La forma esatta del difetto: `const { data } = await supabase…`. Senza `error` la lettura non
    // FALLISCE mai — torna riuscita con un valore di riserva, e nessun riquadro d'errore potrà
    // comparire perché il guasto non arriva mai a valle.
    const ingoiano = hooks.filter(({ percorso }) => {
      const src = senzaCommenti(readFileSync(percorso, 'utf8'));
      return /const\s*\{\s*data(\s*:\s*\w+)?\s*\}\s*=\s*await\s+supabase\s*\n?\s*\.from/.test(src);
    });
    expect(ingoiano.map((h) => h.nome)).toEqual([]);
  });

  // Le scritture si cercano per ISTRUZIONE, non per riga: `.delete()` arriva prima dei filtri
  // (`.eq(...).eq(...)`), quindi guardare le poche parole intorno al verbo non basta. Si taglia il
  // sorgente sui punti e virgola e si chiede: questa istruzione scrive? allora deve legare `error`.
  const scritture = (src: string) =>
    src
      .split(';')
      .filter((i) => /supabase\s*\n?\s*\.from\(/.test(i) && /\.(insert|update|delete|upsert)\s*\(/.test(i));

  it('il conto delle scritture non è zero: senza, il controllo qui sotto non misura niente', () => {
    // Un elenco vuoto passerebbe qualunque regola. Questa riga muore il giorno in cui la mia
    // espressione smette di riconoscere una scrittura, invece di dire verde per sbaglio.
    const trovate = hooks.flatMap(({ percorso }) => scritture(senzaCommenti(readFileSync(percorso, 'utf8'))));
    expect(trovate.length).toBeGreaterThan(0);
  });

  it('nessuna scrittura parte senza guardare se è andata a buon fine', () => {
    // Una scrittura senza `error` riesce SEMPRE: chi guarda vede un comando eseguito che non è
    // stato eseguito.
    const mute: string[] = [];
    for (const { nome, percorso } of hooks) {
      const src = senzaCommenti(readFileSync(percorso, 'utf8'));
      if (scritture(src).some((i) => !/\berror\b/.test(i))) mute.push(nome);
    }
    expect(mute).toEqual([]);
  });

  it('nessun errore diventa un valore di riserva: si lancia, o non si riprova mai più', () => {
    // `if (error) return 0` marca la lettura come RIUSCITA. react-query non riprova una query
    // riuscita: il guasto di un secondo diventa uno zero permanente fino al ricaricamento.
    const scambiano: string[] = [];
    for (const { nome, percorso } of hooks) {
      const src = senzaCommenti(readFileSync(percorso, 'utf8'));
      if (/if\s*\(\s*error\s*\)\s*return\b/.test(src)) scambiano.push(nome);
    }
    expect(scambiano).toEqual([]);
  });

  it('gli hook che espongono uno stato letto dicono ANCHE se lo hanno letto', () => {
    // Un hook che torna solo `isFollowing: false` costringe chi lo usa a indovinare la differenza
    // fra «no» e «non lo so». La differenza va data, non dedotta.
    for (const nome of ['useFavorites.ts', 'useFollowStore.ts']) {
      const src = readFileSync(join(CARTELLA_HOOK, nome), 'utf8');
      expect(/letto|Letto/.test(src), `${nome} non dichiara se ha letto davvero`).toBe(true);
    }
  });
});

describe('i tre bottoni passano tutti dalla stessa regola', () => {
  // Una regola che vale solo dove mi sono ricordato di applicarla è una buona intenzione. Questi
  // sono i tre punti in cui un interruttore dipende da una lettura, e devono usarla tutti.
  const consumatori = [
    'components/ProductCard.tsx',
    'app/product/[id]/page.tsx',
    'components/products/SellerCard.tsx',
  ];

  it.each(consumatori)('%s usa statoInterruttore invece di decidere per conto suo', (rel) => {
    const src = senzaCommenti(readFileSync(join(RADICE, rel), 'utf8'));
    expect(src).toMatch(/statoInterruttore\(/);
    expect(src).toMatch(/siPuoPremere\(|eAcceso\(/);
  });

  it.each(consumatori)('%s spegne il bottone quando lo stato non è letto', (rel) => {
    const src = senzaCommenti(readFileSync(join(RADICE, rel), 'utf8'));
    expect(src).toMatch(/disabled=\{!(cuorePremibile|seguiPremibile)\}/);
  });
});
