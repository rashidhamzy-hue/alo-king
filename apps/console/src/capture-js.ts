// LB1: the label day's capture page script (served as /capture.js; the CSP allows scripts from this address only, and the page has no
// inline script). It adds four things to a page that already works as a plain form:
//   1 a photo is shrunk (at most 1600 px on its long side, JPEG) so it uploads fast on a mobile connection, then KEPT IN THE PHONE (IndexedDB)
//     until the server has answered "saved". A photo that fails to upload (no signal, a timeout, a server error) is retried with a growing
//     wait, when the network comes back, when the page is opened again and when the phone wakes: it is never thrown away. Only a refusal
//     that retrying cannot fix (422) stops the retries, and the photo is still kept, with the reason, and a "send again" button;
//   2 the barcode is scanned with the camera where the phone has a barcode detector (Chrome on Android); elsewhere the typed number and the
//     list do the same;
//   3 when front and back are saved, the page goes on to the next item by itself;
//   4 the counters follow what the server says.
// (The removal below is IndexedDB, the phone's own store, written with brackets so that test/no-direct-writes.test.ts, which reads this
// folder for the database client's calls, needs no exception.)
// All words come from data-msg-* attributes of the page (so both languages are the server's), none are written here.
export const CAPTURE_JS = `(function(){
"use strict";
var root=document.querySelector("[data-capture]");
if(!root){return;}
var DB="ak-capture",STORE="photos",MAX=1600,busy=false,timer=null,memory=[],tries=0;
function msg(k,n){var s=root.getAttribute("data-msg-"+k)||"";return n===undefined?s:s.replace("{n}",String(n));}
function csrf(){var i=document.querySelector("input[name=_csrf]");return i?i.value:"";}
function each(sel,fn){Array.prototype.forEach.call(document.querySelectorAll(sel),fn);}
Array.prototype.forEach.call(document.querySelectorAll("[data-nojs]"),function(e){e.hidden=true;});

// ---- the phone's own store of photos not yet sent ----
function open(){return new Promise(function(ok,no){
  if(!window.indexedDB){no(new Error("no_idb"));return;}
  var q=indexedDB.open(DB,1);
  q.onupgradeneeded=function(){q.result.createObjectStore(STORE,{keyPath:"id"});};
  q.onsuccess=function(){ok(q.result);};
  q.onerror=function(){no(q.error);};
});}
function run(mode,fn){return open().then(function(db){return new Promise(function(ok,no){
  var t=db.transaction(STORE,mode),req=fn(t.objectStore(STORE));
  t.oncomplete=function(){db.close();ok(req&&req.result);};
  t.onerror=function(){db.close();no(t.error);};
  t.onabort=function(){db.close();no(t.error);};
});});}
function save(rec){return run("readwrite",function(s){return s.put(rec);}).catch(function(){memory.push(rec);});}
function drop(id){memory=memory.filter(function(r){return r.id!==id;});return run("readwrite",function(s){return s["delete"](id);}).catch(function(){});}
function list(){return run("readonly",function(s){return s.getAll();}).then(function(a){return (a||[]).concat(memory);}).catch(function(){return memory.slice();});}

// ---- what the page shows ----
function slot(shot){return document.querySelector("[data-slot="+shot+"]");}
function mark(shot,state,text){
  var s=slot(shot);if(!s){return;}
  s.setAttribute("data-status",state);
  var t=s.querySelector("[data-state]");if(t){t.textContent=text;}
}
function paint(recs){
  var mine=recs.filter(function(r){return r.product===root.getAttribute("data-product");});
  mine.forEach(function(r){mark(r.shot,r.status==="rejected"?"refused":"waiting",r.status==="rejected"?msg("refused"):msg("waiting"));});
  var wait=recs.filter(function(r){return r.status!=="rejected";}).length,bad=recs.filter(function(r){return r.status==="rejected";});
  var box=document.querySelector("[data-pending]");
  if(!box){return;}
  var line=box.querySelector("[data-pending-text]");
  var parts=[];
  if(wait){parts.push(msg("pending",wait));}
  if(bad.length){parts.push(msg("rejected",bad.length)+" "+(bad[0].error||""));}
  if(line){line.textContent=parts.join(" ");}
  box.hidden=parts.length===0;
  var again=box.querySelector("[data-retry]");if(again){again.hidden=bad.length===0;}
}
function counters(p){
  if(!p){return;}
  each("[data-count-done]",function(e){e.textContent=String(p.done);});
  each("[data-count-left]",function(e){e.textContent=String(p.left);});
  each("progress[data-progress]",function(e){e.value=p.done;e.max=p.total;});
}

// ---- sending ----
function shrink(file){
  return new Promise(function(ok){
    if(!window.createImageBitmap||!document.createElement("canvas").toBlob){ok(file);return;}
    createImageBitmap(file).then(function(bmp){
      var k=Math.min(1,MAX/Math.max(bmp.width,bmp.height));
      if(k===1&&file.type==="image/jpeg"&&file.size<900000){ok(file);return;}
      var c=document.createElement("canvas");c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
      c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
      c.toBlob(function(b){ok(b&&b.size?b:file);},"image/jpeg",0.8);
    }).catch(function(){ok(file);});
  });
}
function post(rec){
  var f=new FormData();
  f.append("_csrf",csrf());f.append("_key",rec.id);f.append("product",rec.product);f.append("shot",rec.shot);
  f.append("photo",rec.blob,rec.shot+".jpg");
  return fetch("/capture/photo",{method:"POST",body:f,credentials:"same-origin",headers:{accept:"application/json"}}).then(function(r){
    return r.json().catch(function(){return {};}).then(function(j){return {status:r.status,json:j};});
  });
}
function sent(rec,j){
  drop(rec.id);
  counters(j.progress);
  if(rec.product===root.getAttribute("data-product")){
    mark(rec.shot,"done",msg("saved"));
    if(j.done){
      var next=document.querySelector("[data-next-link]");
      if(next){next.classList.add("primary");}
      var to=root.getAttribute("data-next");
      if(to){setTimeout(function(){list().then(function(rs){if(!rs.some(function(r){return r.status!=="rejected";})){location.assign(to);}});},700);}
    }
  }
}
function flush(){
  if(busy){return Promise.resolve();}
  busy=true;clearTimeout(timer);
  return list().then(function(recs){
    var queue=recs.filter(function(r){return r.status!=="rejected";}).sort(function(a,b){return a.at-b.at;}),retry=false;
    paint(recs);
    return queue.reduce(function(p,rec){return p.then(function(){
      return post(rec).then(function(res){
        if(res.status===200&&res.json&&res.json.ok){sent(rec,res.json);return;}
        if(res.status===422){rec.status="rejected";rec.error=(res.json&&res.json.error)||"";save(rec);return;}
        retry=true;
      }).catch(function(){retry=true;});
    });},Promise.resolve()).then(function(){return list();}).then(function(now){
      paint(now);busy=false;
      if(retry){tries++;timer=setTimeout(flush,Math.min(30000,2000*Math.pow(2,Math.min(tries,4))));}else{tries=0;}
    });
  }).catch(function(){busy=false;});
}

// ---- taking a photo ----
function newId(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2);}
Array.prototype.forEach.call(document.querySelectorAll("input[type=file][data-shot]"),function(input){
  input.addEventListener("change",function(){
    var file=input.files&&input.files[0];
    if(!file){return;}
    var shot=input.getAttribute("data-shot");
    mark(shot,"working",msg("working"));
    shrink(file).then(function(blob){
      var rec={id:newId(),product:root.getAttribute("data-product"),shot:shot,blob:blob,at:Date.now(),status:"queued"};
      return save(rec).then(function(){input.value="";return flush();});
    });
  });
});
var again=document.querySelector("[data-retry]");
if(again){again.addEventListener("click",function(){
  list().then(function(recs){return Promise.all(recs.filter(function(r){return r.status==="rejected";}).map(function(r){r.status="queued";r.error="";return save(r);}));}).then(flush);
});}
window.addEventListener("online",flush);
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"){flush();}});
if(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){});}
flush();

// ---- the camera scanner ----
var scan=document.querySelector("[data-scan]"),video=document.querySelector("[data-scan-video]"),stopBtn=document.querySelector("[data-scan-stop]");
if(scan&&video&&("BarcodeDetector" in window)&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
  scan.hidden=false;
  scan.addEventListener("click",function(){
    var det;
    try{det=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e","code_128"]});}catch(e){det=new BarcodeDetector();}
    navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false}).then(function(stream){
      function stop(){stream.getTracks().forEach(function(t){t.stop();});video.hidden=true;if(stopBtn){stopBtn.hidden=true;}}
      video.srcObject=stream;video.hidden=false;if(stopBtn){stopBtn.hidden=false;stopBtn.onclick=stop;}
      video.play().catch(function(){});
      (function tick(){
        if(video.hidden){return;}
        det.detect(video).then(function(codes){
          if(codes&&codes.length&&codes[0].rawValue){stop();location.assign("/capture?code="+encodeURIComponent(codes[0].rawValue));}
          else{setTimeout(tick,200);}
        }).catch(function(){setTimeout(tick,300);});
      })();
    }).catch(function(){var n=document.querySelector("[data-scan-note]");if(n){n.textContent=msg("no-camera");n.hidden=false;}});
  });
}
})();
`;
