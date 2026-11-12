import csv,sys,re,math,collections,json,statistics
src,outdir=sys.argv[1],sys.argv[2]
rows=list(csv.DictReader(open(src,encoding='utf-8-sig',newline='')))
AR=re.compile(r'[؀-ۿ]')
def hav(a,b,c,d):
    R=6371.0;p=math.radians
    x=math.sin(p(c-a)/2)**2+math.cos(p(a))*math.cos(p(c))*math.sin(p(d-b)/2)**2
    return 2*R*math.asin(math.sqrt(x))
VMAP={'Deir al Qamar, Chouf':'Deir El Qamar','Barouk, Chouf':'Barouk','Baakleen':'Baakline','Boqaata':'Baqaata'}
RAWMAP={'Naameh':'Naameh','Haret El Naameh':'Haret El Naameh','Mar Taqla El Naameh':'Naameh','الناعمة':'Naameh','Nabaa El Safa':'Nabaa El Safa','Jisr El Qadi':'Jisr El Qadi','Rechmaya':'Rechmaya','Khalde':'Khalde','Douha':'Douha','Ain Dara':'Ain Dara','Semqanier':'Samqaniyeh'}
OUTSIDE={'Khalde','Douha','Rechmaya','Ain Dara','Beirut'}
NOT_A_VILLAGE={'Higher Chouf','Beirut',''}
CATKW=[('Bakery',r'\b(bakery|furn|afran|forn|boulangerie|manakish|manaeesh|mana2ish|saj)\b|أفران|فرن|مخبز'),('Sweets',r'\b(sweets?|patisserie|pastry|halawiyat|cake|chocolat\w*|ice ?cream|gelato)\b|حلويات'),('Butcher',r'\b(butcher\w*|malhame|malhamet|boucherie)\b|ملحمة'),('Grocery',r'\b(super ?market|mini ?market|market|grocery|minimarket|dekkan\w*)\b|سوبر ?ماركت|دكان'),('Cafe',r'\b(cafe|café|coffee|kahwe|ahwe)\b|قهوة|كافيه')]
FIT=[('alcohol_or_tobacco',r'\b(winery|wine|liquor|beer|pub|tobacco|shisha|arguile|argile|hookah|vape)\b|\bbar\b'),('lodging',r'\b(hotel|guest ?house|guesthouse|resort|chalet)\b'),('pharmacy',r'\bpharmacy\b'),('not_food',r'\b(playground|building|street|activit\w+|swimming)\b'),('tourist_site_check',r'\b(palace|getaway|castle|museum|shallalat|waterfalls?|camping|camp)\b')]
vill_names={ (r['village_canonical'] or '').lower() for r in rows}|{'chouf','baakline','baakleen','supermarket','-'}
base=[r for r in rows if r['village_canonical']=='Baakleen']
BLAT=statistics.median(float(r['latitude']) for r in base); BLON=statistics.median(float(r['longitude']) for r in base)
known=[(float(r['latitude']),float(r['longitude']),r['village_canonical']) for r in rows if r['village_canonical'] not in NOT_A_VILLAGE and ',' not in r['village_canonical']]
def digits(p): return re.sub(r'\D','',p)
phone_groups=collections.defaultdict(list)
for i,r in enumerate(rows):
    if r['phone_primary']: phone_groups[digits(r['phone_primary'])].append(i)
def norm(s): return re.sub(r'[^a-z0-9؀-ۿ]','',s.lower())
parent=list(range(len(rows)))
def find(x):
    while parent[x]!=x: parent[x]=parent[parent[x]]; x=parent[x]
    return x
for g in phone_groups.values():
    for j in g[1:]: parent[find(j)]=find(g[0])
for i in range(len(rows)):
    for j in range(i+1,len(rows)):
        a,b=rows[i],rows[j]
        if abs(float(a['latitude'])-float(b['latitude']))>0.001: continue
        if hav(float(a['latitude']),float(a['longitude']),float(b['latitude']),float(b['longitude']))<0.06:
            na,nb=norm(a['name_en']),norm(b['name_en'])
            if len(na)>=4 and len(nb)>=4 and (na[:6]==nb[:6] or na in nb or nb in na): parent[find(j)]=find(i)
