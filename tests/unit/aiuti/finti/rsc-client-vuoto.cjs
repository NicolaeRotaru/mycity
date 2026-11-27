// Segnaposto di react-server-dom-webpack/client per le prove che caricano la coda dei cambi pagina
// di Next senza il suo costruttore. Serve solo a chi chiede le pagine al server, che in quelle prove
// è finto: se qualcuno lo chiama davvero, lo dice invece di rispondere a caso.
const nonQui = () => {
  throw new Error('react-server-dom-webpack/client: nelle prove la risposta del server è finta');
};
module.exports = { createFromFetch: nonQui, createFromReadableStream: nonQui, createTemporaryReferenceSet: nonQui, encodeReply: nonQui };
