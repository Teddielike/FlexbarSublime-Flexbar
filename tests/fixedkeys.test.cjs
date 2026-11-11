'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const EventEmitter=require('node:events');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/plugin.js'),'utf8');
const core=require(path.join(root,'src/core.js'));
const id=c=>String(c).repeat(24);
const state={schema:2,items:[
  {type:'action',label:'Speichern',id:id('1')},
  {type:'action',label:'Zeilenumbruch',id:id('2')},
  {type:'menu',id:'package:SFTP',label:'SFTP',items:[
    {type:'action',label:'Upload',id:id('3')},
    {type:'action',label:'Download',id:id('4')},
  ]},
]};
const key=(role,uid=role)=>({cid:'de.teddielike.flexbar-sublime-text.'+role,uid,style:{}});

function harness(mode,options={}) {
  const handlers={},calls=[],intervals=[],timers=[];
  let clock=Date.now();
  class MockDate extends Date{static now(){return clock;}}
  const sdk={plugin:{
    on:(name,fn)=>{handlers[name]=fn;},
    start:()=>calls.push(['start']),
    draw:(serial,k,type)=>{
      calls.push(['draw',serial,k.cid,k.title,type,{...k.style}]);
      return options.drawReject?Promise.reject(new Error('Plugin key is not alive')):Promise.resolve();
    }
  },logger:{info:()=>{},warn:()=>{},error:()=>{}}};
  const token='a'.repeat(64);
  const fakeFs={readFileSync:file=>{
    if(file.endsWith('/config.json'))return JSON.stringify({mode,drawIntervalMs:140,pollMs:2500,readyDelayMs:700});
    if(file.endsWith('FlexbarBridge.sublime-settings'))return JSON.stringify({token,port:17864});
    throw Error('No fixture: '+file);
  }};
  const fakeHttp={request:(opts,onResponse)=>{
    calls.push(['http',opts.method,opts.path]);
    const req=new EventEmitter();
    req.end=()=>queueMicrotask(()=>{
      // options.respond(opts,n) may script GET number n: {body,status} or {error}.
      const n=calls.filter(c=>c[0]==='http'&&c[1]===opts.method).length;
      const reply=options.respond&&opts.method==='GET'?options.respond(opts,n):null;
      if(reply&&reply.error)return req.emit('error',new Error(reply.error));
      const res=new EventEmitter();
      res.statusCode=reply?.status??(opts.method==='POST'?202:200);
      onResponse(res);
      const body=reply&&'body' in reply?reply.body:(opts.method==='POST'?{queued:true}:(options.state||state));
      if(body!==null)res.emit('data',JSON.stringify(body));
      res.emit('end');
    });
    return req;
  }};
  const mockRequire=id=>{
    if(id==='@eniac/flexdesigner')return sdk;
    if(id==='./core')return core;
    if(id==='node:fs')return fakeFs;
    if(id==='node:http')return fakeHttp;
    return require(id);
  };
  const fun=vm.runInNewContext('(function(require,__dirname,process,Buffer,setInterval,setTimeout){'+source+'})',
    {console,Date:MockDate,Promise,queueMicrotask}, {timeout:2000});
  fun(mockRequire,path.join(root,'de.teddielike.flexbar-sublime-text.plugin/backend'),process,Buffer,
    (cb,ms)=>{intervals.push({cb,ms});return intervals.length;},
    (cb,ms)=>{timers.push({cb,ms});return timers.length;});
  async function settle(){await new Promise(resolve=>setTimeout(resolve,4));}
  async function ticks(n=20){for(let i=0;i<n;i++){
    clock+=150;
    for(const it of intervals)if(it.ms===70)await it.cb();
    await settle();
  }}
  function press(serial,role){return handlers['plugin.data']({serialNumber:serial,data:{key:key(role)}});}
  // Fires the pending sleep() of the poll loop (its pause is faked, never waited).
  async function fireTimers(){const due=timers.splice(0);for(const t of due)t.cb();await settle();await settle();}
  const gets=()=>calls.filter(c=>c[0]==='http'&&c[1]==='GET').map(c=>c[2]);
  const posts=()=>calls.filter(c=>c[0]==='http'&&c[1]==='POST').length;
  return {handlers,calls,intervals,timers,press,settle,ticks,fireTimers,gets,posts,advance:ms=>{clock+=ms;}};
}

