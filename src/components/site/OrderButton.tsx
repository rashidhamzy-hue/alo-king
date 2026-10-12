import { Link } from "@tanstack/react-router";
import { WhatsAppIcon } from "@/design/icons";
import { waLink } from "@/lib/site";
import { useSite } from "./context";

/**
 * "Order on WhatsApp" (§37.1): a wa.me link to the Customer number with text pre-filled from context. While no number is
 * configured it leads to the contact page, never to a dead link.
 */
export function OrderButton({
  text,
  label,
  size = "lg",
  variant = "gold",
  className = "",
  iconOnlyOnMobile = false,
}: {
  text?: string;
  label?: string;
  size?: "lg" | "md" | "sm";
  variant?: "gold" | "ink" | "line";
  className?: string;
  iconOnlyOnMobile?: boolean;
}) {
  const { t, lang } = useSite();
  const href = waLink(text ?? t.wa.generic);
  const cls = `ak-btn ak-btn-${variant} ${size === "lg" ? "ak-btn-lg" : size === "sm" ? "ak-btn-sm" : ""} ${className}`;
  const content = (
    <>
      <WhatsAppIcon className="size-5 shrink-0" />
      <span className={iconOnlyOnMobile ? "sr-only sm:not-sr-only" : ""}>{label ?? t.cta.order}</span>
    </>
  );
  if (href)
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer" data-wa="order">
        {content}
      </a>
    );
  return (
    <Link className={cls} to="/$lang/contact" params={{ lang }} data-wa="order">
      {content}
    </Link>
  );
}
