import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { MerchantGrid } from "@/components/landing/MerchantGrid";
import { GiftCalculator } from "@/components/landing/GiftCalculator";
import { CrownsCalculator } from "@/components/landing/CrownsCalculator";
import { HowItWorks, Footer } from "@/components/landing/HowItWorks";

const TITLE = "Alo King (ألو كينغ) — Order the Shouf, on WhatsApp";
const DESC =
  "Zero-download food, grocery and local delivery across the Shouf, Lebanon. Text or voice-note on WhatsApp, with AI macro tracking.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <Hero />
        <MerchantGrid />
        <GiftCalculator />
        <CrownsCalculator />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  );
}
