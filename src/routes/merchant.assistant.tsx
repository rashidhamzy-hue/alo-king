import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/merchant/AssistantChat";

export const Route = createFileRoute("/merchant/assistant")({
  head: () => ({ meta: [{ title: "Assistant — Alo King Merchant" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col p-4 md:h-[calc(100vh-4rem)]">
      <AssistantChat className="flex-1" />
    </div>
  ),
});