groups=collections.defaultdict(list)
for i in range(len(rows)): groups[find(i)].append(i)
gid={}; n=0
for root,m in sorted(groups.items()):
    if len(m)>1:
        n+=1
        for i in m: gid[i]=f"D{n:03d}"
out=[]; stats=collections.Counter()
for i,r in enumerate(rows):
    o={}; ch=[]; flags=[]
    name=r['name_en'].strip()
    ar=' '.join(re.findall(r'[؀-ۿ][؀-ۿ\s]*',name)).strip()
    lat=re.sub(r'[؀-ۿ]+','',name); lat=re.sub(r'\(\s*\)','',lat); lat=re.sub(r'\s{2,}',' ',lat).strip(' -–,|/')
    o['vendor_id']=r['vendor_id']; o['name_original']=name
    o['name_en']=lat; o['name_ar']=ar
    if ar: ch.append('split Arabic name out of name_en'); stats['arabic_split']+=1
    if not lat: flags.append('no_latin_name')
    if not ar: flags.append('no_arabic_name')
    if norm(name) in {norm(v) for v in vill_names} or len(norm(name))<3 or re.search(r'\b(building|street)\b',name.lower()): flags.append('name_suspect')
    cat=r['category_canonical']; sug=''
    for c,rx in CATKW:
        if re.search(rx,name.lower()):
            sug=c; break
    o['category']=cat; o['category_suggested_from_name']=sug if sug and sug!=cat else ''
    if o['category_suggested_from_name']: flags.append('category_check'); stats['category_check']+=1
    vc=r['village_canonical'].strip(); vr=r['village_raw'].strip(); method='as_given'
    if vc in VMAP: vc=VMAP[vc]; method='spelling_normalised'; ch.append('village spelling normalised')
    if vc in NOT_A_VILLAGE:
        if vr in RAWMAP: vc=RAWMAP[vr]; method='from_raw_field'; ch.append('village taken from raw field')
        else:
            best=min(known,key=lambda k:hav(float(r['latitude']),float(r['longitude']),k[0],k[1]))
            d=hav(float(r['latitude']),float(r['longitude']),best[0],best[1])
            if d<=1.0: vc=VMAP.get(best[2],best[2]); method=f'inferred_nearest_listing_{d:.2f}km'; flags.append('village_inferred'); ch.append('village inferred from nearest listing')
            else: vc=''; method='unknown'; flags.append('village_unknown')
    o['village']=vc; o['village_method']=method; o['village_raw']=vr
    if vc in OUTSIDE or vr in OUTSIDE and method!='as_given': flags.append('likely_outside_chouf')
    o['address']=r['address']; o['address_is_plus_code']='yes' if re.match(r'^[A-Z0-9]{4}\+',r['address']) else 'no'
    o['latitude']=r['latitude']; o['longitude']=r['longitude']
    km=hav(float(r['latitude']),float(r['longitude']),BLAT,BLON); o['km_from_baakline_straight_line']=f'{km:.1f}'
    o['google_maps_url']=r['google_maps_url']
    d=digits(r['phone_primary']); e164=''; ptype=''
    if d:
        if d.startswith('961'): e164='+'+d; nat=d[3:]
        else: nat=d.lstrip('0'); e164='+961'+nat
        ptype='mobile' if re.match(r'^(3\d{6}|7[01689]\d{6}|8[01]\d{6})$',nat) else ('landline' if re.match(r'^[145679]\d{6}$',nat) else 'check')
        if ptype=='check': flags.append('phone_format_check')
    else: flags.append('no_phone')
    o['phone_e164']=e164; o['phone_type']=ptype
    if d and len(phone_groups[d])>1: flags.append('shared_phone')
    o['duplicate_group']=gid.get(i,'')
    if i in gid: flags.append('possible_duplicate')
    for f,rx in FIT:
        if re.search(rx,name.lower()): flags.append(f)
    if 'joud' in name.lower(): flags.append('name_contains_joud_confirm_unrelated')
    rating=float(r['google_rating_internal']); rev=int(float(r['google_reviews_internal']))
    o['google_rating_internal']=r['google_rating_internal']; o['google_reviews_internal']=str(rev)
    if rev<5: flags.append('few_reviews')
    o['stage']='research_lead'; o['contact_permitted']='no'; o['owner_consent_to_list']='not_asked'
    o['source']='Google Maps listing, collected by founder'; o['verified_by_staff']='no'
    for c in ['whatsapp_number','owner_name','open_days','open_time','close_time','already_delivers','menu_url','contacted_date','contact_outcome','notes']: o[c]=''
    o['flags']=';'.join(dict.fromkeys(flags)); o['changes']='; '.join(ch)
    out.append(o)
    for f in dict.fromkeys(flags): stats[f]+=1
