// slack-setup (DECISIONS §32.1): once SLACK_BOT_TOKEN exists, creates the ops channels named in config `slack_channels`
// (public, so the bot can post with chat:write.public; joined so it reads thread replies in #support), records their ids
// with public.slack_channel_set, and links each active operator to their Slack user by the e-mail of their account
// (users.lookupByEmail), so nobody types an id. Idempotent; staging only (DB_URL from scripts/staging-db-url.sh).
// Prints channel names and counts only, never a token, an e-mail or a user id.
import pg from "pg";

const token = process.env.SLACK_BOT_TOKEN ?? "";

async function slack(method: string, args: Record<string, string>): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(args),
    signal: AbortSignal.timeout(15_000),
  });
  return res.json();
}

/** A channel name Slack accepts: lowercase letters, digits, dashes and underscores, at most 80. */
export const validChannel = (n: string) => /^[a-z0-9_-]{1,80}$/.test(n);

async function main() {
  if (!token) {
    console.log("SLACK_BOT_TOKEN is not set: waiting on the Slack owner issue. Nothing changed.");
    return;
  }
  const url = new URL(process.env.DB_URL ?? "");
  url.searchParams.delete("sslmode");
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const names = (await db.query("select public.config_value('slack_channels') as v")).rows[0]
      .v as Record<string, string>;
    const existing: Record<string, string> = {};
    let cursor = "";
    do {
      const j = await slack("conversations.list", {
        limit: "1000",
        exclude_archived: "true",
        types: "public_channel",
        cursor,
      });
      if (!j.ok) throw new Error(`conversations.list: ${j.error}`);
      for (const c of j.channels ?? []) existing[c.name] = c.id;
      cursor = j.response_metadata?.next_cursor ?? "";
    } while (cursor);
    for (const [key, name] of Object.entries(names)) {
      if (!validChannel(name)) throw new Error(`bad channel name for ${key}`);
      let id = existing[name];
      if (!id) {
        const j = await slack("conversations.create", { name, is_private: "false" });
        if (!j.ok) throw new Error(`conversations.create ${name}: ${j.error}`);
        id = j.channel.id;
        console.log(`created #${name}`);
      }
      await slack("conversations.join", { channel: id });
      await db.query("select public.slack_channel_set($1, $2, $3)", [key, id, name]);
    }
    console.log(`${Object.keys(names).length} channels recorded`);
    const ops = (
      await db.query(
        "select o.user_id, u.email from public.operators o join auth.users u on u.id = o.user_id where o.active and u.email is not null",
      )
    ).rows;
    let linked = 0;
    for (const o of ops) {
      const j = await slack("users.lookupByEmail", { email: o.email });
      if (!j.ok) continue;
      await db.query(
        `insert into public.operator_slack (slack_user_id, operator_user_id) values ($1, $2)
         on conflict (operator_user_id) do update set slack_user_id = excluded.slack_user_id`,
        [j.user.id, o.user_id],
      );
      linked++;
    }
    console.log(`${linked} of ${ops.length} operators linked to Slack`);
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith("setup.ts")) {
  main().catch((e) => {
    console.error(String(e).slice(0, 300));
    process.exit(1);
  });
}
