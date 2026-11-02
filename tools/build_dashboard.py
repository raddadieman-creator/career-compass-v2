"""يبني apps-script/Dashboard.html من القالب، ويحقن فيه بيانات البنود والجوانب من data/items.json.
التشغيل من جذر المستودع: python3 tools/build_dashboard.py"""
import json
b = json.load(open('data/items.json', encoding='utf-8'))
meta = {
    "instrument": b["instrument"],
    "scales": b["scales"],
    "facets": [{"id": f["id"], "label": f["label"], "component": f["component"]} for f in b["facets"]],
    "items": [{k: i[k] for k in ("id", "text", "facet", "stage", "role", "scale", "reverse", "excludeFromCount") if k in i} for i in b["items"]],
}
t = open('apps-script/Dashboard.template.html', encoding='utf-8').read()
assert '/*__META__*/null' in t
open('apps-script/Dashboard.html', 'w', encoding='utf-8').write(t.replace('/*__META__*/null', json.dumps(meta, ensure_ascii=False)))
print('Dashboard.html built')