test('manifest contains only default keys; dynamic key API absent',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'de.teddielike.flexbar-sublime-text.plugin/manifest.json')));
  assert.equal(manifest.version,'1.0.0');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
  assert.equal(pkg.version,manifest.version);
  assert.ok(source.includes(`const VERSION='${manifest.version}'`));
  assert.equal(manifest.name,'Sublime Text');
  assert.equal(manifest.author,'Christian Sperber');
  assert.ok(manifest.keyLibrary.children.every(k=>k.style.showIcon===true));
  assert.equal(manifest.keyLibrary.children.length,9);
  assert.ok(manifest.keyLibrary.children.every(k=>k.config.keyType==='default'));
  assert.ok(!source.includes('plugin.dynamickey.'));
});

test('menu: Back always returns to root and page count is local to submenu',()=>{
  const model=core.makeModel(state);
  assert.equal(core.titlesForLocation(model,{folder:null,page:0}).slot3,'SFTP');
  assert.equal(core.titlesForLocation(model,{folder:null,page:0}).prev,'Vorherige Seite');
  const inside=core.navigate(model,{folder:null,page:0},'slot3');
  assert.deepEqual(inside,{folder:'package:SFTP',page:0});
  assert.equal(core.titlesForLocation(model,inside).prev,'Zurück');
  assert.equal(core.selectedAction(model,inside,'slot1').id,id('3'));
  assert.deepEqual(core.navigate(model,inside,'prev'),{folder:null,page:0});
});

test('submenu with 13 commands paginates, Back returns root',()=>{
  const model=core.makeModel({items:[{type:'menu',id:'sftp',label:'SFTP',items:
    Array.from({length:13},(_,i)=>({type:'action',label:'A'+i,id:String(i%10).repeat(24)}))}]});
  let loc=core.navigate(model,{folder:null,page:0},'slot1');
  assert.equal(core.getView(model,loc).pages,3);
  loc=core.navigate(model,loc,'next');
  assert.equal(core.titlesForLocation(model,loc).next,'2/3');
  loc=core.navigate(model,loc,'next');
  assert.equal(core.getView(model,loc).items.length,1);
  assert.equal(core.navigate(model,loc,'prev').folder,null);
  assert.equal(core.navigate(model,loc,'prev').page,0);
});

test('safe mode: no HTTP calls or drawings',async()=>{
  const h=harness('safe');
  h.handlers['plugin.alive']({serialNumber:'s',keys:[key('test'),key('slot1')]});
  assert.equal((await h.press('s','test')).status,'success');
  assert.deepEqual(h.calls,[['start']]);
});

test('actions mode: menu navigation is local and submenu execution works',async()=>{
  const h=harness('actions');
  h.handlers['plugin.alive']({serialNumber:'s',keys:[key('slot3'),key('slot1'),key('prev')]});
  await h.settle();
  assert.deepEqual(h.calls.filter(c=>c[0]==='http').map(c=>c.slice(1)),[['GET','/v1/menu']]);
  await h.press('s','slot3');
  await h.press('s','slot1');
  await h.settle();
  assert.deepEqual(h.calls.filter(c=>c[0]==='http').map(c=>c.slice(1)),[
    ['GET','/v1/menu'],['POST','/v1/action']]);
  await h.press('s','prev');
  await h.press('s','slot1');
  assert.equal(h.calls.filter(c=>c[0]==='draw').length,0);
});

test('adaptive mode paints only changed titles, and blocks action during redraw',async()=>{
  const h=harness('adaptive');
  h.handlers['plugin.alive']({serialNumber:'s',keys:
    ['prev','slot1','slot2','slot3','slot4','slot5','slot6','next'].map(r=>key(r))});
  await h.settle();
  assert.equal(h.calls.filter(c=>c[0]==='http').length,1);
  // Before the new title is confirmed on hardware, a tap cannot execute a stale action.
  assert.match((await h.press('s','slot1')).message,/aktualisiert/);
  h.advance(800);await h.ticks(12);
  assert.ok(h.calls.some(c=>c[0]==='draw'&&c[3]==='Zeilenumbruch'));
  assert.equal((await h.press('s','slot1')).status,'success');
  await h.press('s','slot3'); // opens SFTP
  assert.match((await h.press('s','slot1')).message,/aktualisiert/);
  await h.ticks(12);
  assert.equal((await h.press('s','slot1')).status,'success');
  await h.press('s','prev');
  await h.ticks(12);
  assert.ok(h.calls.filter(c=>c[0]==='http'&&c[1]==='GET').length===1);
});

