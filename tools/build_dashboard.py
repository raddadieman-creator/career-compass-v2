import json
b=json.load(open('data/items.json',encoding='utf-8'))
meta={"facets":[{"id":f["id"],"label":f["label"],"dimension":f["dimension"]} for f in b["facets"]],
      "diagnoses":b["diagnoses"],
      "services":{"self":"خدمة ذاتية","brief":"خدمة موجزة بمساعدة المرشد","brief_group":"خدمة موجزة جماعية","individual":"إدارة حالة فردية"}}
t=open('apps-script/Dashboard.template.html',encoding='utf-8').read()
assert '/*__META__*/null' in t
open('apps-script/Dashboard.html','w',encoding='utf-8').write(t.replace('/*__META__*/null',json.dumps(meta,ensure_ascii=False)))
print('Dashboard.html built')
