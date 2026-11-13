/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R21-011 — L'INFORMATIVA PROMETTEVA DI DARE I DATI SOLO AL NEGOZIO E AL RIDER, MA NON LI ELENCAVA
 * FRA I DESTINATARI, E METTEVA IL DATABASE NEGLI STATI UNITI.
 *
 * Il 5/11 il riassunto ha perso il «solo», negozio e Rider sono entrati nella sezione 4 e Supabase è
 * passato a Parigi. Restava il ruolo: la sezione si intitolava «sub-responsabili», e il negozio non lo
 * è. Riceve nome, telefono e indirizzo come titolare autonomo, come dicono i Termini (punto 9).
 *
 * La prova monta la pagina vera e legge la sezione come la legge chi la apre. Il luogo del database
 * non lo prende per buono: lo confronta con la scheda dell'hosting del repository.
 */

let Pagina: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Pagina = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

function leggi<T>(fai: (radice: HTMLElement) => T): T {
  const s = accendi(Pagina);
  try {
    return fai(s.radice);
  } finally {
    s.smonta();
  }
}

describe('R21-011 · chi riceve i dati, e in che ruolo', () => {
  it('IL CASO CHE ROMPEVA — la sezione non chiama «sub-responsabili» anche il negozio', () => {
    const titolo = leggi((r) => testoVisibile(r.querySelector('#destinatari h2')));
    expect(titolo, 'la sezione dei destinatari non è comparsa').toMatch(/Destinatari/);
    expect(titolo).not.toMatch(/sub-responsabil/i);
  }, 60000);

  it('IL CASO CHE ROMPEVA — il negozio è fra i destinatari, come titolare autonomo, solo per l ordine', () => {
    const paragrafi = leggi((r) => Array.from(r.querySelectorAll('#destinatari p')).map((p) => testoVisibile(p)));
    const negozio = paragrafi.find((t) => /negozio da cui compri/i.test(t));
    expect(negozio, 'il negozio non compare fra i destinatari').toBeTruthy();
    expect(negozio).toMatch(/titolare autonomo/);
    expect(negozio).toMatch(/nome, telefono, indirizzo/);
    expect(paragrafi.some((t) => /Rider che consegna/.test(t)), 'il Rider non compare fra i destinatari').toBe(true);
    // E coincide con quello che il negozio accetta nei Termini.
    expect(readFileSync('app/terms/page.tsx', 'utf8')).toMatch(/Venditore riceve nome,\s+telefono e indirizzo[\s\S]{0,80}titolare autonomo/);
  }, 60000);

  it('il riassunto non promette «solo» negozio e Rider, e il database sta dove sta davvero', () => {
    const { riassunto, supabase } = leggi((r) => ({
      riassunto: testoVisibile(r),
      supabase: Array.from(r.querySelectorAll('#destinatari li')).map((li) => testoVisibile(li)).find((t) => /Supabase/.test(t)) ?? '',
    }));
    expect(riassunto).not.toMatch(/condividiamo solo con il negozio/i);
    const hosting = readFileSync('docs/hosting-vercel.md', 'utf8');
    expect(hosting, 'la scheda dell hosting non dice più dove sta il database').toMatch(/\*\*Parigi\*\*, regione `eu-west-3`/);
    expect(supabase).toMatch(/Unione europea, a Parigi/);
    expect(supabase).not.toMatch(/^Supabase Inc\. \(Stati Uniti/);
  }, 60000);
});
