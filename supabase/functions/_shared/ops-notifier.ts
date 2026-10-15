// The ops_notifier adapter (DECISIONS §32.1): operator alerts and the ops console go to Slack. Slack is for operators only
// and is never the record: the database queue (public.slack_messages) is, and this file only posts one queued message.
// The channel is config (slack_channels, ids recorded by the slack-setup workflow); without SLACK_BOT_TOKEN nothing is
// posted and the queue waits. Telegram is dropped.

export type SlackAction = { action_id: string; text: string; value: string; style?: "primary" | "danger" };
export type SlackMessage = { channel: string; threadTs: string | null; text: string; actions: SlackAction[] };
export type SlackPost = (
  m: SlackMessage,
) => Promise<{ ok: true; ts: string } | { ok: false; retry: boolean; error: string }>;

/** Slack mrkdwn needs &, < and > escaped; nothing from a customer or merchant can then form a link or a mention. */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The Block Kit body: the text, then its buttons (at most 5, Slack's limit per actions block). */
export function slackBlocks(text: string, actions: SlackAction[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    { type: "section", text: { type: "mrkdwn", text: slackEscape(text).slice(0, 3000) } },
  ];
  const buttons = (actions ?? []).slice(0, 5).map((a) => ({
    type: "button",
    action_id: a.action_id,
    text: { type: "plain_text", text: a.text.slice(0, 75) },
    value: a.value.slice(0, 2000),
    ...(a.style ? { style: a.style } : {}),
  }));
  if (buttons.length) blocks.push({ type: "actions", elements: buttons });
  return blocks;
}

/** chat.postMessage with the bot token. Slack answers 200 with ok:false on errors; rate limits are retried later. */
export function slackPoster(token: string, fetchImpl: typeof fetch = fetch): SlackPost {
  return async (m) => {
    try {
      const res = await fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          channel: m.channel,
          ...(m.threadTs ? { thread_ts: m.threadTs } : {}),
          text: slackEscape(m.text).slice(0, 3000),
          blocks: slackBlocks(m.text, m.actions),
          unfurl_links: false,
          unfurl_media: false,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && typeof j.ts === "string") return { ok: true, ts: j.ts };
      const error = `slack ${res.status} ${String(j?.error ?? "")}`.slice(0, 200);
      return { ok: false, retry: res.status === 429 || res.status >= 500 || j?.error === "ratelimited", error };
    } catch (e) {
      return { ok: false, retry: true, error: `slack network: ${String(e).slice(0, 120)}` };
    }
  };
}