test('SDK draw rejection stops all additional drawing calls',async()=>{
  const h=harness('visual-test',{drawReject:true});
  h.handlers['plugin.alive']({serialNumber:'s',keys:[key('test')]});
  h.advance(900);await h.ticks(12);
  assert.equal(h.calls.filter(c=>c[0]==='draw').length,1);
});

test('dead keys never get drawn',async()=>{
  const h=harness('visual-test');
  h.handlers['plugin.alive']({serialNumber:'s',keys:[key('test')]});
  h.handlers['plugin.dead']({serialNumber:'s',keys:[key('test')]});
  await h.ticks(10);
  assert.equal(h.calls.filter(c=>c[0]==='draw').length,0);
});


test('icon metadata is retained and hostile values fall back safely',()=>{
  const model=core.makeModel({items:[
    {type:'action',id:id('1'),label:'Speichern',icon:'mdi mdi-content-save'},
    {type:'action',id:id('2'),label:'Unsafe',icon:'<script>x</script>'},
    {type:'menu',id:'package:SFTP',label:'SFTP',icon:'mdi mdi-cloud-outline',items:[
      {type:'action',id:id('3'),label:'Upload',icon:'mdi mdi-cloud-upload'}
    ]}
  ]});
  const display=core.displaysForLocation(model,{folder:null,page:0});
  assert.equal(display.slot1.icon,'mdi mdi-content-save');
  assert.equal(display.slot2.icon,null);
  assert.equal(display.slot3.icon,'mdi mdi-cloud-outline');
  assert.equal(display.prev.title,'Vorherige Seite');
  assert.equal(display.prev.icon,'mdi mdi-chevron-left');
  assert.equal(display.next.icon,'mdi mdi-chevron-right');
  const folder=core.navigate(model,{folder:null,page:0},'slot3');
  assert.equal(core.displaysForLocation(model,folder).slot1.icon,'mdi mdi-cloud-upload');
  assert.equal(core.displaysForLocation(model,folder).prev.title,'Zurück');
});

test('adaptive paints only icons when icons exist, and shows text otherwise',async()=>{
  const h=harness('adaptive',{state:{items:[
    {type:'action',label:'Speichern',id:id('1'),icon:'mdi mdi-content-save'},
    {type:'action',label:'Zeilenumbruch',id:id('2'),icon:'mdi mdi-keyboard-return'},
    {type:'action',label:'Ohne Icon',id:id('3'),icon:null},
  ]}});
  h.handlers['plugin.alive']({serialNumber:'s',keys:
    [key('prev'),key('slot1'),key('slot2'),key('slot3'),key('next')]});
  await h.settle();h.advance(800);await h.ticks(20);
  const draws=h.calls.filter(c=>c[0]==='draw');
  const save=draws.find(c=>c[2].endsWith('slot1'));
  const wrap=draws.find(c=>c[2].endsWith('slot2'));
  const plain=draws.find(c=>c[2].endsWith('slot3'));
  const prev=draws.find(c=>c[2].endsWith('prev'));
  const next=draws.find(c=>c[2].endsWith('next'));
  for(const draw of [save,wrap,prev,next]){
    assert.equal(draw[3],'');
    assert.equal(draw[5].showIcon,true);
    assert.equal(draw[5].showTitle,false);
    assert.deepEqual(JSON.parse(JSON.stringify(draw[5].iconPos)),{X:50,Y:50});
  }
  assert.equal(save[5].icon,'mdi mdi-content-save');
  assert.equal(wrap[5].icon,'mdi mdi-keyboard-return');
  assert.equal(prev[5].icon,'mdi mdi-chevron-left');
  assert.equal(next[5].icon,'mdi mdi-chevron-right');
  assert.equal(plain[3],'Ohne Icon');
  assert.equal(plain[5].showIcon,false);
  assert.equal(plain[5].showTitle,true);
});

