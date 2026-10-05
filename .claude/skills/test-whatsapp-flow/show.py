import json,sys
raw=sys.stdin.read()
try:
    d=json.loads(raw)
except ValueError:
    sys.exit("kapso-brain said: %r (401 unauthorized = SELFTEST_TOKEN missing/expired in selftest_tokens)" % raw[:200])
for o in d["out"]:
    i=o.get("interactive")
    if i: print("INTERACTIVE", i["type"], "|", (i.get("body") or {}).get("text","")[:900].replace("\n"," / "), "|", [(b["reply"]["id"][:48],b["reply"]["title"],len(b["reply"]["title"])) for b in i.get("action",{}).get("buttons",[])])
    elif o.get("type")=="template":
        t=o["template"]; print("TEMPLATE ->", o.get("to"), t["name"]+"/"+t["language"]["code"], [c["type"] for c in t.get("components",[])])
    else: print("TEXT ->", o.get("to"), o.get("text",{}).get("body","")[:700].replace("\n"," / "))
print("--", len(d["out"]), "messages")
