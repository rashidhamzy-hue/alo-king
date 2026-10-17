// Types shared by the staging e2e runner (DECISIONS §36).

export type Persona = {
  role: "customer" | "merchant";
  /** Country-code label in the +999 number (961 Lebanon, 971 Dubai, ...). Never read by the bot. */
  cc?: string;
  name?: string;
};

/** One thing the bot sent to a simulator number, read back from sim_outbox. */
export type Out = {
  id: number;
  to: string;
  kind: string;
  text: string;
  header: string;
  /** Reply buttons, list rows and Flow/CTA labels the customer could tap. */
  options: { id: string; title: string }[];
  raw: Record<string, unknown>;
};

export type Expect = {
  /** Persona key the message went to. */
  to?: string;
  /**
   * text | interactive:button | interactive:list | interactive:product_list | interactive:product | image | any (default
   * any). Short forms: button, list, products, product.
   */
  kind?: string;
  /** Every string must appear (case-insensitive) in the body or header. */
  text?: string | string[];
  /** At least one string must appear. */
  text_any?: string[];
  text_re?: string;
  not_text?: string | string[];
  /** Reply language of the text: ar (Arabic script), en (no Arabic script, Latin), fr (Latin with French marks). */
  lang?: "ar" | "en" | "fr";
  /** Each entry matches an option by exact id, id prefix or title substring. */
  buttons?: string[];
  /** Name -> regex with one capture group, run on the matching message's text; stored in vars. */
  capture?: Record<string, string>;
  /** Assert that no message at all went to this persona in the step window. */
  none?: string;
};

export type DbCheck = {
  sql: string;
  /** Column -> expected value for the first row. Strings starting with ~ are regexes; >=, >, <=, < compare numbers. */
  row?: Record<string, unknown>;
  /** Expected number of rows. */
  rows?: number;
  /** Column of the first row stored in vars under this name. */
  save?: Record<string, string>;
  /** Keep re-running until it holds, up to this many seconds (default 12). */
  within_s?: number;
};

export type Step = {
  note?: string;
  /** Expanded before the run: the steps of tests/e2e/scenarios/_parts/<part>.yaml with $AS, $LAT, ... replaced. */
  include?: { part: string; as?: string; [param: string]: string | number | undefined };
  say?: { as: string; text: string };
  tap?: {
    /** Sends this id even though the bot never offered it (e.g. pickup when delivery works). */
    raw_id?: string;
    as: string;
    id?: string;
    id_prefix?: string;
    id_re?: string;
    title?: string;
    index?: number;
  };
  pin?: { as: string; lat: number | string; lon: number | string; name?: string };
  voice?: { as: string; transcript: string };
  /**
   * Sends a cart from the WhatsApp catalogue (§39.12): items picked from the last product message the persona got, by
   * position (`index`) or product id (`id`); `price` is what the catalogue showed (default: none), so a stale price can
   * be tested.
   */
  cart?: {
    as: string;
    items: { index?: number; id?: string; qty: number; price?: number | string }[];
  };
  /**
   * Drives the Alo King Flow app's endpoint (flow-app, DECISIONS §39.15.13) as Kapso's data-endpoint function would:
   * the decrypted request, signed with the proxy key. `action: INIT` first opens a session for the persona (a token made
   * with flow_app_open, as the bot makes one); `data` is the payload a row or a footer sends ({{vars.x}} allowed).
   */
  flow?: {
    as: string;
    action?: "INIT" | "data_exchange";
    data?: Record<string, unknown>;
    /** The screen the endpoint must answer (SUCCESS for Confirm). */
    screen: string;
    /** JSON pointer into the answer's data -> expected value (as db rows: ~regex, >=, ...). */
    has?: Record<string, unknown>;
    /** Name -> JSON pointer into the answer's data, stored in vars. */
    save?: Record<string, string>;
    /**
     * When the answer is SUCCESS: deliver the Flow's completion to the bot as WhatsApp does (an nfm_reply carrying the
     * endpoint's params), so the step's `expect` sees the chat's answer.
     */
    reply?: boolean;
  };
  /** SQL run before the next step (time travel, setup). */
  sql?: string;
  wait_s?: number;
  expect?: Expect[];
  db?: DbCheck[];
  /** Seconds to wait for the expectations (default 30). */
  timeout_s?: number;
  /** Seconds of silence after the last message before the step ends (default 2). */
  quiet_s?: number;
};

export type Scenario = {
  name: string;
  description?: string;
  /** One of the 5 smoke scenarios a session dispatches at its end (DECISIONS §36, test diet). */
  smoke?: boolean;
  personas: Record<string, Persona>;
  /** Starting values for {{vars.x}}. */
  vars?: Record<string, string>;
  steps: Step[];
};

export type StepResult = {
  index: number;
  label: string;
  ok: boolean;
  lines: string[];
  failures: string[];
};

export type ScenarioResult = {
  name: string;
  file: string;
  ok: boolean;
  seconds: number;
  steps: StepResult[];
  error?: string;
};
