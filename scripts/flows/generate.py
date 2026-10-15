# Generates three WhatsApp Flow JSON files in Arabic and English from one definition, so both languages keep the same
# structure (DECISIONS §12, §39.8, session 5b): address_capture (with the landmark and the lift), checkout and
# menu_section. The other Flows in whatsapp/flows/ are edited by hand. Usage: python3 scripts/flows/generate.py whatsapp/flows
# Then run Flowso (pnpm test runs flows.test.ts: validate + scenarios in whatsapp/flows/scenarios/).
import json, sys
OUT = sys.argv[1]
def w(name, lang, obj):
    with open(f"{OUT}/{name}.{lang}.json", "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2); f.write("\n")

T = {
 "en": dict(
   addr_title="Address details", privacy="Used only to deliver your order. The location comes from the pin you sent.",
   building="Building name", floor="Floor", lift="Is there a working lift?", lift_yes="Yes, there is a lift", lift_no="No lift",
   apartment="Apartment", lm="Nearest landmark", lm_rel="Where from it", lm_other="Another landmark",
   driver="Phone for driver", notes="Notes for driver", save="Save address",
   rel={"at":"At it","next_to":"Next to it","opposite":"Facing it","behind":"Behind it","above":"Above it","below":"Below it","near":"Near it","after":"After it","before":"Before it"},
   co_title="Checkout", co_items="Your order", co_total="Total", co_how="Delivery or pickup", co_cash="I will pay cash in",
   co_usd="US dollars (USD)", co_lbp="Lebanese pounds (LBP)", co_sub="If an item is missing", co_note="Note for the shop",
   co_review="Review my order", co_hint="Prices are checked again before you confirm.",
   sub={"call":"Call me first","replace":"Replace with similar","remove":"Remove it"},
   ms_title="Menu section", ms_hint="Untick anything that is not on your menu. Prices are exactly as read; fix a wrong one by message after saving.",
   ms_keep="Items to put on the menu", ms_save="Put on my menu",
 ),
 "ar": dict(
   addr_title="تفاصيل العنوان", privacy="منستعملها بس لتوصيل طلبك. الموقع من الـ pin اللي بعتّو.",
   building="اسم البناية", floor="الطابق", lift="في مصعد شغّال؟", lift_yes="إيه، في مصعد", lift_no="ما في مصعد",
   apartment="الشقة", lm="أقرب معلم", lm_rel="بالنسبة للمعلم", lm_other="معلم تاني",
   driver="رقم للسائق", notes="ملاحظات للسائق", save="احفظ العنوان",
   rel={"at":"عندو","next_to":"حدّو","opposite":"مقابيلو","behind":"وراه","above":"فوقو","below":"تحتو","near":"قريب منو","after":"بعدو","before":"قبلو"},
   co_title="الطلب", co_items="طلبك", co_total="المجموع", co_how="توصيل أو استلام", co_cash="بدفع كاش بـ",
   co_usd="دولار (USD)", co_lbp="ليرة لبنانية (LBP)", co_sub="إذا صنف مش موجود", co_note="ملاحظة للمحل",
   co_review="راجع طلبي", co_hint="منرجع نتأكد من الأسعار قبل ما تأكد.",
   sub={"call":"اتصلوا فيّ أول","replace":"بدّلوه بشي متلو","remove":"شيلوه"},
   ms_title="قسم المنيو", ms_hint="شيل الصح عن أي صنف مش بالمنيو. الأسعار متل ما انقرت؛ صحّح الغلط برسالة بعد الحفظ.",
   ms_keep="الأصناف اللي بتنحط عالمنيو", ms_save="حطّها عالمنيو",
 ),
}

def address(lang):
    t = T[lang]
    return {
      "version": "7.3",
      "routing_model": {"ADDRESS": []},
      "screens": [{
        "id": "ADDRESS", "title": t["addr_title"], "terminal": True,
        "data": {
          "address_id": {"type": "string", "__example__": "00000000-0000-0000-0000-000000000000"},
          "place_name": {"type": "string", "__example__": "Baakline"},
          "landmarks": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}}},
                        "__example__": [{"id": "l1", "title": "Baakline municipality"}, {"id": "none", "title": "Not listed"}]},
        },
        "layout": {"type": "SingleColumnLayout", "children": [
          {"type": "TextSubheading", "text": "${data.place_name}"},
          {"type": "TextCaption", "text": t["privacy"]},
          {"type": "TextInput", "name": "building", "label": t["building"], "input-type": "text", "required": True, "max-chars": 120},
          {"type": "TextInput", "name": "floor", "label": t["floor"], "input-type": "text", "required": False, "max-chars": 20},
          {"type": "RadioButtonsGroup", "name": "has_elevator", "label": t["lift"], "required": False,
           "data-source": [{"id": "yes", "title": t["lift_yes"]}, {"id": "no", "title": t["lift_no"]}]},
          {"type": "TextInput", "name": "apartment", "label": t["apartment"], "input-type": "text", "required": False, "max-chars": 20},
          {"type": "Dropdown", "name": "landmark_id", "label": t["lm"], "required": False, "data-source": "${data.landmarks}"},
          {"type": "Dropdown", "name": "landmark_relation", "label": t["lm_rel"], "required": False,
           "data-source": [{"id": k, "title": v} for k, v in t["rel"].items()]},
          {"type": "TextInput", "name": "landmark", "label": t["lm_other"], "input-type": "text", "required": False, "max-chars": 120},
          {"type": "TextInput", "name": "driver_phone", "label": t["driver"], "input-type": "phone", "required": False},
          {"type": "TextArea", "name": "notes", "label": t["notes"], "required": False, "max-length": 300},
          {"type": "Footer", "label": t["save"], "on-click-action": {"name": "complete", "payload": {
            "address_id": "${data.address_id}", "building": "${form.building}", "floor": "${form.floor}",
            "has_elevator": "${form.has_elevator}", "apartment": "${form.apartment}", "landmark_id": "${form.landmark_id}",
            "landmark_relation": "${form.landmark_relation}", "landmark": "${form.landmark}",
            "driver_phone": "${form.driver_phone}", "notes": "${form.notes}"}}},
        ]},
      }],
    }

