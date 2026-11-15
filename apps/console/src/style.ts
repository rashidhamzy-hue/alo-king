// The console's one stylesheet (session D5). Design tokens first; every size, colour and space below comes from them.
// Mobile first: a bottom navigation on phones, a sidebar from 900 px. Logical properties throughout (inline/block, start/end),
// so right-to-left Arabic mirrors without a second sheet. Every control is at least --tap (44 px) high: buttons, inputs, selects,
// textareas, links used as buttons, and the navigation. test/shell.test.ts reads this text to hold that line.
export const TAP_PX = 44;

export const CSS = `
:root{
  --tap:${TAP_PX}px;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;
  --radius:10px;
  --bg:#f4f6f8;--surface:#fff;--ink:#14202b;--muted:#566370;--line:#d5dbe1;
  --brand:#0f3d5e;--brand-ink:#fff;--link:#0b5cad;
  --ok:#14663b;--ok-bg:#e1f3e8;--warn:#9a4d00;--warn-bg:#fff3dc;--danger:#a8231b;--danger-bg:#fde6e3;--note-bg:#fff8e1;--note-line:#e6c766;
  --font:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic","Noto Naskh Arabic",sans-serif;
  --nav-h:64px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--font);padding-block-end:calc(var(--nav-h) + env(safe-area-inset-bottom,0px))}
a{color:var(--link)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #f2a900;outline-offset:2px}
h1{font-size:1.4rem;margin:var(--space-2) 0 var(--space-3)}
h2{font-size:1.1rem;margin:var(--space-5) 0 var(--space-2)}
h3{font-size:1rem;margin:var(--space-4) 0 var(--space-2)}
.skip{position:absolute;inset-inline-start:-999px;inset-block-start:0;background:#fff;padding:var(--space-3);z-index:10}
.skip:focus{inset-inline-start:0}

/* page frame */
.env{background:#c25e00;color:#fff;padding:var(--space-1) var(--space-4);font-weight:700;font-size:.85rem}
header.top{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-4);background:var(--brand);color:var(--brand-ink);position:sticky;inset-block-start:0;z-index:5}
header.top strong{font-size:1.05rem}
header.top .who{display:flex;align-items:center;gap:var(--space-2);font-size:.9rem}
header.top .who form{display:inline;margin:0}
header.top button{background:transparent;color:var(--brand-ink);border:1px solid rgba(255,255,255,.55)}
.shell{display:block}
main{padding:var(--space-3) var(--space-4) var(--space-5);max-inline-size:1200px;min-inline-size:0}
main[dir=ltr]{text-align:start}

/* navigation: the bottom bar on phones, the sidebar on wide screens */
.bottom-nav{position:fixed;inset-inline:0;inset-block-end:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--surface);border-block-start:1px solid var(--line);padding-block-end:env(safe-area-inset-bottom,0px);z-index:6}
.bottom-nav a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-block-size:var(--nav-h);min-inline-size:var(--tap);color:var(--muted);text-decoration:none;font-size:.78rem;padding:var(--space-1)}
.bottom-nav a[aria-current=page]{color:var(--brand);font-weight:700;box-shadow:inset 0 3px 0 var(--brand)}
.bottom-nav .ic{font-size:1.25rem;line-height:1}
.badge{display:inline-block;min-inline-size:1.4em;padding:0 .4em;border-radius:999px;background:var(--danger);color:#fff;font-size:.72rem;font-weight:700;line-height:1.5;text-align:center}
.bottom-nav .badge{position:absolute;inset-block-start:4px;inset-inline-start:calc(50% + 6px)}
.sidebar{display:none}
.sidebar a{display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);min-block-size:var(--tap);padding:0 var(--space-3);color:var(--ink);text-decoration:none;border-radius:var(--radius)}
.sidebar a:hover,.sidebar a[aria-current=page]{background:#e6eef5}
.sidebar h2{font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:var(--space-4) var(--space-3) var(--space-1)}
@media (min-width:900px){
  body{padding-block-end:0}
  .shell{display:grid;grid-template-columns:240px minmax(0,1fr);align-items:start}
  .sidebar{display:block;position:sticky;inset-block-start:56px;padding:var(--space-3);border-inline-end:1px solid var(--line);background:var(--surface);min-block-size:calc(100vh - 56px)}
  .bottom-nav{display:none}
}

/* surfaces */
.card,.pair,.note{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:var(--space-3);margin:var(--space-3) 0}
.pair{display:flex;gap:var(--space-4);flex-wrap:wrap}
.pair>div{flex:1 1 320px;min-inline-size:0}
.note{background:var(--note-bg);border-color:var(--note-line)}
.stack>*+*{margin-block-start:var(--space-3)}
.muted{color:var(--muted)}
.warn{color:var(--warn)}
.late{background:var(--danger-bg)}
.flash{padding:var(--space-3);border-radius:var(--radius);margin:var(--space-2) 0}
.flash.ok{background:var(--ok-bg);color:var(--ok)}
.flash.err{background:var(--danger-bg);color:var(--danger)}
.summary-ok{background:var(--ok-bg);color:var(--ok);padding:var(--space-4);border-radius:var(--radius);font-weight:600}
.tag{display:inline-block;padding:0 .5em;border-radius:999px;font-size:.75rem;font-weight:700;background:#e6eef5;color:var(--brand)}
.tag.high{background:var(--danger-bg);color:var(--danger)}
.chips{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:var(--space-2) 0}
.chips a,.btn{display:inline-flex;align-items:center;justify-content:center;min-block-size:var(--tap);min-inline-size:var(--tap);padding:0 var(--space-4);border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink);text-decoration:none}
.chips a[aria-current=true]{background:var(--brand);color:var(--brand-ink);border-color:var(--brand)}
.btn.primary{background:var(--brand);color:var(--brand-ink);border-color:var(--brand)}

/* the exception inbox and the hubs */
.inbox{list-style:none;margin:0;padding:0}
.inbox li{background:var(--surface);border:1px solid var(--line);border-inline-start:5px solid var(--warn);border-radius:var(--radius);padding:var(--space-3);margin:var(--space-3) 0}
.inbox li.high{border-inline-start-color:var(--danger)}
.inbox .actions{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-block-start:var(--space-2)}
.inbox .actions form{margin:0}
.hub{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--space-3);list-style:none;margin:0;padding:0}
.hub a{display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);min-block-size:var(--tap);padding:var(--space-3) var(--space-4);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);color:var(--ink);text-decoration:none}
.timeline{list-style:none;margin:0;padding:0;border-inline-start:3px solid var(--line)}
.timeline li{position:relative;padding-block:var(--space-2);padding-inline:var(--space-4) 0}
.timeline time{display:block;color:var(--muted);font-size:.8rem}
.timeline .k{font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--brand)}

/* forms and tables */
form{margin:0}
form.inline{display:inline}
input,select,textarea,button{font:inherit;margin:2px 0;max-inline-size:100%}
button,input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]),select,textarea,summary{min-block-size:var(--tap);padding:var(--space-2) var(--space-3);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--ink)}
input[type=file]{min-block-size:var(--tap);max-inline-size:100%}
input[type=checkbox],input[type=radio]{inline-size:var(--tap);block-size:var(--tap);vertical-align:middle;margin:0}
button{cursor:pointer;background:var(--brand);color:var(--brand-ink);border-color:var(--brand);padding-inline:var(--space-4)}
button.secondary{background:var(--surface);color:var(--brand)}
button.danger{background:var(--danger);border-color:var(--danger)}
button[disabled]{opacity:.55;cursor:not-allowed}
input[type=number]{inline-size:7em}
textarea{inline-size:100%}
label{display:inline-block}
main table{display:block;max-inline-size:100%;overflow-x:auto;border-collapse:collapse;margin:var(--space-2) 0 var(--space-4)}
th,td{border:1px solid var(--line);padding:var(--space-1) var(--space-2);text-align:start;vertical-align:top;background:var(--surface)}
th{background:#eef1f4}
tr.late td{background:var(--danger-bg)}
img.proof{max-inline-size:100%;max-block-size:420px;border:1px solid var(--line);border-radius:var(--radius)}
kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 .4em;background:#fff;font:inherit;font-size:.85em}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:var(--space-1) var(--space-4);margin:0}
dl.facts dt{color:var(--muted)}
dl.facts dd{margin:0}
.names-current{outline:3px solid var(--brand);outline-offset:2px}
@media print{.bottom-nav,.sidebar,header.top{display:none}}
`;
