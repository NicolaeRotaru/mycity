import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LavoraConNoiPage, { metadata } from '@/app/lavora-con-noi/page';

/**
 * R28-007 — «Lavora con noi» non promette più un lavoro da rider con compenso fisso e turni,
 * né rimanda a «posizioni» con un pulsante: il percorso del fattorino è condizionale, quello del team
 * è la candidatura spontanea per email.
 */
const html = renderToStaticMarkup(createElement(LavoraConNoiPage));
const testo = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('R28-007 · «Lavora con noi» dice solo quello che oggi è vero', () => {
  it('nessuna promessa di compenso fisso, turni o rider', () => {
    expect(testo).not.toMatch(/compenso fisso per ogni consegna/i);
    expect(testo).not.toMatch(/scegli i tuoi turni/i);
    expect(testo).not.toMatch(/Diventa rider|Candidati come rider/);
    expect(testo).not.toMatch(/negozianti, rider/);
    expect(testo).not.toMatch(/ibride/);
    expect(testo).toMatch(/non promettiamo né turni né un compenso fisso/);
  });
  it('i metadata non parlano di rider né di «entra nel team»', () => {
    const m = JSON.stringify(metadata);
    expect(m).not.toMatch(/rider|entra nel team/i);
  });
  it('«Entra nel team / Vedi le posizioni» è diventato una candidatura spontanea per email', () => {
    expect(testo).not.toMatch(/Entra nel team|Vedi le posizioni/);
    const link = html.split('<a ').find((x) => /Scrivici<\/span>/.test(x.split('</a>')[0])) ?? '';
    const href = link.match(/href="([^"]+)"/)?.[1] ?? '';
    expect(href).toMatch(/^mailto:/);
    expect(decodeURIComponent(href.replace(/&amp;/g, '&'))).toMatch(/Candidatura spontanea/);
  });
  it('la strada del fattorino resta quella dell iscrizione (la stessa della FAQ)', () => {
    expect(html).toContain('/sign-up?role=rider');
  });
});