def checkout(lang):
    t = T[lang]
    opt = {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}}}}
    return {
      "version": "7.3",
      "routing_model": {"CHECKOUT": []},
      "screens": [{
        "id": "CHECKOUT", "title": t["co_title"], "terminal": True,
        "data": {
          "basket_id": {"type": "string", "__example__": "00000000-0000-0000-0000-000000000000"},
          "version": {"type": "string", "__example__": "12"},
          "vendor": {"type": "string", "__example__": "Alo Test Grill"},
          "lines": {"type": "string", "__example__": "2 × Shish taouk  $9.00\n1 × Fries  $2.50"},
          "total": {"type": "string", "__example__": "$14.00 = 1,253,000 LBP (rate 89,500, today)"},
          "fulfilment_options": {**opt, "__example__": [{"id": "delivery", "title": "Delivery to Home – Baakline"}, {"id": "pickup", "title": "Pickup at the shop"}]},
          "fulfilment": {"type": "string", "__example__": "delivery"},
          "cash": {"type": "string", "__example__": "USD"},
          "show_sub": {"type": "boolean", "__example__": False},
        },
        "layout": {"type": "SingleColumnLayout", "children": [
          {"type": "TextSubheading", "text": "${data.vendor}"},
          {"type": "TextBody", "text": "${data.lines}"},
          {"type": "TextBody", "markdown": False, "text": "${data.total}"},
          {"type": "TextCaption", "text": t["co_hint"]},
          {"type": "RadioButtonsGroup", "name": "fulfilment", "label": t["co_how"], "required": True,
           "init-value": "${data.fulfilment}", "data-source": "${data.fulfilment_options}"},
          {"type": "RadioButtonsGroup", "name": "cash", "label": t["co_cash"], "required": True, "init-value": "${data.cash}",
           "data-source": [{"id": "USD", "title": t["co_usd"]}, {"id": "LBP", "title": t["co_lbp"]}]},
          {"type": "RadioButtonsGroup", "name": "sub_pref", "label": t["co_sub"], "required": False, "visible": "${data.show_sub}",
           "data-source": [{"id": k, "title": v} for k, v in t["sub"].items()]},
          {"type": "TextArea", "name": "note", "label": t["co_note"], "required": False, "max-length": 200},
          {"type": "Footer", "label": t["co_review"], "on-click-action": {"name": "complete", "payload": {
            "basket_id": "${data.basket_id}", "version": "${data.version}", "fulfilment": "${form.fulfilment}",
            "cash": "${form.cash}", "sub_pref": "${form.sub_pref}", "note": "${form.note}"}}},
        ]},
      }],
    }

def menu_section(lang):
    t = T[lang]
    return {
      "version": "7.3",
      "routing_model": {"SECTION": []},
      "screens": [{
        "id": "SECTION", "title": t["ms_title"], "terminal": True,
        "data": {
          "draft_id": {"type": "string", "__example__": "00000000-0000-0000-0000-000000000000"},
          "section_key": {"type": "string", "__example__": "s1"},
          "section_name": {"type": "string", "__example__": "Grills"},
          "items": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}}},
                    "__example__": [{"id": "i1", "title": "Shish taouk", "description": "$4.50"}, {"id": "i2", "title": "Kafta", "description": "$4.00"}]},
          "all_items": {"type": "array", "items": {"type": "string"}, "__example__": ["i1", "i2"]},
        },
        "layout": {"type": "SingleColumnLayout", "children": [
          {"type": "TextSubheading", "text": "${data.section_name}"},
          {"type": "TextCaption", "text": t["ms_hint"]},
          {"type": "CheckboxGroup", "name": "keep", "label": t["ms_keep"], "required": True, "min-selected-items": 1,
           "init-value": "${data.all_items}", "data-source": "${data.items}"},
          {"type": "Footer", "label": t["ms_save"], "on-click-action": {"name": "complete", "payload": {
            "draft_id": "${data.draft_id}", "section_key": "${data.section_key}", "keep": "${form.keep}"}}},
        ]},
      }],
    }

for lang in ("ar", "en"):
    w("address_capture", lang, address(lang))
    w("checkout", lang, checkout(lang))
    w("menu_section", lang, menu_section(lang))
