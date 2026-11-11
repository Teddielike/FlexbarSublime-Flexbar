'use strict';

// Menu model for nine *fixed* FlexDesigner keys (test, prev, six slots, next). No Dynamic Keys API.
const PREFIX='de.teddielike.flexbar-sublime-text.';
const SLOTS=6;
const ROLES=['test','prev','slot1','slot2','slot3','slot4','slot5','slot6','next'];
const VALID=new Set(ROLES);
// A single failed poll (Sublime busy, indexing, ...) must not blank the menu.
const OFFLINE_AFTER=3;
function roleFromCid(cid) {
  if(typeof cid!=='string' || !cid.startsWith(PREFIX))return null;
  const name=cid.slice(PREFIX.length);
  return VALID.has(name)?name:null;
}
function validAction(action) {
  return !!action && action.type==='action' && typeof action.id==='string' && /^[0-9a-f]{24}$/.test(action.id);
}
function validIcon(value,fallback=null) {
  return typeof value==='string' && /^mdi mdi-[a-z0-9-]{2,60}$/.test(value)?value:fallback;
}
function toAction(item) {
  // enabled === false keeps the slot but greys it out (e.g. "copy selection" without a selection).
  return {type:'action',id:item.id,label:String(item.label||'Aktion'),icon:validIcon(item.icon),
    enabled:item.enabled!==false};
}
function makeModel(state) {
  if(!state || !Array.isArray(state.items))return {items:[]};
  const items=[];
  for(const item of state.items.slice(0,100)) {
    if(validAction(item)) {
      items.push(toAction(item));
    } else if(item && item.type==='menu' && typeof item.id==='string' && Array.isArray(item.items)) {
      const children=item.items.filter(validAction).slice(0,150).map(toAction);
      if(children.length)items.push({type:'menu',id:item.id,label:String(item.label||'Plugin'),icon:validIcon(item.icon),items:children});
    }
  }
  return {items};
}
function folderItems(model,folder) {
  if(folder===null)return model.items;
  const child=model.items.find(x=>x.type==='menu' && x.id===folder);
  return child?.items||[];
}
function normalizeLocation(model,location) {
  const folder=location?.folder ?? null;
  if(folder!==null && !model.items.some(x=>x.type==='menu' && x.id===folder))return {folder:null,page:0};
  const items=folderItems(model,folder);
  const maxPage=Math.max(0,Math.ceil(items.length/SLOTS)-1);
  return {folder,page:Math.max(0,Math.min(Number.isInteger(location?.page)?location.page:0,maxPage))};
}
function getView(model,location) {
  const loc=normalizeLocation(model,location);
  const all=folderItems(model,loc.folder);
  const pages=Math.max(1,Math.ceil(all.length/SLOTS));
  return {...loc,items:all.slice(loc.page*SLOTS,(loc.page+1)*SLOTS),pages,total:all.length};
}
function navigate(model,location,role) {
  const view=getView(model,location);
  if(role==='prev') {
    // Zurück ALWAYS means parent/root, even on page 3 of a submenu.
    if(view.folder!==null)return {folder:null,page:0};
    return {folder:null,page:Math.max(0,view.page-1)};
  }
  if(role==='next')return {folder:view.folder,page:view.pages>1?(view.page+1)%view.pages:view.page};
  const ix=Number(String(role).replace(/^slot/,''))-1;
  if(!Number.isInteger(ix) || ix<0 || ix>=SLOTS)return view;
  const selected=view.items[ix];
  if(selected?.type==='menu')return {folder:selected.id,page:0};
  return {folder:view.folder,page:view.page};
}
function selectedAction(model,location,role) {
  if(!/^slot[1-6]$/.test(role))return null;
  const item=getView(model,location).items[Number(role.slice(4))-1];
  return item?.type==='action'?item:null;
}
function truncate(text,limit=16) {
  const raw=String(text||'').replace(/\s+/g,' ').trim();
  const chars=[...raw];
  return chars.length>limit ? chars.slice(0,limit-1).join('')+'…' : raw;
}
function displaysForLocation(model,location) {
  const view=getView(model,location);
  // Insertion order is drawing order: the six content slots first (that is what
  // the eye is on), the navigation keys afterwards.
  const displays={};
  for(let i=0;i<SLOTS;i++) {
    const item=view.items[i];
    displays[`slot${i+1}`]=item?{title:truncate(item.label,18),icon:item.icon,enabled:item.enabled!==false}:
      {title:'',icon:null};
  }
  // Use the same chevron family for both navigation keys, on every page.
  displays.prev={title:view.folder!==null?'Zurück':'Vorherige Seite',
    icon:'mdi mdi-chevron-left',enabled:view.folder!==null||view.page>0};
  displays.next={title:view.pages>1?`${view.page+1}/${view.pages}`:'Nächste Seite',
    icon:'mdi mdi-chevron-right',enabled:view.pages>1};
  return displays;
}

// Exactly one visible foreground component: icon if valid, otherwise title.
// This avoids the overlapping artwork/text seen on Flexbar firmware 2.2.5.
function visualForDisplay(display) {
  const icon=validIcon(display?.icon);
  const title=icon?'':truncate(display?.title,18);
  return {icon,title,showIcon:!!icon,showTitle:!icon&&!!title,
    enabled:display?.enabled!==false};
}
function visualSignature(display) {
  return JSON.stringify(visualForDisplay(display));
}

// True while the physical key may still show an outdated face. Only the pressed
// key matters: a pending redraw of key 5 must not swallow a tap on key 1.
function keyIsStale(session,role) {
  if(!session)return false;
  return session.pending.has(role) || session.painted.get(role)!==session.targets.get(role);
}

// Pause before the next menu request: long-poll responses come back only when
// something changed (short pause), failures back off 0.5 s, 1 s, 2 s, 4 s, 5 s.
function pollDelay({failures=0,longPoll=false,pollMs=2500}={}) {
  if(failures>0)return Math.min(5000,500*2**(failures-1));
  return longPoll?150:pollMs;
}

function titlesForLocation(model,location) {
  return Object.fromEntries(Object.entries(displaysForLocation(model,location)).map(([role,display])=>[role,display.title]));
}
module.exports={PREFIX,SLOTS,ROLES,OFFLINE_AFTER,roleFromCid,makeModel,folderItems,getView,
  normalizeLocation,navigate,selectedAction,titlesForLocation,displaysForLocation,
  visualForDisplay,visualSignature,validIcon,truncate,keyIsStale,pollDelay};
