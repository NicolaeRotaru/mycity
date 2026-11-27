import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import AdessoToccaASdg from '@/app/agente/tocca-a-sdg/page';
import { passiDiSdg } from '@/lib/agenti/passi-di-sdg';
import { fraseVisita } from '@/lib/agenzia/visita';

/**
 * La pagina «Adesso tocca a SDG» dell'agente (27/11/2026) con DATI FINTI: un bar inventato che ha appena confermato
 * il Business, con la visita fissata e la scheda dell'agente. /api/agente/attivita qui è finta: la storia sostituisce
 * `fetch` e mette il codice della scheda nell'indirizzo, solo dentro Storybook.
 */
const LAVORO = '11111111-2222-4333-8444-555555555555';
const VISITA = '2026-12-03T09:00:00Z';
const ATTIVITA = {
  stato: 'accettato', nome: 'Caffè della Piazza', fascia: 'business', accettatoIl: '2026-11-27T16:25:00Z', visitaIl: VISITA, visita: fraseVisita(VISITA), link: null,
  ordine: { pianoOrigine: 'sito', pianoStato: 'in_corso', contenuti: 12, periodo: 'dal 7 dicembre 2026 al 3 gennaio 2027' },
  passi: passiDiSdg({
    nome: 'Caffè della Piazza', fascia: 'business', visitaIl: VISITA, canoneCentesimi: 50000, primoMeseCentesimi: 25000,
    pianoNellOrdine: { origine: 'sito', stato: 'in_corso' },
    suMisura: { social: 'Riprendiamo l’Instagram fermo con tre post a settimana e due video brevi girati nel dehors.', sito_web: 'Il locale non ha un sito: nasce un sito di più pagine col menu della colazione.' },
  }),
};

function ConDatiFinti({ children }: { children: React.ReactNode }) {
  React.useState(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('lavoro', LAVORO);
    window.history.replaceState(null, '', u.toString());
    const vero = window.fetch.bind(window);
    window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).startsWith('/api/agente/attivita')
        ? new Response(JSON.stringify({ ok: true, data: ATTIVITA }), { status: 200, headers: { 'content-type': 'application/json' } })
        : vero(url, init)) as typeof window.fetch;
    return true;
  });
  return <>{children}</>;
}

const meta: Meta<typeof AdessoToccaASdg> = {
  title: 'Agenti/Adesso tocca a SDG',
  component: AdessoToccaASdg,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <ConDatiFinti><Story /></ConDatiFinti>],
};

export default meta;
type Story = StoryObj<typeof AdessoToccaASdg>;

export const BusinessConVisita: Story = {};
