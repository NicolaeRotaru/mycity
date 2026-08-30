/**
 * Compila un componente React di questa repo in un modulo che una prova può
 * eseguire davvero.
 *
 * Perché esiste: il `tsconfig.json` di Next dice `jsx: "preserve"`, quindi
 * vitest non sa trasformare un `.tsx` e nessuna prova di questa casa riusciva a
 * MONTARE un componente — si finiva per cercare parole nei file, che è proprio
 * la prova che qui non vale. Questo script gira in un processo Node suo (esbuild
 * non parte dentro l'ambiente jsdom) e produce un file eseguibile.
 *
 * Uso: node compila.mjs <file-nella-repo> <file-di-uscita>
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, '../../..');
const FINTI = path.join(QUI, 'finti');

/** I pacchetti che fuori da Next non partono, o che qui devono restare prevedibili. */
const FINTI_PER_NOME = {
  'next/link': path.join(FINTI, 'next-link.mjs'),
  'next/navigation': path.join(FINTI, 'next-navigation.mjs'),
  'next/image': path.join(FINTI, 'next-image.mjs'),
  '@tanstack/react-query': path.join(FINTI, 'react-query.mjs'),
  '@/lib/supabase/client': path.join(FINTI, 'supabase-client.mjs'),
  'next-intl': path.join(FINTI, 'next-intl.mjs'),
  leaflet: path.join(FINTI, 'leaflet.mjs'),
  react: path.join(FINTI, 'react-con-use.mjs'),
  'tailwind-scrollbar-hide': path.join(FINTI, 'greggio.mjs'),
};

const [, , entrata, uscita] = process.argv;

await build({
  entryPoints: [path.resolve(RADICE, entrata)],
  absWorkingDir: RADICE,
  outfile: uscita,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  logLevel: 'silent',
  alias: { '@': RADICE },
  plugins: [
    {
      // I finti vincono sui pacchetti veri; tutto il resto resta FUORI dal
      // pacchetto, così react e react-dom restano una copia sola — quella che
      // usa la prova, altrimenti gli hook non partono.
      name: 'finti-e-pacchetti-fuori',
      setup(b) {
        // Un foglio di stile importato da un componente non ha niente da dire
        // a una prova, ma Node non sa importarlo: qui diventa un modulo vuoto.
        b.onResolve({ filter: /\.css$/ }, () => ({ path: path.join(FINTI, 'foglio-di-stile.mjs') }));
        // `useProfile` è importato per percorso relativo da mezza repo: qui si
        // intercetta comunque sia scritto.
        b.onResolve({ filter: /(^|\/)hooks\/useProfile$/ }, () => ({
          path: path.join(FINTI, 'use-profile.mjs'),
        }));
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          const finto = FINTI_PER_NOME[args.path];
          // Un finto che importa il pacchetto vero non deve ritrovare se stesso.
          if (finto && finto !== args.importer) return { path: finto };
          if (args.path.startsWith('@/')) return null;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
