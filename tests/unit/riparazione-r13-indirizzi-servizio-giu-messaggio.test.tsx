/**
 * @vitest-environment jsdom
 */
/**
 * R13-005 prova del messaggio: servizio giù o limitato contro indirizzo non trovato.
 * (Montaggio come nella prova gemella dell'indirizzo senza «Cerca».)
 *
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


async function cerca(risposta: { status: number; body: unknown }) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(risposta.body), { status: risposta.status }));
  const s = await apri({ address: undefined, lat: undefined, lng: undefined });
  scrivi(s.radice.querySelector("input[type=text]") as HTMLInputElement, "Via Roma 10, Piacenza");
  const bottone = Array.from(s.radice.querySelectorAll("button")).find((b) => /cerca/i.test(b.textContent ?? "") && !/posizione/i.test(b.textContent ?? ""));
  expect(bottone, "bottone Cerca non trovato").toBeTruthy();
  await act(async () => {
    bottone!.click();
    await new Promise((r) => setTimeout(r, 20));
  });
  return s.radice.textContent ?? "";
}

afterEach(() => vi.unstubAllGlobals());

describe("il messaggio del selettore distingue servizio giù da indirizzo non trovato", () => {
  it("servizio giù (503): dice che non risponde e di riprovare, non «non trovato»", async () => {
    const t = await cerca({ status: 503, body: { lat: null, lng: null, error: "servizio_non_disponibile" } });
    expect(t).toContain("non risponde");
    expect(t).toContain("Riprova fra poco");
    expect(t).not.toContain("Indirizzo non trovato");
  });
  it("limitato (429): stesso messaggio", async () => {
    const t = await cerca({ status: 429, body: { lat: null, lng: null, error: "rate_limited" } });
    expect(t).toContain("Riprova fra poco");
    expect(t).not.toContain("Indirizzo non trovato");
  });
  it("nessun risultato (200 con null): «Indirizzo non trovato»", async () => {
    const t = await cerca({ status: 200, body: { lat: null, lng: null } });
    expect(t).toContain("Indirizzo non trovato");
    expect(t).not.toContain("non risponde");
  });
});
