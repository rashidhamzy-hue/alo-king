// The planted examples for scripts/ci/no-personal-data.mjs: one or more of each kind of thing the check exists to stop.
// They are put together from fragments at run time, so this file itself holds no phone number, pin, plus code, address or key
// (the check runs over this file too). Used by the tests (test/ci/*.test.ts) and by `no-personal-data.mjs --self-test`, which CI runs.
//
// Every value is fictional or unassignable on purpose: a US number in the 555-01xx block, a UK number in Ofcom's drama range, a pin in the
// sea west of Beirut, an address at a domain nobody owns. Nothing here may ever be a person.
//   name    what it is        rule  which rule must find it      path  where the planted file sits      text  its content
//   secret  a piece of the value that must never appear in the output of the check (CI logs of a public repository are public)
const j = (...p) => p.join("");

export const PLANTS = [
  { name: "phone-11-digits", rule: "phone", path: "notes/contact.md", text: `Call us on ${j("+1", " ", "202", " ", "555", " ", "0147")} after nine.\n`, secret: j("555", " ", "0147") },
  { name: "phone-12-digits", rule: "phone", path: "notes/contact.md", text: `Call us on ${j("+44", " ", "20", " ", "7946", " ", "0123")} after nine.\n`, secret: j("7946", " ", "0123") },
  { name: "phone-13-digits", rule: "phone", path: "notes/contact.md", text: `Call us on ${j("+55", " ", "11", " ", "99999", " ", "9999")} after nine.\n`, secret: j("99999", " ", "9999") },
  { name: "phone-bare-11-digits", rule: "phone", path: "notes/contact.md", text: `whatsapp ${j("1202", "555", "0147")}\n`, secret: j("202", "555", "0147") },
  // The same fictional US number, written with Arabic-Indic digits as a customer's keyboard would.
  { name: "phone-arabic-indic-digits", rule: "phone", path: "notes/contact.md", text: `اتصل على ${j("+", "١", " ", "٢٠٢", " ", "٥٥٥", " ", "٠١٤٧")} بعد التاسعة\n`, secret: j("٥٥٥", " ", "٠١٤٧") },
  { name: "pin-4-decimals", rule: "pin", path: "notes/place.md", text: `Delivery pin: ${j("33", ".", "8123")}, ${j("35", ".", "1567")}\n`, secret: j("33", ".", "8123") },
  { name: "pin-5-decimals-json", rule: "pin", path: "notes/place.json", text: `{ "latitude": ${j("33", ".", "81234")},\n  "longitude": ${j("35", ".", "15678")} }\n`, secret: j("33", ".", "81234") },
  { name: "pluscode-full", rule: "pluscode", path: "notes/place.md", text: `Find us at ${j("8GP8", "J2R7", "+", "4M")} in Beirut.\n`, secret: j("J2R7", "+", "4M") },
  { name: "pluscode-short", rule: "pluscode", path: "notes/place.md", text: `Find us at ${j("J2R7", "+", "4M")} Baakline.\n`, secret: j("J2R7", "+", "4M") },
  { name: "email", rule: "email", path: "notes/contact.md", text: `Write to ${j("planted.check", "@", "planted-example-check", ".com")} please.\n`, secret: j("planted", ".", "check") },
  // A private key block: gitleaks's own rule must flag it (the check also runs gitleaks).
  {
    name: "secret-private-key", rule: "gitleaks", path: "config/planted-key.txt", secret: j("Zm9v", "YmFy", "cGxhbnRlZA"),
    text: [j("-----BEGIN", " ", "RSA PRIVATE", " ", "KEY-----"),
      ...Array.from({ length: 6 }, (_, i) => j("Zm9v", "YmFy", "cGxhbnRlZA", "QkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0NTY3ODk", String(i % 10), "abcdefg")),
      j("-----END", " ", "RSA PRIVATE", " ", "KEY-----"), ""].join("\n"),
  },
];

// Things that look a little like a finding and are not. Each one must pass.
export const NEAR_MISSES = [
  { name: "the project's invented fixture number", path: "test/x.test.ts", text: `const phone = "${j("+961", "70", "000", "001")}";\n` },
  { name: "Ofcom's drama range (a UK number that cannot be a person)", path: "test/x.test.ts", text: `const uk = "${j("+44", "7700", "900123")}";\n` },
  { name: "a number of 10 digits", path: "docs/a.md", text: `Call ${j("+961", "7000", "0000")}.\n` },
  { name: "a number of 14 digits", path: "docs/a.md", text: `id ${j("12345", "6789012", "34")}\n` },
  { name: "an EAN-13 barcode (checksum valid)", path: "data/a.json", text: `{ "code": "${j("807", "680", "208", "5738")}" }\n` },
  { name: "a UPC-A barcode (checksum valid)", path: "data/a.json", text: `{ "code": "${j("0123", "4567", "8905")}" }\n` },
  { name: "a timestamp in milliseconds", path: "data/a.json", text: `{ "ts": ${j("1731", "6000", "00000")} }\n` },
  { name: "a GitHub Actions run number, named as a run", path: "docs/a.md", text: `Proven on staging in run ${j("4339", "4402", "493")}.\n` },
  { name: "Meta's 16-digit phone number id", path: "docs/a.md", text: `phone_number_id ${j("13789", "74041", "965966")}\n` },
  { name: "a uuid", path: "test/a.ts", text: `const id = "${j("00000000", "-0000-", "0000-0000-", "000000000001")}";\n` },
  { name: "an address at example.com", path: "docs/a.md", text: `Write to ${j("user", "@", "example", ".com")}.\n` },
  { name: "an address at a reserved name (.example, .test)", path: "docs/a.md", text: `${j("ops", "@", "alo-king", ".example")} and ${j("nobody", "@", "staff", ".test")}\n` },
  { name: "GitHub's no-reply address", path: ".github/workflows/x.yml", text: `git config user.email "${j("ci", "@", "users.noreply", ".github.com")}"\n` },
  { name: "a key in the userinfo part of a URL (not an address)", path: "wrangler.jsonc", text: `"dsn": "https://${j("k", "@", "o1.ingest", ".sentry.io")}/1"\n` },
  { name: "a pin with three decimals (village level)", path: "docs/a.md", text: `Near ${j("33", ".", "813")}, ${j("35", ".", "157")}.\n` },
  { name: "a pin outside Lebanon", path: "docs/a.md", text: `Paris ${j("48", ".", "85661")}, ${j("2", ".", "35222")}.\n` },
  { name: "a lone decimal that is not half of a pin", path: "docs/a.md", text: `rate ${j("33", ".", "1234")} per mille\n` },
  { name: "arithmetic that looks like a plus code", path: "docs/a.md", text: `2368+22 is 2390.\n` },
  { name: "C++ and friends", path: "docs/a.md", text: `The C++ and Rust+WASM toolchains.\n` },
];
