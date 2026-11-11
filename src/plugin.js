'use strict';

// Flexbar Sublime: ONLY standard/fixed keys. No Dynamic Key API.
const VERSION='1.0.0';
const {plugin,logger}=require('@eniac/flexdesigner');
const {roleFromCid,makeModel,normalizeLocation,navigate,selectedAction,displaysForLocation,
  visualForDisplay,visualSignature,keyIsStale,pollDelay,OFFLINE_AFTER}=require('./core');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');

const CONFIG_PATH=path.resolve(__dirname,'../config.json');
const MODES=new Set(['safe','actions','visual-test','adaptive']);
// Long-poll: the bridge answers when the menu changes or after this many seconds (304).
const WAIT_SECONDS=20;
const WAIT_TIMEOUT_MS=(WAIT_SECONDS+6)*1000;
const QUICK_TIMEOUT_MS=3000;
function getConfiguration() {
  try {
    const data=JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8'));
    return {
      mode:MODES.has(data.mode)?data.mode:'safe',
      pollMs:Math.max(1500,Number(data.pollMs)||3000),
      drawIntervalMs:Math.max(80,Number(data.drawIntervalMs)||140),
      readyDelayMs:Math.max(350,Number(data.readyDelayMs)||700),
    };
  }catch(_){return {mode:'safe',pollMs:3000,drawIntervalMs:140,readyDelayMs:700};}
}
const config=getConfiguration();
const bridgeEnabled=config.mode==='actions'||config.mode==='adaptive';
const drawEnabled=config.mode==='adaptive'||config.mode==='visual-test';
const sessions=new Map();
let model=makeModel(null);
let signature='';          // non-empty while the bridge is considered online
let serverVersion='';      // menu version reported by the bridge (enables long-poll)
let loopActive=false,failures=0;
let auth=null,authTime=0;
let drawFault=false,drawBusy=false,lastDrawAt=0;