cols=list(out[0].keys())
with open(outdir+'/alo_king_prospects_cleaned.csv','w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=cols); w.writeheader(); w.writerows(out)
BAD={'tourist_site_check','possible_duplicate','alcohol_or_tobacco','lodging','pharmacy','not_food','name_suspect','likely_outside_chouf','no_phone','village_unknown'}
seen=set(); short=[]
for o in sorted(out,key=lambda o:-int(o['google_reviews_internal'])):
    fl=set(o['flags'].split(';'))
    if float(o['km_from_baakline_straight_line'])<=6 and o['category'] in('Restaurant','Bakery','Sweets','Cafe') and o['phone_e164'] and not (fl & (BAD-{'possible_duplicate'})):
        key=o['duplicate_group'] or o['vendor_id']
        if key in seen: continue
        seen.add(key); short.append(o)
scols=['name_en','name_ar','category','village','km_from_baakline_straight_line','phone_e164','phone_type','google_reviews_internal','flags','google_maps_url']
with open(outdir+'/alo_king_launch_shortlist.csv','w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=scols,extrasaction='ignore'); w.writeheader(); w.writerows(short[:60])
vm=collections.Counter(o['village_method'].split('_0')[0].split('_1')[0] for o in out)
rep={'rows':len(out),'baakline_centre':[BLAT,BLON],'dup_groups':n,'rows_in_dup_groups':len(gid),'flags':dict(stats),'village_method':dict(vm),
 'villages':len({o['village'] for o in out if o['village']}),'category':dict(collections.Counter(o['category'] for o in out)),
 'within_6km':sum(1 for o in out if float(o['km_from_baakline_straight_line'])<=6),'within_10km':sum(1 for o in out if float(o['km_from_baakline_straight_line'])<=10),
 'shortlist_pool':len(short),'shortlist_by_cat':dict(collections.Counter(o['category'] for o in short[:60])),'shortlist_villages':dict(collections.Counter(o['village'] for o in short[:60])),
 'mobile':sum(1 for o in out if o['phone_type']=='mobile'),'landline':sum(1 for o in out if o['phone_type']=='landline'),
 'within6_by_cat':dict(collections.Counter(o['category'] for o in out if float(o['km_from_baakline_straight_line'])<=6))}
print(json.dumps(rep,ensure_ascii=False,indent=1))
for o in short[:12]: print(o['name_en'],'|',o['name_ar'],'|',o['category'],'|',o['village'],o['km_from_baakline_straight_line'],o['google_reviews_internal'],o['flags'])
print([(o['name_original'],o['phone_e164']) for o in out if 'phone_format_check' in o['flags']][:8]);print([ (o['name_original'],o['category'],o['category_suggested_from_name']) for o in out if o['category_suggested_from_name']][:25])
print([ (o['name_original'],o['village'],o['village_method']) for o in out if 'inferred' in o['village_method']][:12])
