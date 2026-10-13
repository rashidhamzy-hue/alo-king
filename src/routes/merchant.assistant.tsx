import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/merchant/AssistantChat";
import { OnboardingPanel } from "@/components/merchant/OnboardingPanel";
import { MERCHANT_ASSISTANT_LIVE } from "@/lib/site-config";

export const Route = createFileRoute("/merchant/assistant")({
  head: () => ({
    meta: [{ title: "Assistant — Alo King Merchant" }, { name: "robots", content: "noindex" }],
  }),
  // While the assistant is not connected (MERCHANT_ASSISTANT_LIVE), this page shows the setup checklist, not a chat that cannot answer.
  component: () =>
    MERCHANT_ASSISTANT_LIVE ? (
      <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col p-4 md:h-[calc(100vh-4rem)]">
        <AssistantChat className="flex-1" />
      </div>
    ) : (
      <div className="mx-auto max-w-2xl p-4 md:p-8">
        <div className="ak-card overflow-hidden">
          <OnboardingPanel />
        </div>
      </div>
    ),
});
