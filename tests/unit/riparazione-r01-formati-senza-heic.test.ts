import { describe, it, expect } from 'vitest';
import { caricaImmagine } from '@/lib/storage/carica-immagine';
import { regolaDelSecchio } from '@/lib/storage/regole-secchi';
import {
  avvisoPerGliScartati,
  decidiCosaFareDelDrop,
  mappaAccept,
  tipiScrittiPerUmani,
} from '@/lib/storage/casella-di-caricamento';

/**
 * 27/11/2026 — I MESSAGGI DI FORMATO RIFIUTATO ELENCAVANO HEIC E HEIF COME CARICABILI.
 *
 * Le caselle delle storie, delle recensioni, delle foto prodotto e della vetrina non offrono piu'
 * HEIC e HEIF (nessuno li converte, e su Chrome e Android si vedono come un riquadro vuoto). Ma la
 * porta dei caricamenti, rifiutando un TIFF nelle storie, diceva «usa una foto JPG, PNG, WEBP, GIF,
 * AVIF, HEIC o HEIF»; e il cervello delle caselle diceva «Puoi caricare … HEIC o HEIF» anche dove
 * la casella li scarta. La prova esegue la porta vera con un deposito finto e il cervello vero.
 */

const UID = '11111111-2222-3333-4444-555555555555';

function depositoFinto() {
  const chiamate: string[] = [];
  const client = {
    storage: {
      from: (secchio: string) => ({
        upload: async (percorso: string) => {
          chiamate.push(`${secchio}/${percorso}`);
          return { error: null };
        },
        getPublicUrl: (percorso: string) => ({ data: { publicUrl: `https://esempio.test/${secchio}/${percorso}` } }),
      }),
    },
  };
  return { client: client as unknown as Parameters<typeof caricaImmagine>[0], chiamate };
}

async function frasePerUnTiff(secchio: string): Promise<string> {
  const d = depositoFinto();
  const tiff = new File(['x'], 'storia.tiff', { type: 'image/tiff' }) as never;
  try {
    await caricaImmagine(d.client, { file: tiff, userId: UID, secchio });
  } catch (e) {
    expect(d.chiamate, 'il file rifiutato non deve partire').toHaveLength(0);
    return (e as Error).message;
  }
  throw new Error('il TIFF doveva essere rifiutato');
}

describe('la porta dei caricamenti propone solo formati che le caselle offrono', () => {
  for (const secchio of ['stories', 'reviews', 'products']) {
    it(`IL CASO CHE ROMPEVA — un TIFF nel magazzino «${secchio}»: la frase non propone HEIC né HEIF`, async () => {
      const frase = await frasePerUnTiff(secchio);
      expect(frase).toBe('Formato non accettato: usa una foto JPG, PNG, WEBP, GIF o AVIF.');
      expect(frase).not.toMatch(/HEIC|HEIF/);
    });
  }

  it('ogni formato proposto è davvero ammesso dalla regola del magazzino', async () => {
    const frase = await frasePerUnTiff('stories');
    const ammessi = regolaDelSecchio('stories').tipiAmmessi.map((t) => t.replace('image/', '').replace('jpeg', 'jpg').toUpperCase());
    const proposti = frase.replace(/^.*usa una foto /, '').replace(/\.$/, '').split(/, | o /);
    for (const p of proposti) expect(ammessi, `${p} non è ammesso`).toContain(p);
  });

  it('la porta non cambia cosa accetta: HEIC e HEIF passano ancora (il deposito li prende)', async () => {
    for (const tipo of ['image/heic', 'image/heif']) {
      const d = depositoFinto();
      const f = new File(['x'], 'foto.heic', { type: tipo }) as never;
      await expect(caricaImmagine(d.client, { file: f, userId: UID, secchio: 'stories' })).resolves.toBeTruthy();
      expect(d.chiamate).toHaveLength(1);
    }
  });
});

describe('il cervello delle caselle dice i formati della casella, non tutto il magazzino', () => {
  const senzaIphone = Object.fromEntries(Object.entries(mappaAccept()).filter(([t]) => !/hei[cf]$/.test(t)));
  const tiff = [{ file: { name: 'vetrina.tiff' }, errors: [{ code: 'file-invalid-type' }] }];

  it('IL CASO CHE ROMPEVA — una casella senza HEIC/HEIF non li propone a chi ha sbagliato formato', () => {
    const avviso = avvisoPerGliScartati(tiff, { postiLiberi: 3, accetta: senzaIphone });
    expect(avviso).toContain('Puoi caricare JPG, PNG, WEBP, GIF o AVIF.');
    expect(avviso).not.toMatch(/HEIC|HEIF/);
    expect(decidiCosaFareDelDrop([], tiff, { postiLiberi: 3, accetta: senzaIphone }).avviso).not.toMatch(/HEIC|HEIF/);
  });

  it('tipiScrittiPerUmani nasce dalla lista che la casella accetta davvero', () => {
    expect(tipiScrittiPerUmani(undefined, senzaIphone)).toBe('JPG, PNG, WEBP, GIF o AVIF');
  });

  it('una casella che accetta tutto il magazzino continua a dirli tutti', () => {
    expect(tipiScrittiPerUmani()).toBe('JPG, PNG, WEBP, GIF, AVIF, HEIC o HEIF');
    expect(avvisoPerGliScartati(tiff, { postiLiberi: 3 })).toContain('HEIC o HEIF');
  });
});
