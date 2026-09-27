(function(){
"use strict";
const LS_KEY='readOS.v1';
const SAVE_VERSION=1;
const MS = {h:3600000,m:60000,s:1000};
const MILESTONES = [1,5,10,25,50,100,250,500,1000];

function uid(p){return p+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function pad(n){return String(n).padStart(2,'0');}
function fmtHMS(ms){ if(ms<0)ms=0; const h=Math.floor(ms/MS.h),m=Math.floor((ms%MS.h)/MS.m),s=Math.floor((ms%MS.m)/MS.s); return pad(h)+':'+pad(m)+':'+pad(s); }
function fmtShort(ms){ if(ms<0)ms=0; const h=Math.floor(ms/MS.h),m=Math.floor((ms%MS.h)/MS.m),s=Math.floor((ms%MS.m)/MS.s);
  if(h>0) return h+'h '+m+'m'; if(m>0) return m+'m '+s+'s'; return s+'s'; }
function dayKey(ts){ const d=new Date(ts); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function startOfDay(ts){ const d=new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function startOfWeek(ts){ const d=new Date(startOfDay(ts)); const day=d.getDay(); d.setDate(d.getDate()-day); return d.getTime(); }
function startOfMonth(ts){ const d=new Date(ts); return new Date(d.getFullYear(),d.getMonth(),1).getTime(); }

// ---------- STATE ----------
function defaultState(){
  return { version:SAVE_VERSION, sessions:[], books:[],
    settings:{accentColor:'cyan',timeFormat:24,soundEnabled:true,animationsEnabled:true,visualMode:'immersive',confirmDelete:true,dailyGoalMin:0,weeklyGoalMin:0,displayName:''},
    activeSession:null, ackMilestones:[], createdAt:new Date().toISOString() };
}

// Normalize a state object in place so older/missing fields never crash the
// app: fills in anything introduced by later versions with safe defaults.
function normalizeState(s){
  if(!Array.isArray(s.sessions)) s.sessions=[];
  if(!Array.isArray(s.books)) s.books=[];
  if(!Array.isArray(s.ackMilestones)) s.ackMilestones=[];
  s.sessions.forEach(sess=>{
    if(typeof sess.notes!=='string') sess.notes='';
    if(typeof sess.duration!=='number' || sess.duration<0) sess.duration=Math.max(0,(sess.endTime||0)-(sess.startTime||0));
  });
  s.books.forEach(b=>{
    if(!b.status || typeof b.status!=='string') b.status='to-read';
  });
  if(s.activeSession){
    const a=s.activeSession;
    if(typeof a.pausedMs!=='number') a.pausedMs=0;
    if(a.pauseStart!==null && typeof a.pauseStart!=='number') a.pauseStart=null;
    if(typeof a.milestoneHit!=='boolean') a.milestoneHit=false;
    // Guard against an impossible restored session (e.g. a corrupted or
    // tampered timestamp putting the start time in the future).
    if(typeof a.startTime!=='number' || a.startTime>Date.now()){
      s.activeSession=null;
    }
  }
  if(!s.settings || typeof s.settings!=='object') s.settings={};
  const defSettings=defaultState().settings;
  s.settings = Object.assign({}, defSettings, s.settings);
  s.version = SAVE_VERSION;
  return s;
}

let state = loadState();
function loadState(){
  try{
    const raw=localStorage.getItem(LS_KEY);
    if(!raw) return defaultState();
    const d=JSON.parse(raw);
    const def=defaultState();
    const merged=Object.assign(def,d,{settings:Object.assign({},def.settings,d.settings||{})});
    return normalizeState(merged);
  }catch(e){ return defaultState(); }
}
function save(){ state.version=SAVE_VERSION; localStorage.setItem(LS_KEY, JSON.stringify(state)); }

function activeElapsed(nowTs){
  if(!state.activeSession) return 0;
  const s=state.activeSession;
  let paused = s.pausedMs||0;
  if(s.pauseStart) paused += (nowTs - s.pauseStart);
  return Math.max(0, nowTs - s.startTime - paused);
}
function activeEffectiveEnd(nowTs){ return state.activeSession ? state.activeSession.startTime + activeElapsed(nowTs) : nowTs; }

// ---------- DERIVED: split a session's ms across the days it spans ----------
function splitByDay(start,end){
  const out=[]; let cur=start;
  while(cur<end){
    const dayEnd = startOfDay(cur)+MS.h*24;
    const segEnd = Math.min(end,dayEnd);
    out.push({day:dayKey(cur), ms:segEnd-cur});
    cur=segEnd;
  }
  return out;
}
function allDaySegments(){
  const segs=[];
  state.sessions.forEach(s=>splitByDay(s.startTime,s.endTime).forEach(x=>segs.push(x)));
  if(state.activeSession) splitByDay(state.activeSession.startTime, activeEffectiveEnd(Date.now())).forEach(x=>segs.push(x));
  return segs;
}
function totalForRange(fromTs,toTs){
  let t=0;
  state.sessions.forEach(s=>{ const a=Math.max(s.startTime,fromTs), b=Math.min(s.endTime,toTs); if(b>a) t+=b-a; });
  if(state.activeSession){ const a=Math.max(state.activeSession.startTime,fromTs), b=Math.min(activeEffectiveEnd(Date.now()),toTs); if(b>a) t+=b-a; }
  return t;
}
function lifetimeTotal(){ let t=state.sessions.reduce((a,s)=>a+s.duration,0); if(state.activeSession) t+=activeElapsed(Date.now()); return t; }
function dayTotalsMap(){
  const m={}; allDaySegments().forEach(x=>{ m[x.day]=(m[x.day]||0)+x.ms; }); return m;
}
function sessionCountsMap(){
  const m={}; state.sessions.forEach(s=>{ const k=dayKey(s.startTime); m[k]=(m[k]||0)+1; });
  if(state.activeSession){ const k=dayKey(state.activeSession.startTime); m[k]=(m[k]||0)+1; }
  return m;
}
function computeStreaks(){
  const totals=dayTotalsMap();
  const daysWithReading=new Set(Object.keys(totals).filter(k=>totals[k]>0));
  let current=0, cursor=startOfDay(Date.now());
  while(true){
    const k=dayKey(cursor);
    if(daysWithReading.has(k)){ current++; cursor-=MS.h*24; }
    else if(k===dayKey(Date.now())){ cursor-=MS.h*24; continue; }
    else break;
  }
  const sortedDays=[...daysWithReading].sort();
  let longest=0, run=0, prev=null;
  sortedDays.forEach(k=>{
    if(prev===null){ run=1; } else {
      const diff=(new Date(k)-new Date(prev))/MS.h/24;
      run = diff===1? run+1 : 1;
    }
    longest=Math.max(longest,run); prev=k;
  });
  return {current, longest};
}
function bookById(id){ return state.books.find(b=>b.id===id); }
function lastUsedBookId(){
  const sorted = state.sessions.filter(s=>s.bookId).sort((a,b)=>b.startTime-a.startTime);
  const id = sorted[0]?.bookId;
  return (id && bookById(id) && bookById(id).status!=='archived') ? id : null;
}
function bookStats(id){
  const secs = state.sessions.filter(s=>s.bookId===id);
  const t = secs.reduce((a,s)=>a+s.duration,0) + (state.activeSession && state.activeSession.bookId===id ? activeElapsed(Date.now()) : 0);
  return { total:t, count: secs.length + (state.activeSession && state.activeSession.bookId===id?1:0) };
}

// ---------- SESSION ID ----------
function nextSessionSeq(){
  const today = dayKey(Date.now()).replace(/-/g,'');
  const todays = state.sessions.filter(s=>s.id.includes('R-'+today));
  return String(todays.length+1).padStart(3,'0');
}

// ---------- CUSTOM CONFIRM (native confirm() is blocked in some sandboxed/embedded views) ----------
function showConfirm(message, onYes){
  const overlay=document.getElementById('confirmOverlay');
  document.getElementById('confirmMsg').textContent=message;
  overlay.classList.add('show');
  const yesBtn=document.getElementById('confirmYes'), noBtn=document.getElementById('confirmNo');
  function cleanup(){ overlay.classList.remove('show'); yesBtn.removeEventListener('click',yes); noBtn.removeEventListener('click',no); }
  function yes(){ cleanup(); onYes(); }
  function no(){ cleanup(); }
  yesBtn.addEventListener('click', yes);
  noBtn.addEventListener('click', no);
}

// ---------- FILE DOWNLOAD (uses the downloads capability if present; falls back to a plain link) ----------
async function offerDownload(filename, content, mime){
  try{
    if(window.claude && typeof window.claude.use==='function'){
      const downloads = await window.claude.use('downloads');
      if(downloads){
        const blob = content instanceof Blob ? content : new Blob([content], {type:mime});
        await downloads.save({filename, data:blob});
        return true;
      }
    }
  }catch(err){
    if(err && err.code==='declined') return false;
  }
  try{
    const blob = content instanceof Blob ? content : new Blob([content], {type:mime});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    return true;
  }catch(e2){ return false; }
}

function announce(msg){ const el=document.getElementById('srAnnounce'); if(el) el.textContent=msg; }

// ---------- TOAST ----------
let toastTimer=null;
function toast(msg, kind){
  const el=document.getElementById('toast'); el.textContent=msg;
  el.className='toast show'+(kind==='celebrate'?' celebrate':'');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'), 2600);
}

// ---------- SOUND (tiny synthesized blips, no external assets) ----------
let actx=null;
function beep(freq,dur,type){
  if(!state.settings.soundEnabled) return;
  try{
    actx = actx || new (window.AudioContext||window.webkitAudioContext)();
    const o=actx.createOscillator(), g=actx.createGain();
    o.type=type||'sine'; o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06,actx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,actx.currentTime+dur);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime+dur+0.02);
  }catch(e){}
}

// ---------- NAV ----------
let currentView='dashboard';
function setView(v){
  if(v==='books') bookDetailId=null;
  currentView=v;
  document.querySelectorAll('.navitem').forEach(n=>n.classList.toggle('active', n.dataset.view===v));
  render();
}
document.querySelectorAll('.navitem').forEach(n=>{
  n.addEventListener('click', ()=>setView(n.dataset.view));
});

// Global spacebar shortcut for start/stop — must never hijack Space from a
// focused interactive control (buttons, links, form fields, contenteditable).
const SPACE_IGNORE_TAGS = new Set(['INPUT','TEXTAREA','SELECT','BUTTON','A']);
document.addEventListener('keydown', e=>{
  if(e.code!=='Space') return;
  const el=document.activeElement;
  if(el){
    if(SPACE_IGNORE_TAGS.has(el.tagName)) return;
    if(el.isContentEditable) return;
    if(typeof el.closest==='function' && el.closest('[contenteditable="true"]')) return;
  }
  e.preventDefault();
  state.activeSession? stopSession(): startSession();
});

// ---------- APPLY SETTINGS ----------
function applySettings(){
  document.body.dataset.accent = state.settings.accentColor;
  document.body.dataset.motion = state.settings.animationsEnabled? 'on':'off';
  document.body.dataset.mode = state.settings.visualMode;
}

// ---------- GLOBAL SESSION INDICATOR (reuses the same timestamp-based timer, no second clock) ----------
function updateGlobalIndicator(){
  const badges=[document.getElementById('sidebarSessionBadge'), document.getElementById('topbarSessionBadge')];
  const s=state.activeSession;
  badges.forEach(b=>{
    if(!b) return;
    if(!s){ b.style.display='none'; return; }
    const paused = !!s.pauseStart;
    b.style.display='flex';
    b.classList.toggle('paused', paused);
    const elapsed = fmtHMS(activeElapsed(Date.now()));
    b.innerHTML = '<span class="blip"></span>'+(paused?'PAUSED ':'READING ')+elapsed;
  });
}
['sidebarSessionBadge','topbarSessionBadge'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('click', ()=>setView('dashboard'));
});

// ---------- ONLINE / OFFLINE STATUS (display-only; never affects session logic) ----------
function updateOnlineStatus(){
  const online = navigator.onLine!==false;
  const sidebarStatus=document.getElementById('sidebarStatus');
  const sidebarLed=document.getElementById('sidebarLed');
  const mobileStatusText=document.getElementById('mobileStatusText');
  const mobileLed=document.getElementById('mobileLed');
  if(sidebarStatus) sidebarStatus.textContent = online? 'SYSTEM ONLINE':'OFFLINE MODE';
  if(sidebarStatus) sidebarStatus.classList.toggle('offline', !online);
  if(sidebarLed) sidebarLed.classList.toggle('offline', !online);
  if(mobileStatusText) mobileStatusText.textContent = online? 'ONLINE':'OFFLINE';
  if(mobileStatusText) mobileStatusText.classList.toggle('offline', !online);
  if(mobileLed) mobileLed.classList.toggle('offline', !online);
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ---------- SESSION CONTROL ----------
let selectedBookId = null;
let selectedTarget = null; // ms or null
let customTargetMin = 30;
let tickInterval=null;

function startSession(){
  const now=Date.now();
  const seq = nextSessionSeq();
  const id = 'R-'+dayKey(now).replace(/-/g,'')+'-'+seq;
  state.activeSession = { id, startTime: now, bookId: selectedBookId || null, targetDuration: selectedTarget, milestoneHit:false, pausedMs:0, pauseStart:null };
  save();
  document.body.dataset.active='1';
  beep(660,.12,'square'); setTimeout(()=>beep(880,.12,'square'),90);
  render();
  runBootLog();
  startTicking();
  updateGlobalIndicator();
  announce('Reading session started.');
}
function stopSession(){
  if(!state.activeSession) return;
  const now=Date.now();
  const s=state.activeSession;
  const duration = activeElapsed(now);
  const rec = { id:s.id, startTime:s.startTime, endTime:s.startTime+duration, duration, bookId:s.bookId, targetDuration:s.targetDuration, notes:'' };
  state.sessions.push(rec);
  if(s.bookId){
    const b=bookById(s.bookId);
    if(b && b.status!=='completed' && b.status!=='archived') b.status='reading';
  }
  state.activeSession=null;
  save();
  document.body.dataset.active='0';
  document.body.dataset.paused='0';
  stopTicking();
  checkMilestones();
  beep(440,.15,'sawtooth');
  const todayTotal = totalForRange(startOfDay(now), now);
  toast('SESSION TERMINATED · '+fmtHMS(duration)+' SAVED');
  runStopLog(duration, todayTotal);
  render();
  updateGlobalIndicator();
  announce('Session stopped. '+fmtHMS(duration)+' saved.');
}
function pauseSession(){
  if(!state.activeSession || state.activeSession.pauseStart) return;
  state.activeSession.pauseStart = Date.now();
  save();
  document.body.dataset.paused='1';
  beep(330,.1,'sine');
  render();
  updateGlobalIndicator();
  announce('Session paused.');
}
function resumeSession(){
  if(!state.activeSession || !state.activeSession.pauseStart) return;
  state.activeSession.pausedMs = (state.activeSession.pausedMs||0) + (Date.now()-state.activeSession.pauseStart);
  state.activeSession.pauseStart = null;
  save();
  document.body.dataset.paused='0';
  beep(550,.1,'sine');
  render();
  updateGlobalIndicator();
  announce('Session resumed.');
}
function startTicking(){
  stopTicking();
  tickInterval = setInterval(tickUI, 250);
  tickUI();
}
function stopTicking(){ if(tickInterval){ clearInterval(tickInterval); tickInterval=null; } }
function tickUI(){
  if(!state.activeSession) return;
  const el=document.getElementById('liveTimer');
  const elapsed = activeElapsed(Date.now());
  if(el) el.textContent = fmtHMS(elapsed);
  const target = state.activeSession.targetDuration;
  if(target){
    const ring=document.getElementById('ringFg');
    const pct=Math.min(1, elapsed/target);
    if(ring){ const circumference=2*Math.PI*130; ring.style.strokeDasharray=circumference; ring.style.strokeDashoffset= circumference*(1-pct); }
    const gp=document.getElementById('goalProgressText'); if(gp) gp.textContent = fmtHMS(elapsed)+' / '+fmtHMS(target);
    const gf=document.getElementById('goalFill'); if(gf) gf.style.width=(pct*100)+'%';
    const gr=document.getElementById('goalRemain');
    if(gr) gr.textContent = elapsed>=target ? 'TARGET REACHED' : (fmtShort(target-elapsed)+' remaining');
    if(elapsed>=target && !state.activeSession.milestoneHit){
      state.activeSession.milestoneHit=true;
      save(); // persist immediately so a refresh doesn't re-trigger this notification
      toast('TARGET REACHED · OBJECTIVE COMPLETE','celebrate');
      beep(880,.1,'triangle'); setTimeout(()=>beep(1100,.15,'triangle'),100);
      const tr=document.getElementById('targetReachedMsg'); if(tr) tr.style.display='block';
    }
  } else {
    const ring=document.getElementById('ringFg');
    if(ring){ const circumference=2*Math.PI*130; const pct=(elapsed % 60000)/60000; ring.style.strokeDasharray=circumference; ring.style.strokeDashoffset= circumference*(1-pct); }
  }
  const now2=Date.now();
  if(state.settings.dailyGoalMin){
    const dGoal=state.settings.dailyGoalMin*MS.m, dCur=totalForRange(startOfDay(now2),now2);
    const df=document.getElementById('dailyGoalFill'), dt=document.getElementById('dailyGoalText');
    if(df) df.style.width=Math.min(100,dCur/dGoal*100)+'%';
    if(dt) dt.textContent = fmtHMS(Math.min(dCur,dGoal))+' / '+fmtHMS(dGoal)+(dCur>=dGoal?' · DONE':'');
  }
  if(state.settings.weeklyGoalMin){
    const wGoal=state.settings.weeklyGoalMin*MS.m, wCur=totalForRange(startOfWeek(now2),now2);
    const wf=document.getElementById('weeklyGoalFill'), wt=document.getElementById('weeklyGoalText');
    if(wf) wf.style.width=Math.min(100,wCur/wGoal*100)+'%';
    if(wt) wt.textContent = fmtHMS(Math.min(wCur,wGoal))+' / '+fmtHMS(wGoal)+(wCur>=wGoal?' · DONE':'');
  }
  updateGlobalIndicator();
}
function checkMilestones(){
  const totalH = lifetimeTotal()/MS.h;
  MILESTONES.forEach(m=>{
    if(totalH>=m && !state.ackMilestones.includes(m)){
      state.ackMilestones.push(m); save();
      setTimeout(()=>toast('MILESTONE: '+m+'H ACHIEVED','celebrate'), 900);
    }
  });
}

function runBootLog(){
  const box=document.getElementById('termlog'); if(!box) return;
  const lines=[
    '> INITIALIZING READING SESSION...',
    '> SESSION ID: '+state.activeSession.id,
    '> TIME TRACKING............... ACTIVE',
    '> READING ENGINE.............. ONLINE'
  ];
  box.innerHTML='';
  lines.forEach((l,i)=>{
    setTimeout(()=>{ const d=document.createElement('div'); d.textContent=l; box.appendChild(d); }, state.settings.animationsEnabled? i*140:0);
  });
}
function runStopLog(duration, todayTotal){
  const box=document.getElementById('termlog'); if(!box) return;
  box.innerHTML =
    '<div class="ok">> SESSION TERMINATED</div>'+
    '<div>READ TIME &nbsp; '+fmtHMS(duration)+'</div>'+
    '<div>TODAY TOTAL &nbsp; '+fmtHMS(todayTotal)+'</div>'+
    '<div class="ok">SESSION SAVED</div>';
}

// ---------- RESTORE ACTIVE SESSION ----------
if(state.activeSession){ document.body.dataset.active='1'; if(state.activeSession.pauseStart) document.body.dataset.paused='1'; }

// ---------- RENDER: DASHBOARD ----------
function viewDashboard(){
  const active = !!state.activeSession;
  const paused = !!(state.activeSession && state.activeSession.pauseStart);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="panel dash-hero" data-active="${active?1:0}">
      <div class="brand hide-desktop" style="margin-bottom:14px;">READ//OS</div>
      <div class="status-badge ${active?(paused?'paused':'active'):''}"><span class="blip"></span>${active?(paused?'SESSION PAUSED':'READING ACTIVE'):'SYSTEM READY'}</div>
      <div class="ring-wrap">
        <svg viewBox="0 0 280 280"><circle class="ring-bg" cx="140" cy="140" r="130"/><circle id="ringFg" class="ring-fg" cx="140" cy="140" r="130" style="stroke-dasharray:${2*Math.PI*130};stroke-dashoffset:${2*Math.PI*130}"/></svg>
        <div style="text-align:center;">
          <div class="timer" id="liveTimer">${active? fmtHMS(activeElapsed(Date.now())):'00:00:00'}</div>
          <div class="timer-sub">${active? (paused?'PAUSED':'ELAPSED'):'NO ACTIVE SESSION'}</div>
        </div>
      </div>
      <button class="startbtn ${active?'stop':'idle'}" id="mainBtn">${active? '■ STOP SESSION':'▶ START READING'}</button>
      ${active ? `<button class="pausebtn ${paused?'resume':''}" id="pauseBtn">${paused? '▶ RESUME':'❚❚ PAUSE'}</button>` : ''}

      ${active ? renderActiveExtras() : renderIdleExtras()}
      <div class="termlog" id="termlog"></div>
    </div>
    ${renderGoalsPanel()}
  `;
  return el;
}
function renderGoalsPanel(){
  const dailyMin = state.settings.dailyGoalMin||0, weeklyMin = state.settings.weeklyGoalMin||0;
  if(!dailyMin && !weeklyMin) return '';
  const now=Date.now();
  const dToday = totalForRange(startOfDay(now), now), dGoal = dailyMin*MS.m;
  const wToday = totalForRange(startOfWeek(now), now), wGoal = weeklyMin*MS.m;
  const block = (key,label, cur, goal) => goal ? `
    <div class="goalrow" style="margin-top:10px;"><span>${label}</span><span id="${key}GoalText">${fmtHMS(Math.min(cur,goal))} / ${fmtHMS(goal)}${cur>=goal?' · DONE':''}</span></div>
    <div class="bar"><div class="fill" id="${key}GoalFill" style="width:${Math.min(100,cur/goal*100)}%"></div></div>
  ` : '';
  return `<div class="panel"><div class="panel-label"><span>GOALS</span></div>${block('daily','DAILY',dToday,dGoal)}${block('weekly','WEEKLY',wToday,wGoal)}</div>`;
}
function renderIdleExtras(){
  const opts=[{l:'NO TARGET',v:null},{l:'15 MIN',v:15*MS.m},{l:'30 MIN',v:30*MS.m},{l:'1 HOUR',v:60*MS.m},{l:'CUSTOM',v:'custom'}];
  const chips = opts.map(o=>{
    const sel = (o.v===null&&selectedTarget===null) || (o.v===selectedTarget) || (o.v==='custom' && selectedTarget==='custom');
    return `<button type="button" class="chip ${sel?'sel':''}" data-target="${o.v===null?'':o.v}">${o.l}</button>`;
  }).join('');
  const customField = selectedTarget==='custom' ? `<div class="field" style="max-width:220px;margin:10px auto 0;"><label>CUSTOM MINUTES</label><input type="number" id="customMinInput" min="1" value="${customTargetMin}"></div>` : '';
  const bookOpts = state.books.filter(b=>b.status!=='archived').map(b=>`<option value="${b.id}" ${selectedBookId===b.id?'selected':''}>${escapeHtml(b.title)}</option>`).join('');
  const lastId = lastUsedBookId();
  const showQuickResume = lastId && selectedBookId!==lastId;
  return `
    <div class="targetpicker">${chips}</div>
    ${customField}
    <div class="booksel">
      <span>BOOK:</span>
      <select id="bookSelect"><option value="">— quick reading —</option>${bookOpts}</select>
    </div>
    ${showQuickResume ? `<button type="button" class="quickstart" id="quickResume">&gt; RESUME <span>${escapeHtml(bookById(lastId).title)}</span></button>` : ''}
  `;
}
function renderActiveExtras(){
  const s=state.activeSession;
  const book = s.bookId? bookById(s.bookId):null;
  let goalBlock='';
  if(s.targetDuration){
    const elapsed = activeElapsed(Date.now());
    const pct=Math.min(1,elapsed/s.targetDuration);
    goalBlock = `
      <div class="goalbar">
        <div class="goalrow"><span id="goalProgressText">${fmtHMS(elapsed)} / ${fmtHMS(s.targetDuration)}</span><span id="goalRemain">${elapsed>=s.targetDuration?'TARGET REACHED':fmtShort(s.targetDuration-elapsed)+' remaining'}</span></div>
        <div class="bar"><div class="fill" id="goalFill" style="width:${pct*100}%"></div></div>
        <div class="milestone" id="targetReachedMsg" style="display:${elapsed>=s.targetDuration?'block':'none'}">> READING OBJECTIVE COMPLETE</div>
      </div>`;
  }
  return `
    <div class="dash-meta">
      ${book?`<div><span class="k">BOOK</span>${escapeHtml(book.title)}</div>`:''}
      <div><span class="k">SESSION</span>${s.id}</div>
      <div><span class="k">TODAY</span>${fmtHMS(totalForRange(startOfDay(Date.now()),Date.now()))}</div>
    </div>
    ${goalBlock}
  `;
}

function bindDashboardEvents(root){
  const btn=root.querySelector('#mainBtn');
  if(btn) btn.addEventListener('click', ()=>{ state.activeSession? stopSession(): startSession(); });
  const pb=root.querySelector('#pauseBtn');
  if(pb) pb.addEventListener('click', ()=>{ (state.activeSession && state.activeSession.pauseStart) ? resumeSession() : pauseSession(); });
  root.querySelectorAll('.chip').forEach(c=>{
    c.addEventListener('click', ()=>{
      const v=c.dataset.target;
      if(v===''){selectedTarget=null;} else if(v==='undefined'){selectedTarget='custom';} else {selectedTarget=Number(v);}
      if(c.textContent.trim()==='CUSTOM') selectedTarget='custom';
      render();
    });
  });
  const cm=root.querySelector('#customMinInput');
  if(cm) cm.addEventListener('input', ()=>{ customTargetMin=Number(cm.value)||1; selectedTarget = customTargetMin*MS.m; });
  const bs=root.querySelector('#bookSelect');
  if(bs) bs.addEventListener('change', ()=>{ selectedBookId = bs.value||null; });
  const qr=root.querySelector('#quickResume');
  if(qr) qr.addEventListener('click', ()=>{ selectedBookId = lastUsedBookId(); render(); });
}

// ---------- RENDER: SESSIONS ----------
let sessionFilter='all';
let sessionSort='desc';
let sessionSearch='';
let sessionFrom='';
let sessionTo='';
let editingSessionId=null;
function viewSessions(){
  const el=document.createElement('div');
  let list = state.sessions.slice();
  if(sessionFilter!=='all') list = list.filter(s=>s.bookId===sessionFilter);
  if(sessionSearch){
    const q=sessionSearch.toLowerCase();
    list = list.filter(s=>{
      const title=(s.bookId? (bookById(s.bookId)?.title||'') : '').toLowerCase();
      const notes=(s.notes||'').toLowerCase();
      return title.includes(q) || notes.includes(q);
    });
  }
  if(sessionFrom){ const f=new Date(sessionFrom+'T00:00:00').getTime(); list = list.filter(s=>s.startTime>=f); }
  if(sessionTo){ const t=new Date(sessionTo+'T23:59:59').getTime(); list = list.filter(s=>s.startTime<=t); }
  list.sort((a,b)=> sessionSort==='desc'? b.startTime-a.startTime : a.startTime-b.startTime);
  const bookOpts = state.books.map(b=>`<option value="${b.id}" ${sessionFilter===b.id?'selected':''}>${escapeHtml(b.title)}</option>`).join('');
  const noFiltersActive = sessionFilter==='all' && !sessionSearch && !sessionFrom && !sessionTo;
  const rowsHtml = list.length ? list.map(s=>{
    const d=new Date(s.startTime);
    const dateStr = pad(d.getMonth()+1)+'/'+pad(d.getDate())+' '+fmtClock(d);
    const bookTitle = s.bookId ? (bookById(s.bookId)?.title || 'Deleted book') : '—';
    const isEditing = editingSessionId===s.id;
    const row = `<div class="row"><span class="rmeta" style="width:100px;flex-shrink:0;">${dateStr}</span><span class="rmeta" style="width:74px;flex-shrink:0;color:var(--accent)">${fmtHMS(s.duration)}</span><span class="rtitle">${escapeHtml(bookTitle)}${s.notes?' <span style="color:var(--text-dim)">— '+escapeHtml(s.notes)+'</span>':''}</span><button class="iconbtn" data-editsess="${s.id}" aria-label="Edit session">✎</button><button class="iconbtn del" data-delsess="${s.id}" aria-label="Delete session">✕</button></div>`;
    const editForm = isEditing ? `
      <div class="editpanel">
        <div class="field"><label>DURATION (MINUTES)</label><input type="number" id="editDurMin" min="0" value="${Math.round(s.duration/MS.m)}"></div>
        <div class="field"><label>BOOK</label><select id="editBookSel"><option value="">— quick reading —</option>${state.books.map(b=>`<option value="${b.id}" ${s.bookId===b.id?'selected':''}>${escapeHtml(b.title)}</option>`).join('')}</select></div>
        <div class="field"><label>NOTES</label><input type="text" id="editNotes" maxlength="140" value="${escapeHtml(s.notes||'')}"></div>
        <div class="btnrow"><button class="btn primary" data-savesess="${s.id}">SAVE</button><button class="btn" data-cancelsess="1">CANCEL</button></div>
      </div>` : '';
    return row + editForm;
  }).join('') : (
    noFiltersActive
      ? `<div class="empty">SESSION LOG<br><br>&gt; NO SESSION DATA FOUND<br><br>BEGIN READING TO INITIALIZE HISTORY.<button type="button" class="btn primary" data-gostartreading>▶ START READING</button></div>`
      : `<div class="empty">SESSION LOG<br><br>&gt; NO MATCHING RECORDS<br><br>TRY CLEARING FILTERS.</div>`
  );

  el.innerHTML = `
    <div class="panel">
      <div class="panel-label"><span>SESSION LOG</span><span>${list.length} RECORDS</span></div>
      <div class="field"><input type="text" id="sessSearch" placeholder="Search book title or notes..." value="${escapeHtml(sessionSearch)}"></div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <select id="sessFilter" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:6px 10px;border-radius:4px;font-family:var(--font);font-size:10px;"><option value="all">ALL BOOKS</option>${bookOpts}</select>
        <select id="sessSort" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:6px 10px;border-radius:4px;font-family:var(--font);font-size:10px;"><option value="desc" ${sessionSort==='desc'?'selected':''}>NEWEST FIRST</option><option value="asc" ${sessionSort==='asc'?'selected':''}>OLDEST FIRST</option></select>
        <input type="date" id="sessFrom" value="${sessionFrom}" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:6px 10px;border-radius:4px;font-family:var(--font);font-size:10px;">
        <input type="date" id="sessTo" value="${sessionTo}" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);padding:6px 10px;border-radius:4px;font-family:var(--font);font-size:10px;">
        ${(sessionSearch||sessionFrom||sessionTo||sessionFilter!=='all')?'<button class="btn" id="sessClearFilters">CLEAR FILTERS</button>':''}
      </div>
      <div class="rows">${rowsHtml}</div>
    </div>
  `;
  return el;
}
function fmtClock(d){
  if(state.settings.timeFormat===24) return pad(d.getHours())+':'+pad(d.getMinutes());
  let h=d.getHours()%12; if(h===0)h=12; return h+':'+pad(d.getMinutes())+(d.getHours()<12?'am':'pm');
}
function bindSessionsEvents(root){
  root.querySelector('#sessFilter').addEventListener('change', e=>{ sessionFilter=e.target.value; render(); });
  root.querySelector('#sessSort').addEventListener('change', e=>{ sessionSort=e.target.value; render(); });
  const searchInput=root.querySelector('#sessSearch');
  searchInput.addEventListener('change', e=>{ sessionSearch=e.target.value.trim(); render(); });
  searchInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ sessionSearch=e.target.value.trim(); render(); } });
  root.querySelector('#sessFrom').addEventListener('change', e=>{ sessionFrom=e.target.value; render(); });
  root.querySelector('#sessTo').addEventListener('change', e=>{ sessionTo=e.target.value; render(); });
  const clearBtn=root.querySelector('#sessClearFilters');
  if(clearBtn) clearBtn.addEventListener('click', ()=>{ sessionSearch=''; sessionFrom=''; sessionTo=''; sessionFilter='all'; render(); });
  const goStart=root.querySelector('[data-gostartreading]');
  if(goStart) goStart.addEventListener('click', ()=>setView('dashboard'));
  root.querySelectorAll('[data-editsess]').forEach(b=>b.addEventListener('click', ()=>{ editingSessionId=b.dataset.editsess; render(); }));
  root.querySelectorAll('[data-cancelsess]').forEach(b=>b.addEventListener('click', ()=>{ editingSessionId=null; render(); }));
  root.querySelectorAll('[data-savesess]').forEach(b=>b.addEventListener('click', ()=>{
    const s = state.sessions.find(x=>x.id===b.dataset.savesess); if(!s) return;
    let mins = Number(document.getElementById('editDurMin').value)||0;
    mins = Math.max(0, mins);
    let duration = mins*MS.m;
    let endTime = s.startTime + duration;
    // A historical session can never be edited into ending in the future.
    if(endTime > Date.now()){
      endTime = Date.now();
      duration = Math.max(0, endTime - s.startTime);
      toast('DURATION ADJUSTED · CANNOT END IN THE FUTURE');
    }
    s.duration = duration;
    s.endTime = endTime;
    s.bookId = document.getElementById('editBookSel').value || null;
    s.notes = document.getElementById('editNotes').value.trim();
    editingSessionId=null; save(); render(); toast('SESSION UPDATED');
  }));
  root.querySelectorAll('[data-delsess]').forEach(b=>b.addEventListener('click', ()=>{
    const id=b.dataset.delsess;
    const doDelete=()=>{ state.sessions = state.sessions.filter(s=>s.id!==id); save(); render(); toast('SESSION DELETED'); };
    if(state.settings.confirmDelete) showConfirm('Delete this session? This cannot be undone.', doDelete);
    else doDelete();
  }));
}

// ---------- RENDER: BOOKS ----------
let editingBookId=null;
let bookDetailId=null;
const BOOK_STATUSES=['to-read','reading','paused','completed','archived'];
function viewBooks(){
  const el=document.createElement('div');
  const list = state.books;
  const rows = list.length ? list.map(b=>{
    const bs=bookStats(b.id);
    const isSel = selectedBookId===b.id;
    const row = `<div class="row" data-book="${b.id}" role="button" tabindex="0">
      <span class="rtitle">[${isSel?'RUN':' '}] ${escapeHtml(b.title)}${b.author?' <span style=\"color:var(--text-dim)\">— '+escapeHtml(b.author)+'</span>':''}</span>
      <span class="tag ${b.status}">${b.status.toUpperCase()}</span>
      <span class="rmeta">${fmtHMS(bs.total)}</span>
      <button class="iconbtn" data-viewbook="${b.id}" aria-label="View book details">›</button>
      <button class="iconbtn" data-editbook="${b.id}" aria-label="Edit book">✎</button>
      <button class="iconbtn del" data-delbook="${b.id}" aria-label="Delete book">✕</button>
    </div>`;
    const editForm = editingBookId===b.id ? `
      <div class="editpanel">
        <div class="field"><label>TITLE</label><input type="text" id="editBkTitle" maxlength="120" value="${escapeHtml(b.title)}"></div>
        <div class="field"><label>AUTHOR</label><input type="text" id="editBkAuthor" maxlength="120" value="${escapeHtml(b.author||'')}"></div>
        <div class="field"><label>STATUS</label><select id="editBkStatus">${BOOK_STATUSES.map(st=>`<option value="${st}" ${b.status===st?'selected':''}>${st.toUpperCase()}</option>`).join('')}</select></div>
        <div class="btnrow"><button class="btn primary" data-savebook="${b.id}">SAVE</button><button class="btn" data-cancelbook="1">CANCEL</button></div>
      </div>` : '';
    return row + editForm;
  }).join('') : `<div class="empty">BOOK DATABASE EMPTY<br><br>&gt; ADD YOUR FIRST BOOK<button type="button" class="btn primary" data-focusaddbook>+ ADD YOUR FIRST BOOK</button></div>`;
  el.innerHTML = `
    <div class="panel">
      <div class="panel-label"><span>READING QUEUE</span><span>${list.length} BOOKS</span></div>
      <div class="rows">${rows}</div>
    </div>
    <div class="panel">
      <div class="panel-label"><span>ADD BOOK</span></div>
      <div class="field"><label>TITLE</label><input id="bkTitle" type="text" placeholder="Book title" maxlength="120"></div>
      <div class="field"><label>AUTHOR (OPTIONAL)</label><input id="bkAuthor" type="text" placeholder="Author name" maxlength="120"></div>
      <div class="btnrow"><button class="btn primary" id="bkAdd">+ ADD BOOK</button></div>
    </div>
  `;
  return el;
}
function viewBookDetail(id){
  const el=document.createElement('div');
  const b=bookById(id);
  if(!b){ bookDetailId=null; return viewBooks(); }
  const bs=bookStats(id);
  const secs = state.sessions.filter(s=>s.bookId===id).sort((a,x)=>x.startTime-a.startTime);
  const firstSess = state.sessions.filter(s=>s.bookId===id).sort((a,x)=>a.startTime-x.startTime)[0];
  const daySpan = firstSess ? Math.max(1, Math.round((Date.now()-firstSess.startTime)/(MS.h*24))) : 0;
  const rowsHtml = secs.length ? secs.map(s=>{
    const d=new Date(s.startTime); const dateStr = pad(d.getMonth()+1)+'/'+pad(d.getDate())+' '+fmtClock(d);
    return `<div class="row"><span class="rmeta" style="width:100px;flex-shrink:0;">${dateStr}</span><span class="rmeta" style="color:var(--accent)">${fmtHMS(s.duration)}</span>${s.notes?`<span class="rtitle">${escapeHtml(s.notes)}</span>`:''}</div>`;
  }).join('') : `<div class="empty">NO SESSIONS LOGGED FOR THIS BOOK YET</div>`;
  const dayTotals={};
  secs.forEach(s=>splitByDay(s.startTime,s.endTime).forEach(x=>{ dayTotals[x.day]=(dayTotals[x.day]||0)+x.ms; }));
  const days=84; const todayStart=startOfDay(Date.now());
  const cells=[]; for(let i=days-1;i>=0;i--){ const ts=todayStart-i*MS.h*24; const k=dayKey(ts); cells.push({k, ms:dayTotals[k]||0}); }
  const max=Math.max(1,...cells.map(c=>c.ms));
  const heat = cells.map(c=>{ const inten=c.ms<=0?0:c.ms/max; let bg='var(--border)', op='1';
    if(inten>0.66){bg='var(--accent)';} else if(inten>0){bg='var(--accent-dim)'; op = inten>0.33?'1':'0.4';}
    return `<div class="hcell" tabindex="0" role="button" aria-label="${c.k}" data-day="${c.k}" data-ms="${c.ms}" data-count="0" style="background:${bg};opacity:${op}"></div>`; }).join('');
  el.innerHTML = `
    <button type="button" class="quickstart" id="backToBooks" style="margin-top:0;margin-bottom:16px;">‹ BACK TO BOOKS</button>
    <div class="panel">
      <div class="panel-label"><span>${escapeHtml(b.title)}</span><span class="tag ${b.status}">${b.status.toUpperCase()}</span></div>
      ${b.author?`<div style="color:var(--text-dim);font-size:11px;margin-bottom:14px;">${escapeHtml(b.author)}</div>`:''}
      <div class="statgrid">
        <div class="statcard"><div class="lbl">TOTAL TIME</div><div class="val accent">${fmtHMS(bs.total)}</div></div>
        <div class="statcard"><div class="lbl">SESSIONS</div><div class="val">${bs.count}</div></div>
        <div class="statcard"><div class="lbl">DAYS SINCE START</div><div class="val">${daySpan}</div></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-label"><span>ACTIVITY</span></div>
      <div class="heatgrid">${heat}</div>
    </div>
    <div class="panel">
      <div class="panel-label"><span>SESSIONS</span></div>
      <div class="rows">${rowsHtml}</div>
    </div>
  `;
  return el;
}
function bindBookDetailEvents(root){
  const back=root.querySelector('#backToBooks');
  if(back) back.addEventListener('click', ()=>{ bookDetailId=null; render(); });
  root.querySelectorAll('.hcell').forEach(cell=>{
    const show=()=>{
      const pop=document.getElementById('daypopover');
      pop.innerHTML = `<div class="t">${cell.dataset.day}</div><div>READ TIME</div><div class="v">${fmtHMS(Number(cell.dataset.ms))}</div>`;
      pop.style.display='block';
      const rect=cell.getBoundingClientRect();
      let x = rect.left + rect.width/2 - 60; x=Math.max(8, Math.min(window.innerWidth-140, x));
      pop.style.left=x+'px'; pop.style.top=(rect.top-70+window.scrollY)+'px';
    };
    cell.addEventListener('mouseenter', show);
    cell.addEventListener('mouseleave', ()=>{ document.getElementById('daypopover').style.display='none'; });
    cell.addEventListener('click', show);
    cell.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); show(); } });
  });
}
function bindBooksEvents(root){
  root.querySelectorAll('[data-book]').forEach(r=>{
    const activate=()=>{ selectedBookId = selectedBookId===r.dataset.book? null : r.dataset.book; render(); };
    r.addEventListener('click', activate);
    r.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); activate(); } });
  });
  root.querySelectorAll('[data-viewbook]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); bookDetailId=b.dataset.viewbook; render(); }));
  root.querySelectorAll('[data-editbook]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); editingBookId=b.dataset.editbook; render(); }));
  root.querySelectorAll('[data-cancelbook]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); editingBookId=null; render(); }));
  root.querySelectorAll('[data-savebook]').forEach(b=>b.addEventListener('click', e=>{
    e.stopPropagation();
    const bk = bookById(b.dataset.savebook); if(!bk) return;
    const t=document.getElementById('editBkTitle').value.trim(); if(!t) return;
    const wasCompleted = bk.status==='completed';
    bk.title=t; bk.author=document.getElementById('editBkAuthor').value.trim(); bk.status=document.getElementById('editBkStatus').value;
    editingBookId=null; save(); render();
    if(bk.status==='completed' && !wasCompleted){
      const bs=bookStats(bk.id);
      const first = state.sessions.filter(s=>s.bookId===bk.id).sort((a,x)=>a.startTime-x.startTime)[0];
      const days = first ? Math.max(1, Math.round((Date.now()-first.startTime)/(MS.h*24))) : 0;
      toast('COMPLETED · '+fmtHMS(bs.total)+' · '+bs.count+' SESSIONS · '+days+' DAYS','celebrate');
    } else toast('BOOK UPDATED');
  }));
  root.querySelectorAll('[data-delbook]').forEach(b=>b.addEventListener('click', e=>{
    e.stopPropagation();
    const id=b.dataset.delbook;
    const doDelete=()=>{ state.books = state.books.filter(x=>x.id!==id); if(selectedBookId===id) selectedBookId=null; save(); render(); toast('BOOK DELETED'); };
    if(state.settings.confirmDelete) showConfirm('Delete this book? Its past sessions will be kept but unlinked.', doDelete);
    else doDelete();
  }));
  const focusAdd=root.querySelector('[data-focusaddbook]');
  if(focusAdd) focusAdd.addEventListener('click', ()=>{ const t=root.querySelector('#bkTitle'); if(t) t.focus(); });
  root.querySelector('#bkAdd').addEventListener('click', ()=>{
    const t=root.querySelector('#bkTitle').value.trim();
    const a=root.querySelector('#bkAuthor').value.trim();
    if(!t) return;
    state.books.push({id:uid('bk'), title:t, author:a, status:'to-read', createdAt:new Date().toISOString()});
    save(); render();
  });
}

// ---------- RENDER: STATS ----------
function viewStats(){
  const el=document.createElement('div');
  const now=Date.now();
  const today = totalForRange(startOfDay(now), now);
  const week = totalForRange(startOfWeek(now), now);
  const month = totalForRange(startOfMonth(now), now);
  const life = lifetimeTotal();
  const streaks = computeStreaks();
  const sessCount = state.sessions.length + (state.activeSession?1:0);
  const avg = sessCount? (state.sessions.reduce((a,s)=>a+s.duration,0) + (state.activeSession?activeElapsed(now):0))/sessCount : 0;

  const hasData = sessCount>0;
  const nextMilestone = MILESTONES.find(m=>m > life/MS.h) || null;
  const lifeH = life/MS.h;
  const prevMilestone = [...MILESTONES].reverse().find(m=>m<=lifeH) || 0;
  const milestoneCeiling = nextMilestone || (prevMilestone*2 || 1);
  const pct = Math.min(100, (lifeH/milestoneCeiling)*100);

  el.innerHTML = !hasData ? `
    <div class="panel"><div class="empty">INSUFFICIENT DATA<br><br>&gt; START READING<br>&gt; RETURN TOMORROW<button type="button" class="btn primary" data-gostartreading>▶ START READING</button></div></div>
  ` : `
    <div class="btnrow" style="margin-bottom:14px;"><button class="btn primary" id="btnShareCard">⬇ DOWNLOAD STATS CARD (PNG)</button></div>
    <div class="statgrid">
      <div class="statcard"><div class="lbl">TODAY</div><div class="val accent">${fmtHMS(today)}</div></div>
      <div class="statcard"><div class="lbl">THIS WEEK</div><div class="val">${fmtHMS(week)}</div></div>
      <div class="statcard"><div class="lbl">THIS MONTH</div><div class="val">${fmtHMS(month)}</div></div>
      <div class="statcard"><div class="lbl">LIFETIME</div><div class="val accent">${fmtHMS(life)}</div></div>
      <div class="statcard"><div class="lbl">CURRENT STREAK</div><div class="val">${streaks.current}d</div></div>
      <div class="statcard"><div class="lbl">LONGEST STREAK</div><div class="val">${streaks.longest}d</div></div>
      <div class="statcard"><div class="lbl">TOTAL SESSIONS</div><div class="val">${sessCount}</div></div>
      <div class="statcard"><div class="lbl">AVG SESSION</div><div class="val">${fmtShort(avg)}</div></div>
    </div>

    <div class="panel">
      <div class="panel-label"><span>LIFETIME READING UPTIME</span></div>
      <div class="timer" style="font-size:26px;">${life>MS.h? Math.floor(life/MS.h)+'h '+Math.floor((life%MS.h)/MS.m)+'m '+Math.floor((life%MS.m)/1000)+'s' : fmtHMS(life)}</div>
      <div class="uptimebar"><div class="fill" style="width:${pct}%"></div></div>
      ${state.ackMilestones.length? `<div class="milestone">> ${Math.max(...state.ackMilestones)} HOURS ACHIEVED — SYSTEM STATUS: WELL READ</div>`:''}
    </div>

    <div class="panel">
      <div class="panel-label"><span>READING ACTIVITY</span><span>LAST 12 WEEKS</span></div>
      ${renderHeatmap()}
      <div class="heatlegend">LESS <span class="sq" style="background:var(--border)"></span><span class="sq" style="background:var(--accent-dim);opacity:.4"></span><span class="sq" style="background:var(--accent-dim)"></span><span class="sq" style="background:var(--accent)"></span> MORE</div>
    </div>
  `;
  return el;
}
function renderHeatmap(){
  const totals=dayTotalsMap();
  const counts=sessionCountsMap();
  const days=84;
  const todayStart = startOfDay(Date.now());
  const cells=[];
  for(let i=days-1;i>=0;i--){
    const ts = todayStart - i*MS.h*24;
    const k = dayKey(ts);
    cells.push({k, ms: totals[k]||0, count: counts[k]||0});
  }
  const max = Math.max(1, ...cells.map(c=>c.ms));
  const html = cells.map(c=>{
    const intensity = c.ms<=0?0: c.ms/max;
    let bg='var(--border)';
    if(intensity>0.66) bg='var(--accent)'; else if(intensity>0.33) bg='var(--accent-dim)'; else if(intensity>0) bg='var(--accent-dim)';
    const op = intensity>0 && intensity<=0.33 ? '0.4' : '1';
    return `<div class="hcell" tabindex="0" role="button" aria-label="${c.k}" data-day="${c.k}" data-ms="${c.ms}" data-count="${c.count}" style="background:${bg};opacity:${op}"></div>`;
  }).join('');
  return `<div class="heatgrid">${html}</div>`;
}
function bindStatsEvents(root){
  const shareBtn=root.querySelector('#btnShareCard');
  if(shareBtn) shareBtn.addEventListener('click', generateShareCard);
  const goStart=root.querySelector('[data-gostartreading]');
  if(goStart) goStart.addEventListener('click', ()=>setView('dashboard'));
  root.querySelectorAll('.hcell').forEach(cell=>{
    const show=()=>{
      const pop=document.getElementById('daypopover');
      pop.innerHTML = `<div class="t">${cell.dataset.day}</div><div>READ TIME</div><div class="v">${fmtHMS(Number(cell.dataset.ms))}</div><div style="margin-top:4px;">SESSIONS</div><div class="v">${cell.dataset.count}</div>`;
      pop.style.display='block';
      const rect=cell.getBoundingClientRect();
      let x = rect.left + rect.width/2 - 60; x=Math.max(8, Math.min(window.innerWidth-140, x));
      pop.style.left=x+'px'; pop.style.top=(rect.top-90+window.scrollY)+'px';
    };
    cell.addEventListener('mouseenter', show);
    cell.addEventListener('mouseleave', ()=>{ document.getElementById('daypopover').style.display='none'; });
    cell.addEventListener('click', show);
    cell.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); show(); } });
  });
}

// One global, delegated click-away handler for the day popover — registered
// once at startup rather than once per Stats/Book-Detail render, so
// navigating around never accumulates duplicate document-level listeners.
document.addEventListener('click', (e)=>{
  const pop=document.getElementById('daypopover');
  if(pop && !e.target.classList.contains('hcell')) pop.style.display='none';
});

// ---------- RENDER: SETTINGS ----------
function viewSettings(){
  const el=document.createElement('div');
  const colors=['cyan','green','amber','violet','red'];
  const colorHex={cyan:'#2dd4d4',green:'#3ddc84',amber:'#f5b942',violet:'#b18cff',red:'#ff5d6c'};
  el.innerHTML = `
    <div class="panel">
      <div class="panel-label"><span>PROFILE</span></div>
      <div class="field"><label>DISPLAY NAME (OPTIONAL)</label><input id="displayNameInput" type="text" maxlength="40" placeholder="Not set" value="${escapeHtml(state.settings.displayName||'')}"></div>
    </div>
    <div class="panel">
      <div class="panel-label"><span>APPEARANCE</span></div>
      <div class="field"><label>ACCENT COLOR</label>
        <div class="colorrow">${colors.map(c=>`<div class="swatch ${state.settings.accentColor===c?'sel':''}" data-color="${c}" style="background:${colorHex[c]};color:${colorHex[c]}"></div>`).join('')}</div>
      </div>
      <div class="togglerow"><span>ANIMATIONS</span><div class="switch ${state.settings.animationsEnabled?'on':''}" data-toggle="animationsEnabled"><div class="knob"></div></div></div>
      <div class="togglerow"><span>IMMERSIVE MODE (vs compact)</span><div class="switch ${state.settings.visualMode==='immersive'?'on':''}" data-toggle="visualMode"><div class="knob"></div></div></div>
    </div>
    <div class="panel">
      <div class="panel-label"><span>GOALS</span></div>
      <div class="field"><label>DAILY GOAL (MINUTES, 0 = OFF)</label><input type="number" id="dailyGoalInput" min="0" value="${state.settings.dailyGoalMin||0}"></div>
      <div class="field"><label>WEEKLY GOAL (MINUTES, 0 = OFF)</label><input type="number" id="weeklyGoalInput" min="0" value="${state.settings.weeklyGoalMin||0}"></div>
    </div>
    <div class="panel">
      <div class="panel-label"><span>GENERAL</span></div>
      <div class="togglerow"><span>24-HOUR TIME</span><div class="switch ${state.settings.timeFormat===24?'on':''}" data-toggle="timeFormat"><div class="knob"></div></div></div>
      <div class="togglerow"><span>SOUND EFFECTS</span><div class="switch ${state.settings.soundEnabled?'on':''}" data-toggle="soundEnabled"><div class="knob"></div></div></div>
      <div class="togglerow"><span>CONFIRM BEFORE DELETE</span><div class="switch ${state.settings.confirmDelete?'on':''}" data-toggle="confirmDelete"><div class="knob"></div></div></div>
    </div>
    <div class="panel">
      <div class="panel-label"><span>DATA</span></div>
      <div class="btnrow">
        <button class="btn" id="btnExport">EXPORT DATA (JSON)</button>
        <button class="btn" id="btnImportTrigger">IMPORT DATA</button>
        <input type="file" id="fileImport" accept="application/json" style="display:none;">
        <button class="btn danger" id="btnClear">CLEAR ALL DATA</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text-dim);letter-spacing:1px;margin-top:12px;"><input type="checkbox" id="importMerge"> MERGE IMPORT INTO EXISTING DATA (instead of replacing)</label>
    </div>
  `;
  return el;
}

// ---------- IMPORT VALIDATION ----------
// Returns {ok:true, data} with a cleaned-up shape, or {ok:false, reason}.
function validateImportPayload(parsed){
  if(!parsed || typeof parsed!=='object') return {ok:false, reason:'NOT AN OBJECT'};
  if(!Array.isArray(parsed.sessions)) return {ok:false, reason:'MISSING/INVALID SESSIONS'};
  if(!Array.isArray(parsed.books)) return {ok:false, reason:'MISSING/INVALID BOOKS'};
  if(parsed.settings!==undefined && typeof parsed.settings!=='object') return {ok:false, reason:'INVALID SETTINGS'};

  const cleanSessions=[];
  for(const s of parsed.sessions){
    if(!s || typeof s!=='object') continue;
    if(typeof s.id!=='string' || typeof s.startTime!=='number' || typeof s.endTime!=='number') continue;
    if(s.endTime < s.startTime) continue;
    cleanSessions.push({
      id:s.id, startTime:s.startTime, endTime:s.endTime,
      duration: typeof s.duration==='number' && s.duration>=0 ? s.duration : Math.max(0,s.endTime-s.startTime),
      bookId: typeof s.bookId==='string' ? s.bookId : null,
      targetDuration: typeof s.targetDuration==='number' ? s.targetDuration : null,
      notes: typeof s.notes==='string' ? s.notes : ''
    });
  }
  const cleanBooks=[];
  for(const b of parsed.books){
    if(!b || typeof b!=='object') continue;
    if(typeof b.id!=='string' || typeof b.title!=='string' || !b.title.trim()) continue;
    cleanBooks.push({
      id:b.id, title:b.title, author: typeof b.author==='string'? b.author:'',
      status: BOOK_STATUSES.includes(b.status)? b.status : 'to-read',
      createdAt: typeof b.createdAt==='string'? b.createdAt : new Date().toISOString()
    });
  }
  const cleanMilestones = Array.isArray(parsed.ackMilestones) ? parsed.ackMilestones.filter(m=>typeof m==='number') : [];

  let cleanActive=null;
  if(parsed.activeSession && typeof parsed.activeSession==='object'){
    const a=parsed.activeSession;
    if(typeof a.id==='string' && typeof a.startTime==='number' && a.startTime<=Date.now()){
      cleanActive = {
        id:a.id, startTime:a.startTime,
        bookId: typeof a.bookId==='string'? a.bookId:null,
        targetDuration: typeof a.targetDuration==='number'? a.targetDuration:null,
        milestoneHit: !!a.milestoneHit,
        pausedMs: typeof a.pausedMs==='number'? a.pausedMs:0,
        pauseStart: typeof a.pauseStart==='number'? a.pauseStart:null
      };
    }
    // if the restored active session looks invalid, we simply drop it —
    // the rest of the import still proceeds.
  }

  const cleanSettings = parsed.settings && typeof parsed.settings==='object' ? parsed.settings : {};

  return { ok:true, data:{
    sessions:cleanSessions, books:cleanBooks, ackMilestones:cleanMilestones,
    activeSession:cleanActive, settings:cleanSettings,
    version: typeof parsed.version==='number'? parsed.version : 0
  }};
}

function bindSettingsEvents(root){
  root.querySelector('#displayNameInput').addEventListener('change', e=>{ state.settings.displayName=e.target.value.trim().slice(0,40); save(); });
  root.querySelector('#dailyGoalInput').addEventListener('change', e=>{ state.settings.dailyGoalMin=Math.max(0,Number(e.target.value)||0); save(); });
  root.querySelector('#weeklyGoalInput').addEventListener('change', e=>{ state.settings.weeklyGoalMin=Math.max(0,Number(e.target.value)||0); save(); });
  root.querySelectorAll('.swatch').forEach(s=>s.addEventListener('click', ()=>{ state.settings.accentColor=s.dataset.color; save(); applySettings(); render(); }));
  root.querySelectorAll('[data-toggle]').forEach(sw=>sw.addEventListener('click', ()=>{
    const k=sw.dataset.toggle;
    if(k==='timeFormat') state.settings.timeFormat = state.settings.timeFormat===24?12:24;
    else if(k==='visualMode') state.settings.visualMode = state.settings.visualMode==='immersive'?'compact':'immersive';
    else state.settings[k] = !state.settings[k];
    save(); applySettings(); render();
  }));
  root.querySelector('#btnExport').addEventListener('click', async ()=>{
    const payload = Object.assign({}, state, {version:SAVE_VERSION});
    const data=JSON.stringify(payload,null,2);
    const ok = await offerDownload('readOS-export-'+dayKey(Date.now())+'.json', data, 'application/json');
    toast(ok? 'DATA EXPORTED' : 'EXPORT CANCELLED');
  });
  root.querySelector('#btnImportTrigger').addEventListener('click', ()=> root.querySelector('#fileImport').click());
  root.querySelector('#fileImport').addEventListener('change', (e)=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload = ()=>{
      let parsed;
      try{ parsed=JSON.parse(reader.result); }
      catch(err){ toast('IMPORT FAILED · BAD JSON'); e.target.value=''; return; }

      const result = validateImportPayload(parsed);
      if(!result.ok){ toast('IMPORT FAILED · '+result.reason); e.target.value=''; return; }
      const clean = result.data;
      const mergeMode = root.querySelector('#importMerge').checked;

      const doImport=()=>{
        if(mergeMode){
          const existingSessIds = new Set(state.sessions.map(s=>s.id));
          const existingBookIds = new Set(state.books.map(b=>b.id));
          clean.sessions.forEach(s=>{ if(!existingSessIds.has(s.id)) state.sessions.push(s); });
          clean.books.forEach(b=>{ if(!existingBookIds.has(b.id)) state.books.push(b); });
          clean.ackMilestones.forEach(m=>{ if(!state.ackMilestones.includes(m)) state.ackMilestones.push(m); });
          if(!state.settings.displayName && clean.settings.displayName) state.settings.displayName = String(clean.settings.displayName).slice(0,40);
          // Merge intentionally never restores an imported active/live session —
          // blindly resuming someone else's in-progress timer could create an
          // invalid or duplicate live session on top of the current one.
        } else {
          const def=defaultState();
          state = Object.assign(def, {
            sessions:clean.sessions, books:clean.books, ackMilestones:clean.ackMilestones,
            activeSession:clean.activeSession, createdAt: parsed.createdAt || def.createdAt
          }, {settings:Object.assign({}, def.settings, clean.settings)});
          normalizeState(state);
          if(state.activeSession){ document.body.dataset.active='1'; if(state.activeSession.pauseStart) document.body.dataset.paused='1'; startTicking(); }
          else { document.body.dataset.active='0'; document.body.dataset.paused='0'; stopTicking(); }
        }
        save(); applySettings(); render(); updateGlobalIndicator();
        toast(mergeMode? 'DATA MERGED' : 'DATA IMPORTED');
      };
      if(!mergeMode && state.settings.confirmDelete) showConfirm('This will replace all current data. Continue?', doImport);
      else doImport();
      e.target.value='';
    };
    reader.readAsText(file);
  });
  root.querySelector('#btnClear').addEventListener('click', ()=>{
    showConfirm('This will permanently delete all sessions, books, and settings. This cannot be undone.', ()=>{
      state = defaultState(); save(); applySettings(); stopTicking(); document.body.dataset.active='0'; document.body.dataset.paused='0';
      updateGlobalIndicator(); setView('dashboard');
      toast('ALL DATA CLEARED');
    });
  });
}

// ---------- GLOBAL TERMINAL (single persistent instance, available on every view) ----------
function terminalPanel(){
  const el=document.createElement('div');
  el.className='panel termpanel';
  el.innerHTML = `<div class="panel-label"><span>TERMINAL</span><span>type 'help'</span></div>
    <div id="termout"></div>
    <div class="terminput-row"><span>&gt;</span><input id="termin" type="text" autocomplete="off" spellcheck="false" aria-label="Terminal command input"></div>`;
  return el;
}
function termPrint(text, isCmd){
  const out=document.getElementById('termout'); if(!out) return;
  const d=document.createElement('div');
  if(isCmd) d.innerHTML = '<span class="cmdline">&gt; '+escapeHtml(text)+'</span>';
  else d.innerHTML = text;
  out.appendChild(d); out.scrollTop=out.scrollHeight;
}
const NAV_COMMANDS = ['dashboard','sessions','books','stats','settings'];
function printHelp(){
  termPrint('NAVIGATION');
  termPrint('&nbsp;&nbsp;dashboard, sessions, books, stats, settings');
  termPrint('SESSION');
  termPrint('&nbsp;&nbsp;start, stop, pause, resume');
  termPrint('READING');
  termPrint('&nbsp;&nbsp;today, stats, streak, history');
  termPrint('BOOKS');
  termPrint('&nbsp;&nbsp;books');
  termPrint('SYSTEM');
  termPrint('&nbsp;&nbsp;clear, help');
}
function runCommand(cmd){
  const c=cmd.trim().toLowerCase();
  termPrint(cmd, true);
  if(!c){ return; }
  if(c==='help'){
    printHelp();
  } else if(NAV_COMMANDS.includes(c)){
    setView(c);
    termPrint('NAVIGATED TO '+c.toUpperCase());
  } else if(c==='start'){
    if(state.activeSession){ termPrint('SESSION ALREADY ACTIVE: '+state.activeSession.id); }
    else { startSession(); termPrint('SESSION STARTED: '+state.activeSession.id); }
  } else if(c==='stop'){
    if(!state.activeSession){ termPrint('NO ACTIVE SESSION'); }
    else { const dur=activeElapsed(Date.now()); stopSession(); termPrint('SESSION STOPPED — '+fmtHMS(dur)); }
  } else if(c==='pause'){
    if(!state.activeSession){ termPrint('NO ACTIVE SESSION'); }
    else if(state.activeSession.pauseStart){ termPrint('ALREADY PAUSED'); }
    else { pauseSession(); termPrint('SESSION PAUSED'); }
  } else if(c==='resume'){
    if(!state.activeSession || !state.activeSession.pauseStart){ termPrint('NO PAUSED SESSION'); }
    else { resumeSession(); termPrint('SESSION RESUMED'); }
  } else if(c==='stats'){
    const now=Date.now();
    termPrint('TODAY&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'+fmtHMS(totalForRange(startOfDay(now),now)));
    termPrint('THIS WEEK&nbsp;&nbsp;'+fmtHMS(totalForRange(startOfWeek(now),now)));
    termPrint('THIS MONTH&nbsp;&nbsp;'+fmtHMS(totalForRange(startOfMonth(now),now)));
    termPrint('LIFETIME&nbsp;&nbsp;&nbsp;&nbsp;'+fmtHMS(lifetimeTotal()));
  } else if(c==='history'){
    const last=state.sessions.slice(-5).reverse();
    if(!last.length) termPrint('NO SESSION DATA FOUND');
    else last.forEach(s=>{ const d=new Date(s.startTime); termPrint(pad(d.getMonth()+1)+'/'+pad(d.getDate())+' '+fmtHMS(s.duration)+' '+(s.bookId?escapeHtml(bookById(s.bookId)?.title||'—'):'—')); });
  } else if(c==='books'){
    if(!state.books.length) termPrint('BOOK DATABASE EMPTY');
    else state.books.forEach(b=> termPrint('['+(selectedBookId===b.id?'RUN':' ')+'] '+escapeHtml(b.title)+' — '+b.status.toUpperCase()));
  } else if(c==='today'){
    termPrint('TODAY TOTAL: '+fmtHMS(totalForRange(startOfDay(Date.now()),Date.now())));
  } else if(c==='streak'){
    const s=computeStreaks(); termPrint('CURRENT STREAK: '+s.current+'d — LONGEST: '+s.longest+'d');
  } else if(c==='clear'){
    const out=document.getElementById('termout'); if(out) out.innerHTML=''; return;
  } else {
    termPrint('UNKNOWN COMMAND: '+escapeHtml(c)+' — type "help" for a list of commands');
  }
}
function initTerminal(){
  const mount=document.getElementById('terminalMount');
  if(!mount) return;
  const panel=terminalPanel();
  mount.appendChild(panel);
  const input=panel.querySelector('#termin');
  termPrint('READ//OS TERMINAL READY. type "help" for commands.');
  input.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ const v=input.value; input.value=''; runCommand(v); }
  });
}

// ---------- SHARE CARD ----------
function generateShareCard(){
  const now=Date.now();
  const life=lifetimeTotal(), today=totalForRange(startOfDay(now),now), week=totalForRange(startOfWeek(now),now);
  const streaks=computeStreaks(); const sessCount=state.sessions.length+(state.activeSession?1:0);
  const accentHex = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#2dd4d4';
  const name = (state.settings.displayName||'').trim();
  const c=document.createElement('canvas'); c.width=800; c.height=1000; const g=c.getContext('2d');
  g.fillStyle='#05070a'; g.fillRect(0,0,800,1000);
  g.strokeStyle='#1c2530'; g.lineWidth=2; g.strokeRect(24,24,752,952);
  g.fillStyle=accentHex; g.font='700 34px monospace'; g.fillText('READ//OS', 56, 100);
  let subtitleY = 126;
  if(name){
    g.fillStyle='#d8e2ea'; g.font='700 16px monospace'; g.fillText(name.toUpperCase(), 56, subtitleY);
    subtitleY += 22;
  }
  g.fillStyle='#5c6b7a'; g.font='12px monospace'; g.fillText('READING ACTIVITY REPORT', 56, subtitleY);
  g.strokeStyle='#1c2530'; g.beginPath(); g.moveTo(56,subtitleY+24); g.lineTo(744,subtitleY+24); g.stroke();

  const baseY = subtitleY+24;
  function stat(label,val,x,y,big){
    g.fillStyle='#5c6b7a'; g.font='13px monospace'; g.fillText(label, x, y);
    g.fillStyle= big? accentHex : '#d8e2ea'; g.font=(big?'700 44px monospace':'700 28px monospace'); g.fillText(val, x, y+ (big?54:38));
  }
  stat('LIFETIME READING', fmtHMS(life).slice(0,8), 56, baseY+60, true);
  stat('TODAY', fmtHMS(today), 56, baseY+190);
  stat('THIS WEEK', fmtHMS(week), 300, baseY+190);
  stat('CURRENT STREAK', streaks.current+' DAYS', 56, baseY+280);
  stat('LONGEST STREAK', streaks.longest+' DAYS', 300, baseY+280);
  stat('TOTAL SESSIONS', String(sessCount), 56, baseY+370);

  const totals=dayTotalsMap(); const days=84; const todayStart=startOfDay(now);
  const cells=[]; for(let i=days-1;i>=0;i--){ const ts=todayStart-i*MS.h*24; cells.push(totals[dayKey(ts)]||0); }
  const max=Math.max(1,...cells);
  const rows=7, cell=18, gap=5, ox=56, oy=baseY+450;
  cells.forEach((v,i)=>{
    const col=Math.floor(i/rows), row=i%rows;
    const inten = v<=0?0:v/max;
    g.fillStyle = inten>0?accentHex:'#1c2530';
    g.globalAlpha = inten<=0?1: (inten<=0.33?0.35: inten<=0.66?0.65:1);
    g.fillRect(ox+col*(cell+gap), oy+row*(cell+gap), cell, cell);
  });
  g.globalAlpha=1;
  g.fillStyle='#5c6b7a'; g.font='12px monospace'; g.fillText('LAST 12 WEEKS', ox, oy-14);

  g.fillStyle='#5c6b7a'; g.font='11px monospace'; g.fillText('GENERATED '+new Date().toISOString().slice(0,10)+' · READOS LOCAL TRACKER', 56, 970);

  c.toBlob(async blob=>{
    const ok = await offerDownload('readOS-stats-'+dayKey(now)+'.png', blob, 'image/png');
    toast(ok? 'STATS CARD DOWNLOADED' : 'DOWNLOAD CANCELLED');
  });
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- MASTER RENDER ----------
function render(){
  const main=document.getElementById('main');
  main.innerHTML='';
  let view;
  const showingBookDetail = currentView==='books' && bookDetailId;
  if(currentView==='dashboard') view=viewDashboard();
  else if(currentView==='sessions') view=viewSessions();
  else if(showingBookDetail) view=viewBookDetail(bookDetailId);
  else if(currentView==='books') view=viewBooks();
  else if(currentView==='stats') view=viewStats();
  else view=viewSettings();

  const title=document.createElement('h1'); title.className='page-title hide-desktop-off';
  title.style.display = window.innerWidth<=820 ? 'none':'flex';
  title.textContent = showingBookDetail ? 'BOOK DETAIL' : currentView.toUpperCase();
  main.appendChild(title);
  main.appendChild(view);

  if(currentView==='dashboard'){ bindDashboardEvents(main); if(state.activeSession) tickUI(); }
  else if(currentView==='sessions') bindSessionsEvents(main);
  else if(showingBookDetail) bindBookDetailEvents(main);
  else if(currentView==='books') bindBooksEvents(main);
  else if(currentView==='stats') bindStatsEvents(main);
  else if(currentView==='settings') bindSettingsEvents(main);

  updateGlobalIndicator();
}

document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && state.activeSession) tickUI(); });
window.addEventListener('focus', ()=>{ if(state.activeSession) tickUI(); });
window.addEventListener('pageshow', ()=>{ if(state.activeSession) tickUI(); });

// ---------- SERVICE WORKER (offline-first; relative path works under a GitHub Pages subpath too) ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{ /* offline support just won't be available; app still works online */ });
  });
}

// ---------- INIT ----------
applySettings();
updateOnlineStatus();
if(state.activeSession) startTicking();
initTerminal();
setView('dashboard');
updateGlobalIndicator();
})();
