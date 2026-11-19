/**
 * @vitest-environment jsdom
 */
/**
 * R09-008 — I campi brevi del costruttore della home non tagliano più in silenzio: il testo
 * incollato resta intero e, oltre il tetto che lo schema rifiuta, l'errore lo dice.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/ImageUrlField", () => ({ ImageUrlField: () => null }));

import HomeSectionConfigForm from "@/components/admin/home/HomeSectionConfigForm";

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

async function monta(section: unknown) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement("div");
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(createElement(HomeSectionConfigForm as never, { section, onChange: () => undefined })); });
  return radice;
}
const hero = (config: Record<string, unknown>) => ({ id: "h1", type: "hero", enabled: true, config });
const newsletter = (config: Record<string, unknown>) => ({ id: "n1", type: "newsletter", enabled: true, config });

describe("R09-008 — niente taglio silenzioso", () => {
  it("nessun campo di testo ha più maxLength (titolo, sottotitolo, testo della newsletter)", async () => {
    const a = await monta(hero({ headline: "x".repeat(250), subhead: "y".repeat(400) }));
    expect(a.querySelectorAll("[maxlength]").length).toBe(0);
    const b = await monta(newsletter({ body: "z".repeat(450) }));
    expect(b.querySelectorAll("[maxlength]").length).toBe(0);
  });

  it("il testo incollato oltre il tetto resta intero e il campo dice di accorciarlo", async () => {
    const r = await monta(hero({ headline: "x".repeat(250), subhead: "ok" }));
    const t = Array.from(r.querySelectorAll("textarea"));
    expect(t[0].value.length).toBe(250);
    const errori = Array.from(r.querySelectorAll('[role="alert"]')).map((e) => e.textContent ?? "");
    expect(errori).toHaveLength(1);
    expect(errori[0]).toContain("250 caratteri su 200");
  });

  it("dentro il tetto nessun errore, e gli spazi in coda non contano (lo schema li toglie)", async () => {
    const r = await monta(hero({ headline: "x".repeat(200) + "   ", subhead: "y".repeat(320) }));
    expect(r.querySelectorAll('[role="alert"]').length).toBe(0);
  });
});
