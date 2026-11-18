// FD1: the Menus page's script (served as /menus.js; the CSP allows scripts from this address only, and the page has no inline script).
// The page works as a plain form without it. With it, choosing photos (one or several) shrinks each on the phone as LB1's capture page does
// (at most 1600 px on the long side, JPEG quality 0.8: FIX1's numbers) and sends them one after the other; the page reloads when all are in.
// A photo that fails is named on the page and can be chosen again; nothing is lost on the server. All words come from data-msg-* attributes.
export const MENUS_JS = `(function(){
"use strict";
var f=document.querySelector("form[data-menu-upload]");
if(!f){return;}
var input=f.querySelector("input[type=file]"),status=f.querySelector("[data-status]"),MAX=1600;
Array.prototype.forEach.call(f.querySelectorAll("[data-nojs]"),function(e){e.hidden=true;});
function msg(k){return f.getAttribute("data-msg-"+k)||"";}
function say(t){if(status){status.textContent=t;}}
function shrink(file){return new Promise(function(ok){
  if(!window.createImageBitmap||!document.createElement("canvas").toBlob){ok(file);return;}
  createImageBitmap(file).then(function(bmp){
    var k=Math.min(1,MAX/Math.max(bmp.width,bmp.height)),c=document.createElement("canvas");
    c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    c.toBlob(function(b){ok(b&&b.size?b:file);},"image/jpeg",0.8);
  }).catch(function(){ok(file);});
});}
input.addEventListener("change",function(){
  var files=Array.prototype.slice.call(input.files||[]),i=0,failed=0;
  if(!files.length){return;}
  function next(){
    if(i>=files.length){if(!failed){location.reload();}else{say(msg("failed").replace("{n}",String(failed)));}return;}
    var file=files[i++];say(msg("working").replace("{i}",String(i)).replace("{n}",String(files.length)));
    shrink(file).then(function(blob){
      var fd=new FormData(f);fd.set("photo",new File([blob],"menu.jpg",{type:"image/jpeg"}));
      return fetch(f.action,{method:"POST",body:fd,credentials:"same-origin",headers:{accept:"application/json"}});
    }).then(function(r){if(!r.ok){failed++;}next();}).catch(function(){failed++;next();});
  }
  next();
});
})();`;
