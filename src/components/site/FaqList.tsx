import type { Faq } from "@/lib/faq";

/** An accordion that needs no JavaScript (details/summary), so the answers are in the HTML for readers and crawlers. */
export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="ak-faq">
      {items.map((i) => (
        <details key={i.id}>
          <summary>{i.q}</summary>
          <p className="ak-answer">{i.a}</p>
        </details>
      ))}
    </div>
  );
}
