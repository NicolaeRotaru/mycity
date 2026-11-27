'use client';

// LA PAGINA VENDITORE DI SDG: GLI ORDINI DI SERVIZIO — 27/11/2026 (migrazione 999c).
// L'area /seller fa entrare negozi approvati e l'admin; i dati li dà solo /api/sdg/ordini, che risponde soltanto
// all'admin e all'account di SDG Agenzia. Un altro negozio che apre l'indirizzo legge il rifiuto, non gli ordini.
import OrdiniSdg from '@/components/sdg/OrdiniSdg';

export default function PaginaOrdiniSdg() {
  return <OrdiniSdg />;
}
