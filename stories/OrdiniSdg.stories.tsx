import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrdiniSdg from '@/components/sdg/OrdiniSdg';
import { pianoDelPrimoMese } from '@/lib/agenzia/piano-del-primo-mese';
import { fraseVisita } from '@/lib/agenzia/visita';

/**
 * La pagina degli ordini di SDG (27/11/2026) con DATI FINTI: due attività inventate, una Business con la visita
 * fissata e la scheda dell'agente, una Base con la visita da fissare. La rotta /api/sdg/ordini qui è finta: la
 * storia sostituisce `fetch` solo dentro Storybook.
 */
const caffe = pianoDelPrimoMese({ nome: 'Caffè della Piazza', tipo: 'bar', fascia: 'business', indirizzo: 'Piazza Duomo 3, Piacenza', citta: 'Piacenza', visitaIl: '2026-12-03T09:00:00Z' });
const forno = pianoDelPrimoMese({ nome: 'Forno San Rocco', tipo: 'negozio', fascia: 'base', indirizzo: 'Via Roma 12, Piacenza', citta: 'Piacenza', accettatoIl: '2026-11-27T15:10:00Z' });

const ORDINI = [
  {
    id: 'o-1', seller_id: 's-1', nome_attivita: 'Caffè della Piazza', fascia: 'business', canone_centesimi: 50000, primo_mese_centesimi: 25000,
    visita_il: '2026-12-03T09:00:00Z', visita: fraseVisita('2026-12-03T09:00:00Z'), agente_email: 'agente.prova@esempio.it', lavoro: null,
    accettato_il: '2026-11-27T16:25:00Z', piano: caffe, piano_origine: 'sito', piano_completo_stato: 'in_corso', lavoro_piano: 'l-1',
    piano_completo_errore: null, piano_completo_il: null, creato_il: '2026-11-27T16:25:01Z', aggiornato_il: '2026-11-27T16:25:05Z',
    dati_attivita: {
      tipo: 'bar', dettaglio: 'Bar e caffetteria', indirizzo: 'Piazza Duomo 3, Piacenza', citta: 'Piacenza',
      dallaScheda: {
        tipo: 'Bar di piazza con dehors', sito: null, social: [{ canale: 'Instagram', fonte: 'https://www.instagram.com/esempio' }],
        perche: 'Il locale ha un dehors sulla piazza e un Instagram fermo da mesi: il Business porta video veri e tre post a settimana.',
        servizi: { social: 'Riprendiamo l’Instagram fermo con tre post a settimana e due video brevi girati nel dehors.', sito_web: 'Il locale non ha un sito: nasce un sito di più pagine col menu della colazione.' },
      },
    },
  },
  {
    id: 'o-2', seller_id: 's-2', nome_attivita: 'Forno San Rocco', fascia: 'base', canone_centesimi: 30000, primo_mese_centesimi: 15000,
    visita_il: null, visita: fraseVisita(null), agente_email: null, lavoro: null,
    accettato_il: '2026-11-27T15:10:00Z', piano: forno, piano_origine: 'sito', piano_completo_stato: 'da_collegare', lavoro_piano: null,
    piano_completo_errore: 'l’AD non è partito: n8n non risponde', piano_completo_il: null, creato_il: '2026-11-27T15:10:01Z', aggiornato_il: '2026-11-27T15:10:02Z',
    dati_attivita: { tipo: 'negozio', dettaglio: 'Panificio', indirizzo: 'Via Roma 12, Piacenza', citta: 'Piacenza', dallaScheda: null },
  },
];

function ConDatiFinti({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  React.useState(() => {
    const vero = window.fetch.bind(window);
    window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url) === '/api/sdg/ordini' && (!init || !init.method || init.method === 'GET')
        ? new Response(JSON.stringify({ ok: true, data: ORDINI }), { status: 200, headers: { 'content-type': 'application/json' } })
        : vero(url, init)) as typeof window.fetch;
    return true;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const meta: Meta<typeof OrdiniSdg> = {
  title: 'SDG/Ordini di servizio',
  component: OrdiniSdg,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <ConDatiFinti><Story /></ConDatiFinti>],
};

export default meta;
type Story = StoryObj<typeof OrdiniSdg>;

export const DueOrdini: Story = {};
