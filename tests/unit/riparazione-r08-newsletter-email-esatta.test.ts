/**
 * R08-003 — LA CANCELLAZIONE DI UN ACCOUNT DISISCRIVEVA ANCHE CHI AVEVA UN'EMAIL SIMILE.
 *
 * `togliDallaNewsletter` cancellava con `ilike('email', emailUtente)`: in un `ilike` il trattino
 * basso vale «una lettera qualsiasi» e il percento «qualunque cosa» (PostgREST legge anche `*` come
 * percento). Chi cancellava mario_rossi@x.it toglieva dalla lista anche mario.rossi@x.it, che non
 * aveva chiesto niente.
 *
 * Supabase finto, in memoria (nessun database vero): il filtro `ilike` fa quello che fa Postgres.
 */
import { describe, expect, it } from 'vitest';
import { togliDallaNewsletter } from '@/lib/account/cancellazione';

/** ILIKE come in Postgres (escape `\`), più l'alias `*` → `%` di PostgREST. */
function ilike(valore: string, modello: string): boolean {
  let re = '';
  for (let i = 0; i < modello.length; i++) {
    const c = modello[i];
    if (c === '\\' && i + 1 < modello.length) re += modello[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '%' || c === '*') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is').test(valore);
}

function fintoAdmin(emailUtente: string, iscritti: string[]) {
  const lista = iscritti.map((email, i) => ({ id: `n${i}`, email }));
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: emailUtente } }, error: null }) } },
    from(tabella: string) {
      return {
        delete() {
          return {
            ilike: async (colonna: string, modello: string) => {
              if (tabella !== 'newsletter_subscribers' || colonna !== 'email') return { error: { message: 'tabella sbagliata' } };
              for (let i = lista.length - 1; i >= 0; i--) if (ilike(lista[i].email, modello)) lista.splice(i, 1);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { admin, rimasti: () => lista.map((r) => r.email) };
}

describe('R08-003 · si toglie dalla newsletter solo l’indirizzo di chi se ne va', () => {
  it('mario_rossi@x.it se ne va: mario.rossi@x.it resta iscritto', async () => {
    const { admin, rimasti } = fintoAdmin('mario_rossi@x.it', ['mario_rossi@x.it', 'mario.rossi@x.it', 'marioXrossi@x.it']);

    expect(await togliDallaNewsletter(admin as never, 'u1')).toBeNull();

    expect(rimasti(), 'disiscritta un’altra persona con un’email simile').toEqual(['mario.rossi@x.it', 'marioXrossi@x.it']);
  });

  it('il percento nell’indirizzo è una lettera, non «qualunque cosa»', async () => {
    const { admin, rimasti } = fintoAdmin('a%b@x.it', ['a%b@x.it', 'anna.b@x.it']);

    await togliDallaNewsletter(admin as never, 'u2');

    expect(rimasti()).toEqual(['anna.b@x.it']);
  });

  it('un asterisco (che PostgREST legge come percento) non disiscrive nessun altro', async () => {
    const { admin, rimasti } = fintoAdmin('a*b@x.it', ['anna.b@x.it']);

    expect(await togliDallaNewsletter(admin as never, 'u3')).toBeNull();

    expect(rimasti()).toEqual(['anna.b@x.it']);
  });

  it('le maiuscole non contano: Mario_Rossi@X.it toglie mario_rossi@x.it', async () => {
    const { admin, rimasti } = fintoAdmin('Mario_Rossi@X.it', ['mario_rossi@x.it', 'mario.rossi@x.it']);

    await togliDallaNewsletter(admin as never, 'u4');

    expect(rimasti()).toEqual(['mario.rossi@x.it']);
  });
});
