import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ar } from "@/content/ar";
import { en } from "@/content/en";
import { SiteProvider } from "@/components/site/context";
import { ItemExtras, ItemFacts } from "@/components/site/ItemView";
import { EMPTY_OVERVIEW, type SiteItemPage } from "@/lib/site-data";
import type { SiteLang } from "@/lib/site";

const facts = (d: Pick<SiteItemPage, "nutrition" | "allergens">, lang: SiteLang = "en") =>
  render(
    <SiteProvider
      value={{
        lang,
        side: "customer",
        t: lang === "ar" ? ar : en,
        info: { origin: "", indexing: false },
        overview: EMPTY_OVERVIEW,
      }}
    >
      <ItemFacts d={d} />
    </SiteProvider>,
  );

describe("item page: nutrition and allergens (§32.3, §38.3)", () => {
  it("has no allergens block when the shop declared none, and still shows the kitchen note", () => {
    const { container } = facts({ nutrition: null, allergens: null });
    expect(screen.queryByRole("heading", { name: en.item.allergens })).toBeNull();
    expect(screen.queryByText(/Contains/)).toBeNull();
    expect(screen.queryByText(en.item.declared)).toBeNull();
    expect(container.textContent).not.toMatch(/\bnone\b|\bsafe\b|free from/i);
    expect(screen.getByText(en.vendor.kitchenNote)).toBeInTheDocument();
  });
  it("lists the declared allergens as the shop's declaration", () => {
    facts({ nutrition: null, allergens: ["gluten", "sesame"] });
    expect(screen.getByRole("heading", { name: "Allergens" })).toBeInTheDocument();
    expect(screen.getByText("Contains: gluten, sesame")).toBeInTheDocument();
    expect(screen.getByText("Declared by the shop.")).toBeInTheDocument();
  });
  it("labels nutrition as estimated, or as the shop's own", () => {
    const n = { kcal: 520, protein_g: 31.5, carbs_g: 48, fat_g: null };
    const { unmount } = facts({ nutrition: { ...n, status: "estimated" }, allergens: null });
    expect(screen.getByRole("heading", { name: "Estimated nutrition" })).toBeInTheDocument();
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(screen.getByText("520 kcal")).toBeInTheDocument();
    expect(screen.getByText("31.5 g")).toBeInTheDocument();
    expect(screen.queryByText(en.item.fat)).toBeNull();
    unmount();
    facts({ nutrition: { ...n, status: "merchant_verified" }, allergens: null });
    expect(screen.getByRole("heading", { name: "Nutrition" })).toBeInTheDocument();
    expect(screen.getByText("From the shop")).toBeInTheDocument();
  });
  it("writes the list the Arabic way in Arabic", () => {
    facts({ nutrition: null, allergens: ["gluten", "dairy"] }, "ar");
    expect(screen.getByText("فيه: الغلوتين، مشتقات الحليب")).toBeInTheDocument();
  });
});

describe("item page: extras", () => {
  it("shows each group's rule and a price only on paid options", () => {
    render(
      <SiteProvider
        value={{
          lang: "en",
          side: "customer",
          t: en,
          info: { origin: "", indexing: false },
          overview: EMPTY_OVERVIEW,
        }}
      >
        <ItemExtras
          groups={[
            {
              name_ar: null,
              name_en: "Size",
              name_fr: null,
              min: 1,
              max: 1,
              options: [
                { name_ar: null, name_en: "Regular", name_fr: null, price_usd: 0 },
                { name_ar: null, name_en: "Large", name_fr: null, price_usd: 1.5 },
              ],
            },
          ]}
        />
      </SiteProvider>,
    );
    expect(screen.getByText("Choose 1")).toBeInTheDocument();
    expect(screen.getByText("+$1.50")).toBeInTheDocument();
    expect(screen.getAllByText(/^\+\$/)).toHaveLength(1);
  });
});
