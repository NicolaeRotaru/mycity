/**
 * Leaflet in finto. Non disegna niente, ma REGISTRA i segnaposti che gli
 * vengono chiesti in `globalThis.__SEGNAPOSTI__`: così una prova può guardare
 * se dentro un segnaposto c'è qualcosa da leggere o solo una forma colorata.
 */
const mappa = {
  setView() { return mappa; },
  fitBounds() { return mappa; },
  remove() {},
  addLayer() { return mappa; },
};

const L = {
  Icon: { Default: { prototype: {}, mergeOptions() {} } },
  map: () => mappa,
  tileLayer: () => ({ addTo: () => ({}) }),
  divIcon: (opzioni) => {
    (globalThis.__SEGNAPOSTI__ ??= []).push(opzioni);
    return opzioni;
  },
  marker: () => {
    const m = {
      bindTooltip: () => m,
      addTo: () => m,
      remove: () => m,
    };
    return m;
  },
};

export default L;