function getSession(serial) {
  let s=sessions.get(serial);
  if(!s){s={serial,keys:new Map(),location:{folder:null,page:0},pending:new Map(),
    painted:new Map(),targets:new Map(),generation:0};sessions.set(serial,s);}
  return s;
}
function bridgeSettings() {
  if(auth && Date.now()-authTime<15000)return auth;
  authTime=Date.now();auth=null;
  const home=os.homedir();
  let dirs;
  if(process.platform==='darwin')dirs=['Library/Application Support/Sublime Text/Packages/User',
    'Library/Application Support/Sublime Text 3/Packages/User'];
  else if(process.platform==='win32'){
    const base=process.env.APPDATA||path.join(home,'AppData','Roaming');
    dirs=[path.join(base,'Sublime Text','Packages','User'),path.join(base,'Sublime Text 3','Packages','User')];
  } else dirs=['.config/sublime-text/Packages/User','.config/sublime-text-3/Packages/User'];
  for(const dir of dirs){
    const file=path.join(path.isAbsolute(dir)?'':home,dir,'FlexbarBridge.sublime-settings');
    try{
      const raw=fs.readFileSync(file,'utf8');
      const token=raw.match(/"token"\s*:\s*"([a-f0-9]{64})"/);
      const port=raw.match(/"port"\s*:\s*(\d+)/);
      const n=port?Number(port[1]):17864;
      if(token && n>=1024 && n<=65535){auth={token:token[1],port:n};break;}
    }catch(_){/* no settings */}
  }
  return auth;
}
// Resolves with the parsed JSON body, or null for "304 Not Modified" (long-poll timeout).
function bridgeRequest(method,endpoint,obj,timeoutMs=1400) {
  return new Promise((resolve,reject)=>{
    const cfg=bridgeSettings();
    if(!cfg)return reject(new Error('Sublime Bridge nicht gefunden'));
    const body=obj?JSON.stringify(obj):'';
    const req=http.request({hostname:'127.0.0.1',port:cfg.port,path:endpoint,method,
      timeout:timeoutMs,headers:{Authorization:'Bearer '+cfg.token,
        'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      let content='';
      res.on('data',chunk=>{if(content.length<1048576)content+=chunk;});
      res.on('end',()=>{
        if(res.statusCode===304)return resolve(null);
        try{
          const payload=JSON.parse(content);
          if(res.statusCode>=300)return reject(new Error(payload.error||'HTTP '+res.statusCode));
          resolve(payload);
        }catch(e){reject(e);}
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Timeout Sublime Bridge')));
    req.on('error',reject);
    req.end(body);
  });
}
function scheduleTitles(s) {
  if(!drawEnabled||drawFault)return;
  // Do not draw meaningless offline titles until the first live menu is available.
  if(config.mode==='adaptive'&&!signature)return;
  const displays=config.mode==='visual-test'?{test:{title:'ZEICHNEN OK',icon:'mdi mdi-check-circle'}}:
    displaysForLocation(model,s.location);
  s.generation++;
  s.pending.clear();s.targets.clear();
  for(const [role,display] of Object.entries(displays)){
    const signature=visualSignature(display);
    s.targets.set(role,signature);
    if(!s.keys.has(role))continue;
    if(s.painted.get(role)!==signature)s.pending.set(role,{display,signature,generation:s.generation});
  }
}
async function drawTick() {
  if(!drawEnabled||drawFault||drawBusy||Date.now()-lastDrawAt<config.drawIntervalMs)return;
  for(const s of sessions.values()){
    const next=s.pending.entries().next().value;
    if(!next)continue;
    const [role,task]=next;
    const registration=s.keys.get(role);
    if(!registration||task.generation!==s.generation){s.pending.delete(role);continue;}
    if(Date.now()<registration.readyAt)continue;
    s.pending.delete(role);
    drawBusy=true;lastDrawAt=Date.now();
    try{
      if(sessions.get(s.serial)!==s||s.keys.get(role)!==registration)continue;
      const key=registration.key;
      const visual=visualForDisplay(task.display);
      key.style={...(key.style||{}),
        showTitle:visual.showTitle,showIcon:visual.showIcon,showEmoji:false,
        icon:visual.icon||'',fontSize:20,iconSize:40,
        iconPos:{X:50,Y:50},titlePos:{X:50,Y:50},
        fgColor:visual.enabled?'#f0f3f6':'#637083'};
      // An empty title also protects against renderers that ignore showTitle.
      key.title=visual.title;
      await Promise.resolve(plugin.draw(s.serial,key,'draw'));
      if(sessions.get(s.serial)===s&&s.keys.get(role)===registration&&task.generation===s.generation)
        s.painted.set(role,task.signature);
    }catch(e){
      drawFault=true;
      for(const ss of sessions.values())ss.pending.clear();
      logger.error('Sublime: drawing disabled after SDK error: '+String(e?.message||e));
    }finally{drawBusy=false;}
    break;
  }
}

function applyMenuState(state) {
  const next=typeof state.version==='string'&&state.version?state.version:JSON.stringify(state.items);
  if(next===signature)return;
  signature=next;
  model=makeModel(state);
  for(const s of sessions.values()){
    s.location=normalizeLocation(model,s.location);
    if(config.mode==='adaptive')scheduleTitles(s);
  }
  logger.info(`Sublime: configured menu has ${model.items.length} root items`);
}
// Only called after OFFLINE_AFTER consecutive failures. The keys keep their last
// faces (no flood of "offline" redraws); taps report that Sublime is unreachable.
function markOffline(e) {
  if(!signature)return;
  logger.warn('Sublime: Bridge offline: '+String(e?.message||e));
  signature='';serverVersion='';model=makeModel(null);
  for(const s of sessions.values()){s.location={folder:null,page:0};s.pending.clear();s.targets.clear();}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// One sequential loop instead of a fixed timer. With a bridge that supports it, each
// request waits server-side until the menu changes, so edits, focus changes and
// selection changes show up immediately and an idle Sublime is not queried at all.
// An older bridge answers at once without "longPoll"; then we poll every pollMs.
async function pollLoop() {
  if(loopActive)return;
  loopActive=true;
  try{
    while(bridgeEnabled&&sessions.size){
      let longPoll=false;
      try{
        const waiting=!!serverVersion&&!!signature;
        const state=await bridgeRequest('GET',
          waiting?`/v1/menu?wait=${serverVersion}&timeout=${WAIT_SECONDS}`:'/v1/menu',
          null,waiting?WAIT_TIMEOUT_MS:QUICK_TIMEOUT_MS);
        if(state===null){
          longPoll=true;  // unchanged after waiting
        }else{
          if(!Array.isArray(state.items))throw new Error('Invalid /v1/menu state');
          applyMenuState(state);
          serverVersion=typeof state.version==='string'?state.version:'';
          longPoll=state.longPoll===true&&!!serverVersion;
        }
        failures=0;
      }catch(e){
        failures++;auth=null;  // re-read port/token: the bridge may have restarted
        if(failures>=OFFLINE_AFTER)markOffline(e);
        else logger.warn(`Sublime: Bridge nicht erreichbar (${failures}/${OFFLINE_AFTER}): ${String(e?.message||e)}`);
      }
      await sleep(pollDelay({failures,longPoll,pollMs:config.pollMs}));
    }
  }finally{loopActive=false;}
}
plugin.on('plugin.alive',payload=>{
  const serial=payload?.serialNumber;
  if(typeof serial!=='string'||!serial)return;
  const s=getSession(serial);
  let count=0;
  for(const key of payload?.keys||[]){
    const role=roleFromCid(key?.cid);
    if(!role||key.uid===undefined||key.uid===null)continue;
    s.keys.set(role,{key,uid:String(key.uid),readyAt:Date.now()+config.readyDelayMs});
    s.painted.delete(role);count++;
  }
  if(count){
    logger.info(`Sublime: ${count} standard keys alive; mode=${config.mode}`);
    scheduleTitles(s);
    if(bridgeEnabled)pollLoop().catch(e=>logger.warn(String(e)));
  }
});
plugin.on('plugin.dead',payload=>{
  const s=sessions.get(payload?.serialNumber);
  if(!s)return;
  const keys=payload?.keys;
  if(!Array.isArray(keys)||!keys.length){sessions.delete(s.serial);return;}
  for(const key of keys){
    const role=roleFromCid(key?.cid);const reg=s.keys.get(role);
    if(reg&&(key.uid===undefined||key.uid===null||String(key.uid)===reg.uid)){
      s.keys.delete(role);s.pending.delete(role);s.painted.delete(role);s.targets.delete(role);
    }
  }
  s.generation++;
  if(!s.keys.size)sessions.delete(s.serial);
});
plugin.on('plugin.data',async payload=>{
  const serial=payload?.serialNumber,key=payload?.data?.key;
  const role=roleFromCid(key?.cid);
  if(!role||typeof serial!=='string')return;
  const s=sessions.get(serial),reg=s?.keys.get(role);
  if(!reg||String(key.uid)!==reg.uid)return;
  if(role==='test')return {status:'success',message:'TEST-Taste erkannt'};
  if(!bridgeEnabled)return {status:'success',message:'safe: keine Aktionen'};
  if(!signature)return {status:'error',message:'Sublime-Bridge offline'};
  if(role==='prev'||role==='next'){
    const next=navigate(model,s.location,role);
    if(next.folder!==s.location.folder||next.page!==s.location.page){
      s.location=next;if(config.mode==='adaptive')scheduleTitles(s);
    }
    return {status:'success'};
  }
  const entry=selectedAction(model,s.location,role);
  if(!entry){
    const next=navigate(model,s.location,role);
    if(next.folder!==s.location.folder||next.page!==s.location.page){
      s.location=next;if(config.mode==='adaptive')scheduleTitles(s);
    }
    return {status:'success'};
  }
  // Never execute an action while this key still shows an old label. Only this key
  // counts: a redraw of other keys in the background does not block the tap.
  if(config.mode==='adaptive'&&keyIsStale(s,role))
    return {status:'success',message:'Taste wird aktualisiert'};
  // Greyed-out keys (command currently unavailable in Sublime) do nothing.
  if(entry.enabled===false)return {status:'success',message:'Funktion derzeit nicht verfügbar'};
  try{
    await bridgeRequest('POST','/v1/action',{id:entry.id});
    return {status:'success'};
  }catch(e){
    logger.warn('Sublime: command rejected: '+String(e?.message||e));
    return {status:'error',message:'Sublime-Befehl fehlgeschlagen'};
  }
});

plugin.start();
if(drawEnabled)setInterval(()=>drawTick().catch(e=>logger.error(String(e))),70);
logger.info(`Sublime FixedKeys v${VERSION} started: ${config.mode}; no Dynamic Keys API`);
