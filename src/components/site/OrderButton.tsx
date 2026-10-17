import { Link } from "@tanstack/react-router";
import { WhatsAppIcon } from "@/design/icons";
import { waLink } from "@/lib/site";
import { useSite } from "./context";

/**
 * "Order on WhatsApp" (§37.1): a wa.me link to the Customer number with text pre-filled from context. The main one is
 * WhatsApp green with the official glyph (§39.15.5); `ink` and `line` are the secondary links in the brand palette. While no
 * number is configured it leads to a contact page (the business one on the business side), never to a dead link.
 */
export function OrderButton({
  text,
  label,
  size = "lg",
  variant = "wa",
  className = "",
  iconOnlyOnMobile = false,
  business = false,
}: {
  text?: string;
  label?: string;
  size?: "lg" | "md" | "sm";
  variant?: "wa" | "gold" | "ink" | "line";
  className?: string;
  iconOnlyOnMobile?: boolean;
  /** On the business side: without a number, lead to the business contact page. */
  business?: boolean;
}) {
  const { t, lang } = useSite();
  const href = waLink(text ?? t.wa.generic);
  const cls = `ak-btn ak-btn-${variant} ${size === "lg" ? "ak-btn-lg" : size === "sm" ? "ak-btn-sm" : ""} ${iconOnlyOnMobile ? "is-icon-only" : ""} ${className}`;
  const content = (
    <>
      <WhatsAppIcon className="size-5 shrink-0" />
      <span className={iconOnlyOnMobile ? "sr-only sm:not-sr-only" : ""}>
        {label ?? t.cta.order}
      </span>
    </>
  );
  if (href)
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer" data-wa="order">
        {content}
      </a>
    );
  return (
    <Link
      className={cls}
      to={business ? "/$lang/business/contact" : "/$lang/contact"}
      params={{ lang }}
      data-wa="order"
    >
      {content}
    </Link>
  );
}
