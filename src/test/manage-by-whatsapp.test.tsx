import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageByWhatsAppCard } from "@/components/merchant/ManageByWhatsApp";
import { LangProvider } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LangProvider>
        <ManageByWhatsAppCard vendorId="v1" />
      </LangProvider>
    </QueryClientProvider>,
  );
}

describe("Manage by WhatsApp card", () => {
  beforeEach(() => rpc.mockReset());

  it("shows the unlinked state and generates a link code with a wa.me link", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_owner_console") return { data: { linked: false, owner_phone: null, credits_usd: 10 }, error: null };
      if (fn === "create_owner_link_code") return { data: "ALO-TEST42", error: null };
      return { data: null, error: { message: "unexpected " + fn } };
    });
    setup();
    expect(await screen.findByText("Not linked")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate link code/i }));
    expect(await screen.findByText("ALO-TEST42")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("create_owner_link_code", { p_vendor: "v1" });
    expect(screen.getByRole("link", { name: /open whatsapp/i })).toHaveAttribute("href", expect.stringContaining("?text=ALO-TEST42"));
  });

  it("shows the linked state with a masked number and the credit", async () => {
    rpc.mockResolvedValue({ data: { linked: true, owner_phone: "96171123456", credits_usd: 9.5 }, error: null });
    setup();
    expect(await screen.findByText("Linked")).toBeInTheDocument();
    expect(screen.getByText("+961 ••• ••• 56")).toBeInTheDocument();
    expect(screen.getByText("$9.50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /link a different number/i })).toBeInTheDocument();
  });

  it("surfaces an error from get_owner_console", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not allowed" } });
    setup();
    await waitFor(() => expect(screen.getByText(/not allowed/i)).toBeInTheDocument());
  });
});
