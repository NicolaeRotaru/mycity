#!/usr/bin/env node
/**
 * QUANTO DEL MARKETPLACE È GIÀ IN ARMONIA (Nicola, 28/11/2026).
 *
 * «Adesso non puoi farlo tutto, c'è tantissimo codice: piano piano ci lavoreremo, e ogni modifica,
 * correzione o riparazione userà come linea questo.» Questo programma misura il «piano piano»:
 * conta i file che disegnano qualcosa (hanno un className) e quanti di questi usano già l'armonia
 * nascosta (lib/armonia, components/armonia, i token --armonia-* o le classi f1…f6, text-aurea-*,
 * max-w-aurea, grid-cols-aurea, aspect-aurea/quinta/quarta, ease-armonia, armonia-entra).
 * Il numero deve solo salire. Poi elenca, nell'ordine deciso, le prossime pagine da portare in armonia.
 *
 * Uso: node scripts/armonia-adozione.mjs [--json]
 * È una misura, non un cancello: esce sempre 0.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CARTELLE = ['app', 'components'];

/** Le classi e i segni che dicono «questo file usa l'armonia». */
const SEGNI_ARMONIA = [
  /from ['"]@\/(lib|components)\/armonia/,
  /--armonia-/,
  /\barmonia-entra\b/,
  /\b(?:-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|top|left|right|bottom|w|h|size))-f[1-6]\b/,
  /\btext-aurea-[0-3]\b/,
  /\bmax-w-aurea\b/,
  /\bgrid-cols-aurea(?:-inversa)?\b/,
  /\baspect-(?:aurea|quinta|quarta)\b/,
  /\bease-armonia\b/,
];

/**
 * L'ordine in cui portare il marketplace in armonia (skill «armonia», piano di adozione):
 * prima le pagine dei negozi, che possono avere la firma del loro negozio; il pagamento per ultimo e
 * solo con proporzioni e spazi, perché lì si toccano i soldi.
 */
export const PIANO = [
  { file: 'app/store', perche: 'la pagina di ogni negozio, con la firma di quel negozio' },
  { file: 'app/product', perche: 'la scheda prodotto: foto in rapporto 3:2 o 4:3, titoli sulla scala aurea' },
  { file: 'app/page.tsx', perche: 'la home: spazi di Fibonacci e la trama di MyCity nei margini' },
  { file: 'components/ProductCard.tsx', perche: 'le schede prodotto: spazi e caratteri' },
  { file: 'components/ProductGrid.tsx', perche: 'le griglie: le schede si accendono nell\'ordine del quadrato magico' },
  { file: 'components/Navbar.tsx', perche: 'la testata: solo spazi e caratteri, la struttura non si sposta' },
  { file: 'app/checkout', perche: 'il pagamento: solo proporzioni e spazi, mai trama né animazioni' },
];

/** Vero se il file disegna qualcosa a schermo. */
export const disegna = (testo) => /className=/.test(testo);

/** Vero se il file usa già l'armonia nascosta. */
export const inArmonia = (testo) => SEGNI_ARMONIA.some((re) => re.test(testo));

function fileTsx(cartella) {
  const out = [];
  let voci = [];
  try { voci = readdirSync(cartella); } catch { return out; }
  for (const v of voci) {
    const p = join(cartella, v);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...fileTsx(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

export function misura(radice = RADICE) {
  const visibili = [];
  const armonici = [];
  for (const c of CARTELLE) {
    for (const f of fileTsx(join(radice, c))) {
      const testo = readFileSync(f, 'utf8');
      if (!disegna(testo)) continue;
      const rel = relative(radice, f);
      visibili.push(rel);
      if (inArmonia(testo)) armonici.push(rel);
    }
  }
  const prossimi = PIANO.map((voce) => {
    const suoi = visibili.filter((f) => f === voce.file || f.startsWith(`${voce.file}/`));
    const fatti = suoi.filter((f) => armonici.includes(f));
    return { ...voce, file_totali: suoi.length, in_armonia: fatti.length };
  });
  return { visibili: visibili.length, in_armonia: armonici.length, file_in_armonia: armonici, piano: prossimi };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = misura();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(m, null, 2));
  } else {
    const pct = m.visibili ? Math.round((m.in_armonia / m.visibili) * 1000) / 10 : 0;
    console.log(`Armonia nascosta: ${m.in_armonia} file su ${m.visibili} che disegnano qualcosa (${pct}%).`);
    console.log('Il piano, nell\'ordine:');
    for (const v of m.piano) console.log(`  · ${v.file} — ${v.in_armonia} su ${v.file_totali} — ${v.perche}`);
  }
}