test('library keys have meaningful literal labels, tooltips and no text overlay',()=>{
  const m=JSON.parse(fs.readFileSync(path.join(root,'de.teddielike.flexbar-sublime-text.plugin/manifest.json')));
  for (const key of m.keyLibrary.children){
    assert.equal(key.style.showTitle,false);
    assert.equal(key.style.showIcon,true);
    assert.ok(!key.title.startsWith('$'));
    assert.ok(!key.tip.startsWith('$'));
    assert.ok(key.tip.length>35);
  }
  const map=Object.fromEntries(m.keyLibrary.children.map(k=>[k.data.role,k]));
  assert.equal(map.prev.style.icon,'mdi mdi-chevron-left');
  assert.equal(map.next.style.icon,'mdi mdi-chevron-right');
  assert.equal(map.slot1.title,'Menüplatz 1');
});

test('malicious or missing icons use readable text fallback',()=>{
  const plain=core.visualForDisplay({title:'Ohne Icon',icon:null});
  assert.equal(plain.title,'Ohne Icon');
  assert.equal(plain.showIcon,false);
  assert.equal(plain.showTitle,true);
  const evil=core.visualForDisplay({title:'Vorsicht',icon:'<script>'});
  assert.equal(evil.title,'Vorsicht');
  assert.equal(evil.showIcon,false);
  const icon=core.visualForDisplay({title:'Speichern',icon:'mdi mdi-content-save'});
  assert.equal(icon.title,'');
  assert.equal(icon.showTitle,false);
  assert.equal(icon.showIcon,true);
});


const hex=c=>String(c).repeat(16);
const base={items:[
  {type:'action',label:'Speichern',id:id('1'),icon:'mdi mdi-content-save'},
  {type:'action',label:'Zeilenumbruch',id:id('2'),icon:'mdi mdi-keyboard-return'},
  {type:'action',label:'Drittes',id:id('3'),icon:null},
]};
const aliveKeys=['prev','slot1','slot2','slot3','next'].map(r=>key(r));
async function paintAll(h){await h.settle();h.advance(800);await h.ticks(14);}

test('long-poll: second request waits on the reported version; 304 changes nothing',async()=>{
  const v=hex('a');
  const h=harness('adaptive',{respond:(opts,n)=>n===1?{body:{...base,version:v,longPoll:true}}:{status:304,body:null}});
  h.handlers['plugin.alive']({serialNumber:'s',keys:aliveKeys});
  await paintAll(h);
  assert.equal(h.timers.length,1);
  assert.equal(h.timers[0].ms,150);          // answer came back "long-poll style": short pause only
  await h.fireTimers();
  assert.deepEqual(h.gets(),['/v1/menu',`/v1/menu?wait=${v}&timeout=20`]);
  await h.fireTimers();                      // 304 -> keeps waiting with the same version
  assert.deepEqual(h.gets().slice(2),[`/v1/menu?wait=${v}&timeout=20`]);
  assert.equal((await h.press('s','slot1')).status,'success');
  assert.equal(h.posts(),1);
});

test('older bridge without longPoll: plain polling every pollMs, no ?wait=',async()=>{
  const h=harness('adaptive',{respond:()=>({body:base})});
  h.handlers['plugin.alive']({serialNumber:'s',keys:aliveKeys});
  await h.settle();
  assert.equal(h.timers[0].ms,2500);
  await h.fireTimers();
  assert.deepEqual(h.gets(),['/v1/menu','/v1/menu']);
});

test('one or two failed polls keep the menu; the third takes it offline; recovery restores it',async()=>{
  const v=hex('b');
  const ok={body:{...base,version:v,longPoll:true}};
  const h=harness('adaptive',{respond:(opts,n)=>n===1||n>=5?ok:{error:'Timeout Sublime Bridge'}});
  h.handlers['plugin.alive']({serialNumber:'s',keys:aliveKeys});
  await paintAll(h);
  const draws=()=>h.calls.filter(c=>c[0]==='draw').length;
  const before=draws();
  await h.fireTimers();                                   // failure 1 (retry in 500 ms)
  assert.equal(h.timers[0].ms,500);
  assert.equal((await h.press('s','slot1')).status,'success');
  await h.fireTimers();                                   // failure 2 (retry in 1 s)
  assert.equal(h.timers[0].ms,1000);
  assert.equal((await h.press('s','slot1')).status,'success');
  await h.fireTimers();                                   // failure 3 -> offline
  const offline=await h.press('s','slot1');
  assert.equal(offline.status,'error');
  assert.equal(offline.message,'Sublime-Bridge offline');
  await h.fireTimers();                                   // retry #4 still fails
  await h.fireTimers();                                   // #5 succeeds
  assert.equal((await h.press('s','slot1')).status,'success');
  await h.ticks(14);
  assert.equal(draws(),before,'a short outage must not repaint unchanged keys');
});

