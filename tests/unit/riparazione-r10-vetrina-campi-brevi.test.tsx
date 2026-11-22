/**
 * @vitest-environment jsdom
 */
/**
 * R10-008 R10-009 — I campi brevi del costruttore della vetrina (titolo dei blocchi, domande e
 * risposte delle FAQ, titolo della collezione) non tagliano più in silenzio col maxLength:
 * il testo resta intero e, oltre il tetto che lo schema rifiuta, l'errore lo dice.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/seller/FeaturedProductsPicker", () => ({ default: () => null }));
vi.mock("@/components/seller/site/CategorySelect", () => ({ default: () => null }));
vi.mock("@/components/seller/site/BannerFields", () => ({ default: () => null }));
vi.mock("@/components/seller/site/GalleryFields", () => ({ default: () => null }));

import SectionConfigForm from "@/components/seller/site/SectionConfigForm";

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
  await act(async () => { root.render(createElement(SectionConfigForm as never, { section, onChange: () => undefined })); });
  return radice;
}
const sezione = (type: string, config: Record<string, unknown>) => ({ id: "s1", type, enabled: true, config });
const faq = (config: Record<string, unknown>) => sezione("faq", config);
const collezione = (heading: string) => sezione("collection", { heading, source: { kind: "manual", productIds: [] }, layout: "grid" });

describe("R10-008 R10-009 — niente taglio silenzioso nella vetrina", () => {
  it("titolo del blocco testo, FAQ, video e collezione: nessun maxlength", async () => {
    const lungo = "x".repeat(150);
    const viste = [
      await monta(sezione("richText", { heading: lungo, body: "" })),
      await monta(faq({ heading: lungo, items: [{ q: "q".repeat(250), a: "a".repeat(1100) }] })),
      await monta(sezione("video", { heading: lungo, provider: "youtube", videoId: "", videoUrl: "" })),
      await monta(collezione(lungo)),
    ];
    for (const v of viste) expect(v.querySelectorAll("[maxlength]").length).toBe(0);
  });

  it("il testo incollato resta intero nel campo", async () => {
    const v = await monta(faq({ heading: "", items: [{ q: "q".repeat(250), a: "a".repeat(1100) }] }));
    const valori = Array.from(v.querySelectorAll("input,textarea")).map((e) => (e as HTMLInputElement).value);
    expect(valori).toContain("q".repeat(250));
    expect(valori).toContain("a".repeat(1100));
  });

  it("oltre il tetto lo dice sotto il campo, con i numeri", async () => {
    const v = await monta(faq({ heading: "h".repeat(121), items: [{ q: "q".repeat(201), a: "a".repeat(1001) }] }));
    const avvisi = Array.from(v.querySelectorAll('[role="alert"]')).map((e) => e.textContent ?? "");
    expect(avvisi.some((t) => /121 caratteri su 120/.test(t))).toBe(true);
    expect(avvisi.some((t) => /201 caratteri su 200/.test(t))).toBe(true);
    expect(avvisi.some((t) => /1\.?001 caratteri su 1\.?000/.test(t))).toBe(true);
    const c = await monta(collezione("c".repeat(130)));
    expect(Array.from(c.querySelectorAll('[role="alert"]')).some((e) => /130 caratteri su 120/.test(e.textContent ?? ""))).toBe(true);
  });

  it("dentro il tetto nessun errore", async () => {
    const v = await monta(faq({ heading: "h".repeat(120), items: [{ q: "q".repeat(200), a: "a" }] }));
    expect(v.querySelectorAll('[role="alert"]').length).toBe(0);
  });
});
