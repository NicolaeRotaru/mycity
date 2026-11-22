/**
 * R07-007 (collaudo, 22/11/2026) — ASPETTARE IL POPSTATE VERO, NON UN TEMPO FISSO.
 *
 * jsdom manda il popstate di history.back() dopo tre giri di setTimeout(0) (SessionHistory:
 * coda del ritorno, ritorno, eventi), e il hook dei pannelli ne aggiunge uno suo dopo il popstate.
 * Le prove aspettavano 20-30 ms fissi: sotto carico i giri partono dopo la scadenza, l'attesa finisce
 * prima del popstate e la prova cade a caso (3 cadute su circa 16 giri in parallelo).
 *
 * Qui si conta ogni history.back() e ogni popstate, e si fanno girare i compiti uno alla volta finché
 * ogni back() ha avuto il suo popstate e per qualche giro non cambia più niente (indirizzo, stato
 * della voce, lunghezza della cronologia). Non conta il tempo, conta l'ordine dei compiti.
 */
import { act } from 'react';

let attesi = 0;
let installato = false;

/** Da chiamare una volta per file, prima di qualunque history.back(). */
export function installaCronologia() {
  if (installato) return;
  installato = true;
  const back = window.history.back.bind(window.history);
  window.history.back = () => {
    attesi += 1;
    back();
  };
  window.addEventListener('popstate', () => {
    if (attesi > 0) attesi -= 1;
  });
}

const giro = () => new Promise<void>((fatto) => setTimeout(fatto, 0));

function fotografia() {
  let stato = '';
  try {
    stato = JSON.stringify(window.history.state) ?? '';
  } catch {
    stato = String(window.history.state);
  }
  return `${attesi}|${window.location.href}|${window.history.length}|${stato}`;
}

/**
 * Fa girare i compiti finché ogni history.back() ha avuto il suo popstate e la cronologia resta
 * ferma per `giriFermi` giri di fila. Oltre `massimo` giri la prova cade con un messaggio chiaro,
 * invece di restare appesa.
 */
export async function aspettaLaCronologia({ giriFermi = 5, massimo = 2000 } = {}) {
  const conAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT === true;
  let fermi = 0;
  for (let i = 0; i < massimo; i += 1) {
    const prima = fotografia();
    if (conAct) await act(async () => { await giro(); });
    else await giro();
    if (attesi === 0 && fotografia() === prima) {
      fermi += 1;
      if (fermi >= giriFermi) return;
    } else {
      fermi = 0;
    }
  }
  throw new Error(`la cronologia non si ferma: ${attesi} history.back() ancora senza il loro popstate`);
}