test('greyed-out action keeps its slot, is drawn dimmed and does nothing when tapped',async()=>{
  const h=harness('adaptive',{state:{items:[
    {type:'action',label:'Speichern',id:id('1'),icon:'mdi mdi-content-save'},
    {type:'action',label:'Auswahl kopieren',id:id('2'),icon:'mdi mdi-content-copy',enabled:false},
  ]}});
  h.handlers['plugin.alive']({serialNumber:'s',keys:aliveKeys});
  await paintAll(h);
  const draws=h.calls.filter(c=>c[0]==='draw');
  assert.equal(draws.find(c=>c[2].endsWith('slot1'))[5].fgColor,'#f0f3f6');
  assert.equal(draws.find(c=>c[2].endsWith('slot2'))[5].fgColor,'#637083');
  assert.match((await h.press('s','slot2')).message,/nicht verfügbar/);
  assert.equal(h.posts(),0);
  assert.equal((await h.press('s','slot1')).status,'success');
  assert.equal(h.posts(),1);
});

test('a pending redraw of one key does not block taps on keys that are up to date',async()=>{
  const changed={items:[base.items[0],base.items[1],{...base.items[2],label:'Viertes'}]};
  const h=harness('adaptive',{respond:(opts,n)=>n===1?{body:{...base,version:hex('1'),longPoll:true}}:
    n===2?{body:{...changed,version:hex('2'),longPoll:true}}:{status:304,body:null}});
  h.handlers['plugin.alive']({serialNumber:'s',keys:aliveKeys});
  await paintAll(h);
  await h.fireTimers();                  // bridge reports a change: only slot3 needs a redraw
  const first=await h.press('s','slot1');
  assert.equal(first.status,'success');
  assert.equal(first.message,undefined);
  assert.equal(h.posts(),1);
  assert.match((await h.press('s','slot3')).message,/aktualisiert/);
  assert.equal(h.posts(),1);
  await h.ticks(6);
  assert.equal((await h.press('s','slot3')).status,'success');
  assert.equal(h.posts(),2);
});

test('core: keyIsStale looks only at the pressed key',()=>{
  const s={pending:new Map([['slot5',{}]]),painted:new Map([['slot1','x']]),
    targets:new Map([['slot1','x'],['slot5','y']])};
  assert.equal(core.keyIsStale(s,'slot1'),false);
  assert.equal(core.keyIsStale(s,'slot5'),true);
  assert.equal(core.keyIsStale(null,'slot1'),false);
});

test('core: poll pauses and offline threshold',()=>{
  assert.equal(core.OFFLINE_AFTER,3);
  assert.equal(core.pollDelay({failures:0,longPoll:true,pollMs:2500}),150);
  assert.equal(core.pollDelay({failures:0,longPoll:false,pollMs:2500}),2500);
  assert.deepEqual([1,2,3,4,5,9].map(f=>core.pollDelay({failures:f})),[500,1000,2000,4000,5000,5000]);
});

test('core: enabled flag survives, content slots are drawn before navigation keys',()=>{
  const model=core.makeModel({items:[{type:'action',id:id('1'),label:'A'},
    {type:'action',id:id('2'),label:'B',enabled:false}]});
  const d=core.displaysForLocation(model,{folder:null,page:0});
  assert.equal(d.slot1.enabled,true);
  assert.equal(d.slot2.enabled,false);
  assert.deepEqual(Object.keys(d),['slot1','slot2','slot3','slot4','slot5','slot6','prev','next']);
  assert.equal(core.visualForDisplay(d.slot2).enabled,false);
  assert.equal(core.selectedAction(model,{folder:null,page:0},'slot2').enabled,false);
});
