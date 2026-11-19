/**
 * @vitest-environment jsdom
 */
/**
 * R09-010 — Dettagli negozio e profilo (VendorForm): con modifiche non salvate il browser
 * avvisa se si chiude la pagina, un clic su un collegamento interno chiede conferma, e
 * «Tutte le impostazioni» chiede prima di smontare il modulo. A salvataggio riuscito, o senza
 * modifiche, nessun avviso.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/StoreLocationPickerLazy", () => ({ default: () => null }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce("a", { href: String(href), ...r }, children as never) };
});
vi.mock("@/components/StoreAvatar", () => ({ default: () => null }));
vi.mock("@/components/StoreMediaManager", () => ({ default: () => null }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock("react-dropzone", () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock("@/lib/storage/carica-immagine", () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => "" }));
vi.mock("@/components/seller/AccentPicker", () => ({ default: () => null }));
vi.mock("@/components/seller/CoverPicker", () => ({ default: () => null }));
vi.mock("@/components/seller/AnnouncementEditor", () => ({ default: () => null }));
vi.mock("@/components/seller/BadgePicker", () => ({ default: () => null }));
vi.mock("@/components/seller/StoreHoursEditor", () => ({ default: () => null }));
vi.mock("@/components/seller/FeaturedProductsPicker", () => ({ default: () => null }));

import VendorForm from "@/components/VendorForm";

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; });
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function monta(node: (props: Record<string, unknown>) => ReactNode, props: Record<string, unknown>) {
  const radice = document.createElement("div");
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const disegna = (p: Record<string, unknown>) => act(async () => { root.render(node(p) as never); });
  await disegna(props);
  await aspetta();
  return { radice, disegna };
}
const form = (p: Record<string, unknown>) =>
  createElement(VendorForm as never, { mode: "branding", defaultValues: { storeName: "Forno Bello" }, onSubmit: vi.fn(), ...p });
const scrivi = async (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const chiudiPagina = () => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};
const clicSuLink = (href: string) => {
  const a = document.createElement("a");
  a.href = href;
  document.body.appendChild(a);
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  a.dispatchEvent(e);
  return e.defaultPrevented;
};

describe("R09-010 — VendorForm avvisa se si esce con modifiche non salvate", () => {
  it("appena aperto non avvisa", async () => {
    await monta(form, {});
    expect(chiudiPagina()).toBe(false);
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(clicSuLink("/seller/orders")).toBe(false);
    expect(conferma).not.toHaveBeenCalled();
  });

  it("dopo una modifica avvisa alla chiusura, e il clic su un altro link chiede conferma", async () => {
    const { radice } = await monta(form, {});
    await scrivi(radice.querySelector<HTMLTextAreaElement>("textarea")!, "Pane di una volta");
    expect(chiudiPagina()).toBe(true);
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(clicSuLink("/seller/orders")).toBe(true); // «no»: resta
    expect(conferma).toHaveBeenCalledTimes(1);
    conferma.mockReturnValue(true);
    expect(clicSuLink("/seller/orders")).toBe(false); // «sì»: esce
  });

  it("tornando al valore di partenza non avvisa più", async () => {
    const { radice } = await monta(form, {});
    const t = radice.querySelector<HTMLTextAreaElement>("textarea")!;
    await scrivi(t, "x");
    expect(chiudiPagina()).toBe(true);
    await scrivi(t, "");
    expect(chiudiPagina()).toBe(false);
  });

  it("a salvataggio riuscito (saved) non avvisa; una nuova modifica sì", async () => {
    const onSubmit = vi.fn();
    const { radice, disegna } = await monta(form, { onSubmit });
    const t = radice.querySelector<HTMLTextAreaElement>("textarea")!;
    await scrivi(t, "Pane di una volta");
    await act(async () => { radice.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await aspetta();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(chiudiPagina()).toBe(true); // inviato ma non ancora riuscito
    await disegna({ onSubmit, saved: true });
    expect(chiudiPagina()).toBe(false);
    await scrivi(t, "Pane di una volta e basta");
    expect(chiudiPagina()).toBe(true);
  });

  it("dice a chi sta intorno se ci sono modifiche", async () => {
    const onDirtyChange = vi.fn();
    const { radice } = await monta(form, { onDirtyChange });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await scrivi(radice.querySelector<HTMLTextAreaElement>("textarea")!, "ciao");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});

describe("R09-010 — il profilo dice al modulo quando il salvataggio è riuscito", () => {
  it("app/seller/profile/page.tsx passa saved al VendorForm dei contatti", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/seller/profile/page.tsx", "utf8")).toContain("saved={updateContact.isSuccess}");
  });
});
