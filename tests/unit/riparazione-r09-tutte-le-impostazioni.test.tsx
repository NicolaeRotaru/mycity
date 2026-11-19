/**
 * @vitest-environment jsdom
 */
/**
 * R09-010 — «Tutte le impostazioni» (StoreDetailsEditor) smontava il modulo senza chiedere:
 * con modifiche non salvate adesso chiede conferma; senza, torna subito.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: () => undefined, isPending: false, isSuccess: false }),
  useQueryClient: () => ({ invalidateQueries: () => undefined }),
}));
vi.mock("sonner", () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/queries/keys", () => ({ queryKeys: { seller: { profile: ["p"] } }, invalidaProfiloDiChiEntrato: () => undefined }));
vi.mock("@/components/VendorForm", async () => {
  const { createElement: ce } = await import("react");
  return {
    default: ({ onDirtyChange }: { onDirtyChange?: (d: boolean) => void }) =>
      ce("button", { type: "button", id: "modifica", onClick: () => onDirtyChange?.(true) }, "modifica"),
  };
});

import StoreDetailsEditor from "@/components/seller/site/StoreDetailsEditor";

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; });

async function monta(onBack: () => void) {
  const radice = document.createElement("div");
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const profilo = {
    store_name: "Forno", store_phone: null, store_address: null, store_lat: null, store_lng: null,
    store_logo: null, store_media: [], store_description: null, store_hours: {}, store_customization: {},
  };
  await act(async () => { root.render(createElement(StoreDetailsEditor as never, { profile: profilo, onBack })); });
  const tutte = Array.from(radice.querySelectorAll("button")).find((b) => b.textContent?.includes("Tutte le impostazioni"))!;
  return { radice, tutte };
}

describe("R09-010 — «Tutte le impostazioni»", () => {
  it("senza modifiche torna subito, senza chiedere", async () => {
    const onBack = vi.fn();
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { tutte } = await monta(onBack);
    act(() => tutte.click());
    expect(conferma).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("con modifiche chiede: «no» resta, «sì» esce", async () => {
    const onBack = vi.fn();
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { radice, tutte } = await monta(onBack);
    await act(async () => { radice.querySelector<HTMLButtonElement>("#modifica")!.click(); });
    act(() => tutte.click());
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
    conferma.mockReturnValue(true);
    act(() => tutte.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
