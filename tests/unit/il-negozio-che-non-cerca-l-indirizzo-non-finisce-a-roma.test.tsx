/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 — IL NEGOZIO CHE SCRIVE L INDIRIZZO SENZA PREMERE «CERCA» FINIVA A ROMA.
 *
 * Il selettore della posizione partiva da Roma (41.9028, 12.4964) e, se il negozio non aveva ancora
 * una posizione, mandava subito quelle coordinate al modulo come se fossero le sue. Chi scriveva
 * l indirizzo e salvava senza «Cerca» metteva il negozio a 500 km da Piacenza: fuori dal raggio di
 * consegna, nessun cliente poteva ordinargli una consegna.
 *
 * Qui il selettore si MONTA (Leaflet è finto: in jsdom non c è una mappa vera) e si guarda cosa
 * arriva al modulo. La regola: il punto in cui si apre la mappa arriva con `confermata: false`;
 * solo «Cerca», il GPS o un tocco sulla mappa lo confermano. E il tocco tiene l indirizzo scritto.
 *
 * Cosa NON prova: il geocodificatore vero (/api/geocode) né un browser vero.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const mappa = vi.hoisted(() => ({ click: null as null | ((e: { latlng: { lat: number; lng: number } }) => void) }));

vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("leaflet", () => {
  const sempreSe = (base: Record<string, unknown>): Record<string, unknown> => {
    const p: Record<string, unknown> = new Proxy(base, {
      get: (t, k) => (k === "then" ? undefined : k in t ? t[k as string] : () => p),
    });
    return p;
  };
  const marker = sempreSe({ getLatLng: () => ({ lat: 0, lng: 0 }) });
  const map = sempreSe({
    on: (evento: string, fn: (e: { latlng: { lat: number; lng: number } }) => void) => {
      if (evento === "click") mappa.click = fn;
      return map;
    },
  });
  const L = {
    Icon: { Default: { prototype: {}, mergeOptions: () => undefined } },
    map: () => map,
    tileLayer: () => sempreSe({}),
    marker: () => marker,
  };
  return { default: L };
});

import StoreLocationPicker, { type StoreLocation } from "@/components/StoreLocationPicker";

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  mappa.click = null;
});

async function apri(defaultValue: Partial<StoreLocation>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const onChange = vi.fn<(l: StoreLocation) => void>();
  const radice = document.createElement("div");
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(StoreLocationPicker, { defaultValue, onChange }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const ultima = () => onChange.mock.calls.at(-1)?.[0] as StoreLocation;
  return { radice, onChange, ultima };
}

function scrivi(input: HTMLInputElement, valore: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, valore);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const aPiacenza = (l: StoreLocation) => l.lat > 44.9 && l.lat < 45.2 && l.lng > 9.5 && l.lng < 9.9;

describe("il punto in cui si apre la mappa non è la posizione del negozio", () => {
  it("senza posizione salvata, al modulo arriva una posizione NON confermata, e non a Roma", async () => {
    const s = await apri({ address: undefined, lat: undefined, lng: undefined });
    const appena = s.ultima();
    expect(appena, "il selettore deve dire al modulo dove si apre").toBeTruthy();
    expect(appena.confermata, "il punto di partenza arrivava al modulo come se fosse il negozio").toBe(false);
    expect(aPiacenza(appena), `la mappa si apriva a ${appena.lat}, ${appena.lng}`).toBe(true);

    scrivi(s.radice.querySelector("input[type=text]") as HTMLInputElement, "Via Roma 10, Piacenza");
    const scritto = s.ultima();
    expect(scritto.address).toBe("Via Roma 10, Piacenza");
    expect(scritto.confermata, "scrivere l indirizzo senza «Cerca» non dà una posizione").toBe(false);
  });

  it("toccare la mappa conferma la posizione e tiene l indirizzo appena scritto", async () => {
    const s = await apri({ address: undefined, lat: undefined, lng: undefined });
    scrivi(s.radice.querySelector("input[type=text]") as HTMLInputElement, "Via Roma 10, Piacenza");
    expect(mappa.click, "la mappa finta non ha registrato il tocco").toBeTypeOf("function");
    act(() => mappa.click!({ latlng: { lat: 45.06, lng: 9.7 } }));
    expect(s.ultima()).toEqual({ address: "Via Roma 10, Piacenza", lat: 45.06, lng: 9.7, confermata: true });
  });

  it("una posizione già salvata è confermata", async () => {
    const s = await apri({ address: "Via Cavour 3", lat: 45.051, lng: 9.695 });
    expect(s.ultima()).toEqual({ address: "Via Cavour 3", lat: 45.051, lng: 9.695, confermata: true });
  });

  it("chi era stato salvato sul vecchio punto di Roma non ha una posizione, e glielo diciamo", async () => {
    const s = await apri({ address: "Via Cavour 3", lat: 41.9028, lng: 12.4964 });
    expect(s.ultima().confermata).toBe(false);
    expect(s.radice.textContent).toContain("non è il tuo negozio");
  });
});
