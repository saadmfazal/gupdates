const API='https://viajmvbwpmkiqxjtgshv.supabase.co/rest/v1/rpc/';
const APIKEY='sb_publishable_gGFZftPonWKNZCdvUSM3yQ_gZvyI6_H';
const SUPABASE_URL='https://viajmvbwpmkiqxjtgshv.supabase.co';
const AUTH_BOOTSTRAP=SUPABASE_URL+'/functions/v1/sales-os-auth-bootstrap';
const STAGES=['Research','Asset ready','Ready to contact','Contacted','Follow-up','Replied','Qualified','Meeting','Proposal','Negotiation','Won','Lost','Hold'];
const PIPELINE_STAGES=['Research','Ready to contact','Follow-up','Replied','Qualified','Proposal'];
const CSV_COLUMNS=['company','category','segment','location','website','contact_name','contact_role','contact_email','phone','priority','score','owner_assigned','sender_name','sender_email','stage','status','next_action','next_action_date','caution','notes','tags','source_groups','source_notes','asset_type','asset_title','asset_url','asset_status','outreach_subject','outreach_message'];

let token='';
let data={prospects:[],assets:[],activities:[],templates:[],categories:[],notes:[],reminders:[],email_drafts:[],notifications:[],connections:[],email_messages:[],inbox_threads:[],recommendations:[],opportunities:[],approvals:[],audit_log:[],members:[],copilot_threads:[]};
let selectedProspect=null,currentDraft=null,currentPage='dashboard',deferredInstallPrompt=null;
let sessionAccessToken='',supabaseClient=null,actor=null;
let selectedInboxThread=null,copilotThreadId=null,copilotProspectId=null,copilotLocal=[];
let providerStatus={ai:false};

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const todayISO=()=>new Date().toISOString().slice(0,10);
const dateTimeLocal=x=>{if(!x)return'';const d=new Date(x),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
const pill=s=>{const v=String(s||'Research');let c='';if(v==='Won')c='green';else if(['Lost','Hold'].includes(v))c='red';else if(['Follow-up','Ready to contact'].includes(v))c='amber';else if(['Replied','Qualified','Meeting'].includes(v))c='blue';return `<span class="pill ${c}">${esc(v)}</span>`};
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2200)}
async function rpc(fn,payload={}){
 const headers={apikey:APIKEY,'Content-Type':'application/json'};
 if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;
 const r=await fetch(API+fn,{method:'POST',headers,body:JSON.stringify(payload)});
 const txt=await r.text();if(!r.ok)throw new Error(txt||`HTTP ${r.status}`);return txt?JSON.parse(txt):null
}
function norm(){for(const k of ['prospects','assets','activities','templates','categories','notes','reminders','email_drafts','notifications','connections','email_messages','inbox_threads','recommendations','opportunities','approvals','audit_log','members','copilot_threads'])data[k]=Array.isArray(data[k])?data[k]:[]}

async function ensureSupabaseClient(){
 if(supabaseClient)return supabaseClient;
 const mod=await import('https://esm.sh/@supabase/supabase-js@2');
 supabaseClient=mod.createClient(SUPABASE_URL,APIKEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
 return supabaseClient;
}
async function memberLogin(){
 const email=$('#memberEmail').value.trim(),c=$('#accessCode').value.trim();$('#loginError').textContent='';
 if(!email||!c){$('#loginError').textContent='Enter your Sales OS email and team access code.';return}
 try{
  localStorage.setItem('salesOsMemberEmail',email);
  $('#memberLoginBtn').disabled=true;$('#memberLoginBtn').textContent='Creating secure session…';
  const returnUrl=location.origin+'/sales-os-v2/oauth/?mode=app';
  const r=await fetch(AUTH_BOOTSTRAP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,access_code:c,return_url:returnUrl})});
  const d=await r.json();
  if(!r.ok||!d.action_link)throw new Error(d.error||d.detail||'Could not sign in');
  location.href=d.action_link;
 }catch(e){
  $('#memberLoginBtn').disabled=false;$('#memberLoginBtn').textContent='Continue as team member';
  $('#loginError').textContent=String(e?.message||e);
 }
}
async function tryMemberSession(){
 try{
  const sb=await ensureSupabaseClient();
  const {data:{session}}=await sb.auth.getSession();
  if(!session)return false;
  sessionAccessToken=session.access_token;token='';
  actor=await rpc('sales_os_whoami',{p_token:null});
  $('#login').classList.add('hidden');$('#app').classList.remove('hidden');
  await load();return true;
 }catch(e){sessionAccessToken='';actor=null;return false}
}
async function login(){
 const c=$('#accessCode').value.trim();$('#loginError').textContent='';
 try{
  const ok=await rpc('sales_os_verify',{p_token:c});if(!ok)throw new Error('denied');
  token=c;sessionAccessToken='';actor={display_name:'Shared team access',role:'shared',mode:'team_code'};
  if($('#remember').checked)localStorage.setItem('salesOsToken',c);
  $('#login').classList.add('hidden');$('#app').classList.remove('hidden');await load()
 }catch(e){$('#loginError').textContent='Could not open Sales OS. Check the access code.'}
}
async function signOutWorkspace(){
 localStorage.removeItem('salesOsToken');
 try{if(supabaseClient)await supabaseClient.auth.signOut()}catch(e){}
 sessionAccessToken='';token='';location.reload();
}
async function load(){
 data=await rpc('sales_os_snapshot',{p_token:token||null});norm();actor=data.actor||actor;
 try{providerStatus.ai=!!(await rpc('sales_os_secret_status',{p_token:token||null,p_name:'sales_os_openai_api_key'}))}catch(e){providerStatus.ai=false}
 renderAll();renderIdentity();
 $('#syncLabel').textContent='Last synced '+new Date(data.synced_at||Date.now()).toLocaleString();showDueBrowserNotifications()
}
function renderAll(){renderCounts();renderDashboard();syncFilters();renderProspects();renderPipeline();renderInbox();renderAIQueue();renderEmail();renderAssets();renderReminders();renderNotes();renderCategories();renderConnections();renderNotifications();renderApprovals()}
const categoryNames=()=>[...new Set([...data.categories.map(c=>c.name),...data.prospects.map(p=>p.category).filter(Boolean)])].sort();
const owners=()=>[...new Set(data.prospects.map(p=>p.owner_assigned).filter(Boolean))].sort();
const prospectName=id=>data.prospects.find(p=>p.id===id)?.company||'';
const pAssets=id=>data.assets.filter(a=>a.prospect_id===id);
const pNotes=id=>data.notes.filter(n=>n.prospect_id===id);
const pReminders=id=>data.reminders.filter(r=>r.prospect_id===id);
const pActivities=id=>data.activities.filter(a=>a.prospect_id===id).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
const pOpportunity=id=>data.opportunities.find(o=>o.prospect_id===id)||null;
const pMessages=id=>data.email_messages.filter(m=>m.prospect_id===id).sort((a,b)=>new Date(b.sent_at)-new Date(a.sent_at));
const isEngaged=p=>['Replied','Qualified','Meeting','Proposal','Negotiation','Won'].includes(p.stage);
const dueReminder=r=>r.status==='open'&&new Date(r.due_at)<=new Date();
const followupDue=p=>p.next_action_date&&p.next_action_date<=todayISO()&&!['Won','Lost','Hold'].includes(p.stage);

function renderCounts(){
 const drafts=data.email_drafts.filter(d=>d.status==='draft').length,openR=data.reminders.filter(r=>r.status==='open').length;
 const pendingApprovals=data.approvals.filter(a=>a.status==='pending').length;
 const due=data.reminders.filter(dueReminder).length+data.prospects.filter(followupDue).length+(actor?.role==='owner'?pendingApprovals:0);
 const inboxActions=data.email_messages.filter(m=>m.requires_action).length;
 const aiActions=data.recommendations.filter(r=>r.status==='open').length;
 const activeValue=data.opportunities.filter(o=>!['Won','Lost'].includes(data.prospects.find(p=>p.id===o.prospect_id)?.stage)).reduce((sum,o)=>sum+Number(o.estimated_value||0),0);
 $('#navProspects').textContent=data.prospects.length;$('#navAssets').textContent=data.assets.length;$('#navDrafts').textContent=drafts;$('#navReminders').textContent=openR;
 if($('#navInbox'))$('#navInbox').textContent=inboxActions;if($('#navAI'))$('#navAI').textContent=aiActions;if($('#navApprovals'))$('#navApprovals').textContent=pendingApprovals;
 $('#statProspects').textContent=data.prospects.filter(p=>!['Won','Lost'].includes(p.stage)).length;$('#statDue').textContent=due;$('#statDrafts').textContent=drafts;
 if($('#statInbox'))$('#statInbox').textContent=inboxActions;if($('#statAI'))$('#statAI').textContent=aiActions;if($('#statValue'))$('#statValue').textContent='$'+activeValue.toLocaleString(undefined,{maximumFractionDigits:0});
 $('#notificationDot').classList.toggle('hidden',!data.notifications.some(n=>!n.read_at&&!n.dismissed_at));$('#todayDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
}
function renderDashboard(){
 const focus=[];
 data.reminders.filter(r=>r.status==='open').forEach(r=>focus.push({title:r.title,meta:(prospectName(r.prospect_id)||'General')+' · '+new Date(r.due_at).toLocaleString(),kind:'Reminder',due:new Date(r.due_at),pid:r.prospect_id}));
 data.prospects.filter(followupDue).forEach(p=>focus.push({title:p.next_action||'Follow up',meta:p.company+' · '+p.next_action_date,kind:'Follow-up',due:new Date(p.next_action_date),pid:p.id}));
 if(actor?.role==='owner')data.approvals.filter(a=>a.status==='pending').forEach(a=>focus.push({title:a.title,meta:'Approval requested by '+(a.requested_by_name||a.requested_by_email||'team member'),kind:'Approval',due:new Date(a.requested_at),pid:a.prospect_id}));
 focus.sort((a,b)=>a.due-b.due);
 $('#todayFocus').innerHTML=focus.length?focus.slice(0,8).map(x=>`<div class="focusrow" ${x.pid?`onclick="openProspect('${x.pid}')"`:''}><div class="maincopy"><div class="title">${esc(x.title)}</div><div class="meta">${esc(x.meta)}</div></div><span class="pill ${x.due<new Date()?'red':'amber'}">${esc(x.kind)}</span></div>`).join(''):'<div class="empty">Nothing urgent right now.</div>';
 $('#recentActivity').innerHTML=data.activities.slice(0,8).map(a=>`<div class="activityrow" onclick="openProspect('${a.prospect_id}')"><div class="maincopy"><div class="title">${esc(a.activity_type||'Activity')} · ${esc(prospectName(a.prospect_id))}</div><div class="meta">${esc(a.subject||a.outcome||'')}${a.occurred_at?' · '+new Date(a.occurred_at).toLocaleDateString():''}</div></div></div>`).join('')||'<div class="empty">No activity yet.</div>';
 $('#pipelineSummary').innerHTML=STAGES.map(s=>({s,n:data.prospects.filter(p=>p.stage===s).length})).filter(x=>x.n).map(x=>`<div class="stagecard"><b>${x.n}</b><span>${esc(x.s)}</span></div>`).join('')||'<div class="empty">No pipeline data.</div>';
}
function syncFilters(){
 const c=$('#prospectCategory').value,s=$('#prospectStage').value,o=$('#prospectOwner').value;
 $('#prospectCategory').innerHTML='<option value="">All categories</option>'+categoryNames().map(x=>`<option>${esc(x)}</option>`).join('');
 $('#prospectStage').innerHTML='<option value="">All stages</option>'+STAGES.map(x=>`<option>${x}</option>`).join('');
 $('#prospectOwner').innerHTML='<option value="">All owners</option>'+owners().map(x=>`<option>${esc(x)}</option>`).join('');
 $('#prospectCategory').value=c;$('#prospectStage').value=s;$('#prospectOwner').value=o;
}
function filteredProspects(){
 const q=($('#prospectSearch').value||'').toLowerCase(),g=($('#globalSearch').value||'').toLowerCase(),cat=$('#prospectCategory').value,st=$('#prospectStage').value,ow=$('#prospectOwner').value;
 return data.prospects.filter(p=>{const blob=[p.company,p.category,p.segment,p.location,p.contact_name,p.contact_email,p.website,p.notes,(p.tags||[]).join(' ')].join(' ').toLowerCase();return(!q||blob.includes(q))&&(!g||blob.includes(g))&&(!cat||p.category===cat)&&(!st||p.stage===st)&&(!ow||p.owner_assigned===ow)}).sort((a,b)=>(b.score||0)-(a.score||0)||a.company.localeCompare(b.company));
}
function renderProspects(){
 const rows=filteredProspects();
 $('#prospectTable').innerHTML=rows.map(p=>`<tr><td><div class="company">${esc(p.company)}</div><div class="sub">${esc(p.location||p.segment||'')}</div></td><td>${esc(p.category||'General')}</td><td>${esc(p.contact_name||'')}<div class="sub">${esc(p.contact_email||'')}</div></td><td>${pAssets(p.id).length}</td><td>${esc(p.owner_assigned||'')}</td><td>${pill(p.stage)}</td><td>${p.next_action_date?`<span class="datechip">${esc(p.next_action_date)}</span>`:''}<div class="sub">${esc(p.next_action||'')}</div></td><td><button class="btn" onclick="openProspect('${p.id}')">Open</button></td></tr>`).join('');
 if($('#mobileProspectList')){
  $('#mobileProspectList').innerHTML=rows.length?rows.map(p=>`<article class="mobile-prospect-card" onclick="openProspect('${p.id}')">
    <div class="mobile-prospect-top">
      <div><span class="pill">${esc(p.category||'General')}</span><h3>${esc(p.company)}</h3><div class="mobile-prospect-meta">${esc([p.contact_name,p.location].filter(Boolean).join(' · ')||p.contact_email||'No contact yet')}</div></div>
      ${pill(p.stage)}
    </div>
    <div class="mobile-prospect-row">
      <div class="mobile-prospect-next">${p.next_action?`<b>Next:</b> ${esc(p.next_action)}`:''}${p.next_action_date?` · ${esc(p.next_action_date)}`:''}</div>
      <span class="pill">${pAssets(p.id).length} assets</span>
    </div>
    <div class="mobile-prospect-row"><div class="mobile-prospect-meta">Owner · ${esc(p.owner_assigned||'Unassigned')}</div><button class="btn" onclick="event.stopPropagation();openProspect('${p.id}')">Open</button></div>
  </article>`).join(''):'<div class="empty">No prospects match these filters.</div>';
 }
}
function renderPipeline(){
 $('#kanban').innerHTML=PIPELINE_STAGES.map(s=>{const ps=data.prospects.filter(p=>p.stage===s);return`<section class="lane"><div class="lanehead"><span>${s}</span><span>${ps.length}</span></div>${ps.map(p=>`<div class="deal" onclick="openProspect('${p.id}')"><b>${esc(p.company)}</b><small>${esc(p.category||'')}</small>${p.next_action_date?`<div style="margin-top:7px"><span class="datechip">${esc(p.next_action_date)}</span></div>`:''}</div>`).join('')}</section>`}).join('');
}

function inboxThreadState(threadId){
 return data.inbox_threads.find(t=>t.provider_thread_id===threadId)||null;
}
function inboxMessages(threadId){
 return data.email_messages.filter(m=>(m.provider_thread_id||m.provider_message_id)===threadId).sort((a,b)=>new Date(a.sent_at)-new Date(b.sent_at));
}
function inboxThreadIds(){
 const ids=new Set();
 data.email_messages.forEach(m=>ids.add(m.provider_thread_id||m.provider_message_id));
 data.inbox_threads.forEach(t=>ids.add(t.provider_thread_id));
 return [...ids];
}
function threadLatest(threadId){
 const ms=inboxMessages(threadId);return ms[ms.length-1]||null;
}
function renderInbox(){
 if(!$('#inboxThreadList'))return;
 const status=$('#inboxStatusFilter')?.value||'',cls=$('#inboxClassFilter')?.value||'';
 const classes=[...new Set(data.inbox_threads.map(t=>t.classification).filter(Boolean))].sort();
 if($('#inboxClassFilter')){
   const keep=$('#inboxClassFilter').value;
   $('#inboxClassFilter').innerHTML='<option value="">All classifications</option>'+classes.map(x=>`<option value="${esc(x)}">${esc(x.replaceAll('_',' '))}</option>`).join('');
   $('#inboxClassFilter').value=keep;
 }
 let threads=inboxThreadIds().map(id=>{
   const state=inboxThreadState(id),latest=threadLatest(id),msgs=inboxMessages(id);
   const pid=state?.prospect_id||latest?.prospect_id||msgs[0]?.prospect_id||null;
   return {id,state,latest,msgs,pid,status:state?.status||(latest?.direction==='outbound'?'waiting':'open'),classification:state?.classification||latest?.classification||'',date:state?.last_message_at||latest?.sent_at||null};
 }).filter(t=>(!status||t.status===status)&&(!cls||t.classification===cls))
   .sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));

 const actionCount=threads.filter(t=>t.status==='open'||t.latest?.requires_action).length;
 $('#inboxSummary').textContent=`${threads.length} threads · ${actionCount} need attention`;
 $('#inboxThreadList').innerHTML=threads.length?threads.map(t=>`<div class="inbox-thread-row ${selectedInboxThread===t.id?'active':''}" onclick="openInboxThread('${esc(t.id)}')">
   <div class="inbox-thread-top"><div><h3>${esc(prospectName(t.pid)||'Unknown prospect')}</h3><p>${esc(t.latest?.subject||'(No subject)')}</p></div><span class="pill ${t.status==='open'?'amber':t.status==='done'?'green':''}">${esc(t.status)}</span></div>
   <p>${esc(t.state?.summary||t.latest?.snippet||'')}</p>
   <div class="inbox-thread-badges">${t.classification?`<span class="pill blue">${esc(t.classification.replaceAll('_',' '))}</span>`:''}${t.state?.assigned_to?`<span class="pill">${esc(t.state.assigned_to)}</span>`:''}${t.date?`<span class="datechip">${new Date(t.date).toLocaleDateString()}</span>`:''}</div>
  </div>`).join(''):'<div class="empty">No conversations match this view.</div>';

 if(selectedInboxThread){
   const exists=threads.some(t=>t.id===selectedInboxThread);
   if(exists)renderInboxThreadView(selectedInboxThread);
   else{$('#inboxThreadView').innerHTML='<div class="empty">Select a conversation.</div>';selectedInboxThread=null}
 }else if(threads[0]&&!window.matchMedia('(max-width:760px)').matches){
   selectedInboxThread=threads[0].id;renderInboxThreadView(selectedInboxThread);renderInbox();
 }else $('#inboxThreadView').innerHTML='<div class="empty">Select a conversation.</div>';
}
function renderInboxThreadView(threadId){
 const msgs=inboxMessages(threadId),state=inboxThreadState(threadId),latest=msgs[msgs.length-1],pid=state?.prospect_id||latest?.prospect_id||msgs[0]?.prospect_id;
 const company=prospectName(pid)||'Unknown prospect';
 $('#inboxThreadView').innerHTML=`<div class="panelhead"><div><h2>${esc(company)}</h2><small>${esc(latest?.subject||'(No subject)')}</small></div><button class="btn" onclick="openProspect('${pid||''}')">Open account</button></div>
   <div class="thread-context"><div class="meta"><b>Status:</b> ${esc(state?.status||'open')} · <b>Classification:</b> ${esc((state?.classification||latest?.classification||'unclassified').replaceAll('_',' '))}${state?.next_action?'<br><b>Next:</b> '+esc(state.next_action):''}${state?.next_action_date?' · '+esc(state.next_action_date):''}</div></div>
   <div class="thread-actions">
     <button class="btn primary" onclick="draftInboxReply('${esc(threadId)}')">Reply draft</button>
     <button class="btn" onclick="openInboxCopilot('${esc(threadId)}')">✦ AI reply</button>
     <button class="btn" onclick="setInboxState('${esc(threadId)}','done')">Done</button>
     <button class="btn" onclick="snoozeInboxThread('${esc(threadId)}')">Snooze 3d</button>
   </div>
   <div class="mail-thread">${msgs.map(m=>`<article class="mail-message ${esc(m.direction)}"><div class="mail-message-head"><span>${esc(m.direction==='inbound'?(m.from_email||'Prospect'):'Us')}</span><span>${m.sent_at?new Date(m.sent_at).toLocaleString():''}</span></div><div class="mail-message-subject">${esc(m.subject||'')}</div><div class="mail-message-body">${esc(m.body||m.snippet||'')}</div></article>`).join('')}</div>`;
 if(window.matchMedia('(max-width:760px)').matches)setTimeout(()=>$('#inboxThreadView')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
}
window.openInboxThread=id=>{selectedInboxThread=id;renderInbox()};
async function setInboxState(threadId,status){
 const state=inboxThreadState(threadId),latest=threadLatest(threadId);
 await rpc('sales_os_set_inbox_thread_state',{p_token:token||null,p_payload:{
   provider:'gmail',provider_thread_id:threadId,prospect_id:state?.prospect_id||latest?.prospect_id,status,
   classification:state?.classification||latest?.classification||'',summary:state?.summary||latest?.snippet||'',
   assigned_to:state?.assigned_to||data.prospects.find(p=>p.id===(state?.prospect_id||latest?.prospect_id))?.owner_assigned||'',
   next_action:state?.next_action||'',next_action_date:state?.next_action_date||'',last_message_at:state?.last_message_at||latest?.sent_at||'',
   last_direction:state?.last_direction||latest?.direction||'',unread_count:status==='done'?0:(state?.unread_count||0)
 }});
 toast(status==='done'?'Conversation completed':'Inbox updated');await load();selectedInboxThread=threadId;renderInbox();
}
window.setInboxState=setInboxState;
window.snoozeInboxThread=async threadId=>{
 const state=inboxThreadState(threadId),latest=threadLatest(threadId),d=new Date(Date.now()+3*86400000);
 await rpc('sales_os_set_inbox_thread_state',{p_token:token||null,p_payload:{
   provider:'gmail',provider_thread_id:threadId,prospect_id:state?.prospect_id||latest?.prospect_id,status:'snoozed',
   classification:state?.classification||latest?.classification||'',summary:state?.summary||latest?.snippet||'',
   assigned_to:state?.assigned_to||'',next_action:'Review snoozed conversation',next_action_date:d.toISOString().slice(0,10),
   snoozed_until:d.toISOString(),last_message_at:state?.last_message_at||latest?.sent_at||'',last_direction:state?.last_direction||latest?.direction||'',unread_count:0
 }});
 toast('Snoozed for 3 days');await load();
};
window.draftInboxReply=async threadId=>{
 const msgs=inboxMessages(threadId),state=inboxThreadState(threadId),latest=msgs[msgs.length-1],pid=state?.prospect_id||latest?.prospect_id;
 if(!pid)return toast('Prospect match required first');
 const p=data.prospects.find(x=>x.id===pid);
 const inbound=[...msgs].reverse().find(m=>m.direction==='inbound');
 const recipient=inbound?.from_email||p?.contact_email||'';
 const subject=/^re:/i.test(latest?.subject||'')?(latest.subject||''):'Re: '+(latest?.subject||'');
 const id=await rpc('sales_os_save_email_draft',{p_token:token||null,p_payload:{
   prospect_id:pid,recipient,sender_name:p?.sender_name||actor?.display_name||'',
   sender_email:p?.sender_email||actor?.email||'',subject,body:'',status:'draft',
   provider:'gmail',provider_thread_id:threadId,reply_to_message_id:inbound?.provider_message_id||latest?.provider_message_id||'',
   created_by:actor?.display_name||'Sales OS'
 }});
 await load();currentDraft=data.email_drafts.find(d=>d.id===id)||data.email_drafts.find(d=>d.provider_thread_id===threadId&&d.status==='draft');go('email');
 if(currentDraft)openDraft(currentDraft.id);
};
window.openInboxCopilot=threadId=>{
 const state=inboxThreadState(threadId),latest=threadLatest(threadId),pid=state?.prospect_id||latest?.prospect_id;
 selectedInboxThread=threadId;
 openCopilot(pid,`Draft a concise reply to the latest message in the current sales inbox conversation. Address what they actually said, do not invent facts, and return a draft subject and body.`);
};

function renderAIQueue(){
 if(!$('#aiActionQueue'))return;
 const open=data.recommendations.filter(r=>r.status==='open').sort((a,b)=>({high:0,normal:1,low:2}[a.priority]??1)-({high:0,normal:1,low:2}[b.priority]??1)||(new Date(a.due_at||'2999')-new Date(b.due_at||'2999')));
 $('#aiActionQueue').innerHTML=open.length?open.map(r=>`<div class="card panel"><div class="focusrow" style="border:0;padding:0"><div class="maincopy"><div class="title">${esc(r.title)}</div><div class="meta">${esc(prospectName(r.prospect_id)||'General')} · ${esc(r.priority)}${r.due_at?' · due '+new Date(r.due_at).toLocaleString():''}</div>${r.rationale?`<div class="sub" style="margin-top:7px">${esc(r.rationale)}</div>`:''}${r.suggested_action?`<div class="sub" style="margin-top:5px"><b>Suggested:</b> ${esc(r.suggested_action)}</div>`:''}</div><div class="pageactions">${r.prospect_id?`<button class="btn" onclick="event.stopPropagation();openProspect('${r.prospect_id}')">Open</button>`:''}<button class="btn" onclick="event.stopPropagation();resolveAIAction('${r.id}','done')">Done</button><button class="btn" onclick="event.stopPropagation();resolveAIAction('${r.id}','dismissed')">Dismiss</button></div></div></div>`).join(''):'<div class="empty">No open AI actions.</div>';
}
window.resolveAIAction=async(id,status)=>{await rpc('sales_os_save_recommendation',{p_token:token,p_payload:{id,status}});toast(status==='done'?'Action completed':'Action dismissed');await load()};

function renderEmail(){
 const drafts=[...data.email_drafts].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
 $('#draftList').innerHTML=drafts.length?drafts.map(d=>`<div class="listrow ${currentDraft?.id===d.id?'active':''}" onclick="openDraft('${d.id}')"><b>${esc(d.subject||'(No subject)')}</b><p>${esc(prospectName(d.prospect_id)||'')} · ${esc(d.recipient||'')} · ${esc(d.status)}</p></div>`).join(''):'<div class="empty">No saved drafts.</div>';
 if(currentDraft){const d=data.email_drafts.find(x=>x.id===currentDraft.id);if(d)showDraftEditor(d)}
}
function showDraftEditor(d){
 const p=data.prospects.find(x=>x.id===d.prospect_id);
 $('#emailEditor').innerHTML=`<div class="panelhead"><div><h2>${esc(p?.company||'Email draft')}</h2><small>${esc(d.status)}</small></div><button class="btn" id="aiDraftBtn">AI writing</button></div>
 <div class="formgrid2"><div class="field"><label>To</label><input id="edTo" class="input" value="${esc(d.recipient||'')}"></div><div class="field"><label>From</label><input id="edFrom" class="input" value="${esc(d.sender_email||'')}"></div></div>
 <div class="field"><label>Subject</label><input id="edSubject" class="input" value="${esc(d.subject||'')}"></div><div class="field"><label>Message</label><textarea id="edBody" class="textarea" rows="16">${esc(d.body||'')}</textarea></div>
 <div class="pageactions"><button class="btn" id="saveDraftBtn">Save</button><button class="btn" id="copyDraftBtn">Copy</button><button class="btn green" id="directSendBtn">${actor?.role==='owner'?'Send with ChatGPT':'Request approval'}</button></div><p class="meta" style="margin-top:10px">${actor?.role==='owner'?'Owner session: protected send is allowed after your own review.':'The exact recipient, subject and body must be approved by the Sales OS owner before sending.'}</p>`;
 $('#saveDraftBtn').onclick=saveCurrentDraft;$('#copyDraftBtn').onclick=async()=>{await navigator.clipboard.writeText($('#edBody').value);toast('Copied')};$('#aiDraftBtn').onclick=()=>openAIWriter(d.prospect_id);$('#directSendBtn').onclick=()=>handleDirectSend(d.id);
}
window.openDraft=id=>{currentDraft=data.email_drafts.find(d=>d.id===id);renderEmail();if(window.matchMedia('(max-width:760px)').matches)setTimeout(()=>$('#emailEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),60)};
function renderAssets(){$('#assetGrid').innerHTML=data.assets.length?data.assets.map(a=>`<article class="assetcard"><span class="pill">${esc(a.asset_type)}</span><h3 style="font-size:13px;margin:9px 0 4px">${esc(a.title)}</h3><p>${esc(prospectName(a.prospect_id)||'Unlinked')} · ${esc(a.status||'')}</p><div class="assetactions">${a.url?`<a class="btn" href="${esc(a.url)}" target="_blank">Open ↗</a>`:''}<button class="btn" onclick="editAsset('${a.id}')">Edit</button></div></article>`).join(''):'<div class="empty">No assets.</div>'}
function renderReminders(){
 const open=data.reminders.filter(r=>r.status==='open').sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)),done=data.reminders.filter(r=>r.status==='completed').sort((a,b)=>new Date(b.completed_at||b.updated_at)-new Date(a.completed_at||a.updated_at));
 const row=r=>`<div class="reminderrow"><div class="maincopy"><div class="title">${esc(r.title)}</div><div class="meta">${esc(prospectName(r.prospect_id)||'General')} · ${new Date(r.due_at).toLocaleString()}</div></div>${r.status==='open'?`<button class="btn" onclick="completeReminder('${r.id}')">Done</button>`:''}</div>`;
 $('#openReminders').innerHTML=open.length?open.map(row).join(''):'<div class="empty">No open reminders.</div>';$('#doneReminders').innerHTML=done.length?done.slice(0,15).map(row).join(''):'<div class="empty">Nothing completed yet.</div>';
}
function renderNotes(){$('#notesGrid').innerHTML=data.notes.length?data.notes.map(n=>`<article class="notecard ${n.pinned?'pinned':''}" onclick="editNote('${n.id}')"><h3>${esc(n.title||'Note')}</h3><p>${esc(n.body)}</p><small>${esc(prospectName(n.prospect_id)||'General')} · ${new Date(n.updated_at).toLocaleDateString()}</small></article>`).join(''):'<div class="empty">No notes yet.</div>'}
function renderCategories(){
 const counts={};data.prospects.forEach(p=>counts[p.category]=(counts[p.category]||0)+1);
 $('#categoriesOverview').innerHTML=categoryNames().map(c=>`<div class="focusrow"><div class="maincopy"><div class="title">${esc(c)}</div><div class="meta">${counts[c]||0} prospects</div></div></div>`).join('')||'<div class="empty">No categories.</div>';
}
function renderConnections(){
 $('#connectionsGrid').innerHTML=data.connections.map(c=>`<article class="connection"><div class="panelhead"><h3>${esc(c.label)}</h3><span class="pill ${c.status==='connected'?'green':'amber'}">${esc(c.status.replaceAll('_',' '))}</span></div><p>${c.key==='chatgpt'?'Connect Sales OS to ChatGPT as a private MCP app so ChatGPT can read and update CRM data conversationally.':'Connect Gmail for direct send, reply tracking and thread-aware follow-ups.'}</p><button class="btn ${c.status==='connected'?'':'primary'}" onclick="openConnection('${c.key}')">${c.status==='connected'?'Manage':'Set up'}</button></article>`).join('');
}
function renderIdentity(){
 const a=actor||data.actor||{display_name:'Shared',role:'shared'};
 const name=a.display_name||a.email||'Shared';
 const role=a.role||'shared';
 if($('#identityName'))$('#identityName').textContent=name;
 if($('#identityRole'))$('#identityRole').textContent=role==='owner'?'Owner':role==='editor'?'Editor':'Shared access';
 if($('#identityInitial'))$('#identityInitial').textContent=(name.trim().charAt(0)||'?').toUpperCase();
 if($('#sideIdentity'))$('#sideIdentity').innerHTML=`<b>${esc(name)}</b><span>${esc(role==='owner'?'Owner · approvals enabled':role==='editor'?'Editor · protected sends require approval':'Shared fallback · cannot approve')}</span>`;
}
function approvalForDraft(draftId,status=null){
 const rows=data.approvals.filter(a=>a.item_type==='email_send'&&a.source_id===draftId);
 return rows.filter(a=>!status||a.status===status).sort((a,b)=>new Date(b.requested_at)-new Date(a.requested_at))[0]||null;
}
function approvalMatchesDraft(a,d){
 if(!a||!d)return false;
 const p=a.payload||{};
 return String(p.recipient||'')===String(d.recipient||'')&&String(p.subject||'')===String(d.subject||'')&&String(p.body||'')===String(d.body||'');
}
function renderApprovals(){
 if(!$('#approvalList'))return;
 const pending=data.approvals.filter(a=>a.status==='pending').sort((a,b)=>new Date(b.requested_at)-new Date(a.requested_at));
 const history=data.approvals.filter(a=>a.status!=='pending').sort((a,b)=>new Date(b.reviewed_at||b.updated_at)-new Date(a.reviewed_at||a.updated_at)).slice(0,20);
 if($('#approvalSummary'))$('#approvalSummary').textContent=pending.length+' pending';
 const owner=(actor?.role==='owner');
 $('#approvalList').innerHTML=pending.length?pending.map(a=>`<div class="approval-card">
   <div class="approval-main">
    <div class="title">${esc(a.title)}</div>
    <div class="meta">${esc(prospectName(a.prospect_id)||'General')} · requested by ${esc(a.requested_by_name||a.requested_by_email||'Shared access')} · ${new Date(a.requested_at).toLocaleString()}</div>
    ${a.description?`<p>${esc(a.description)}</p>`:''}
    ${a.item_type==='email_send'?`<div class="approval-email"><b>To:</b> ${esc(a.payload?.recipient||'')}<br><b>Subject:</b> ${esc(a.payload?.subject||'')}<div class="approval-body">${esc(a.payload?.body||'')}</div></div>`:''}
   </div>
   <div class="approval-actions">${owner?`<button class="btn green" onclick="reviewApproval('${a.id}','approved')">Approve</button><button class="btn" onclick="reviewApproval('${a.id}','changes_requested')">Changes</button><button class="btn danger" onclick="reviewApproval('${a.id}','rejected')">Reject</button>`:'<span class="pill amber">Waiting for owner</span>'}</div>
  </div>`).join(''):'<div class="empty">No pending approvals.</div>';
 $('#approvalHistory').innerHTML=history.length?history.map(a=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(a.title)}</div><div class="meta">${esc(a.status.replaceAll('_',' '))} · ${esc(a.reviewer_name||a.requested_by_name||'')} · ${new Date(a.reviewed_at||a.updated_at).toLocaleString()}</div>${a.review_note?`<div class="sub">${esc(a.review_note)}</div>`:''}</div></div>`).join(''):'<div class="empty">No approval history yet.</div>';
 $('#auditList').innerHTML=data.audit_log.slice(0,50).map(x=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(x.summary||x.action)}</div><div class="meta">${esc(x.actor_name||'System')} · ${esc(x.actor_role||'system')} · ${new Date(x.created_at).toLocaleString()}</div></div></div>`).join('')||'<div class="empty">No audit entries yet.</div>';
}
window.reviewApproval=async(id,decision)=>{
 if(actor?.role!=='owner'){toast('Owner sign-in required');return}
 let note='';
 if(decision!=='approved')note=prompt(decision==='rejected'?'Reason for rejection (optional)':'What needs changing?')||'';
 try{
  await rpc('sales_os_review_approval',{p_token:token||null,p_id:id,p_decision:decision,p_note:note});
  toast(decision==='approved'?'Approved':'Decision saved');await load();
 }catch(e){toast('Approval failed: '+String(e.message||e))}
};
function renderNotifications(){
 const ns=data.notifications.filter(n=>!n.dismissed_at);$('#noticeList').innerHTML=ns.length?ns.slice(0,20).map(n=>`<div class="noticeitem ${n.read_at?'':'unread'}"><b>${esc(n.title)}</b><p>${esc(n.body||'')}</p><button class="btn" onclick="markNotice('${n.id}','read')">Read</button> <button class="btn" onclick="markNotice('${n.id}','dismiss')">Dismiss</button></div>`).join(''):'<div class="empty">You’re all caught up.</div>';
}

function go(page){currentPage=page;document.querySelectorAll('[data-page-view]').forEach(s=>s.classList.toggle('hidden',s.dataset.pageView!==page));document.querySelectorAll('.navitem[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));document.querySelectorAll('[data-mobile-page]').forEach(b=>b.classList.toggle('active',b.dataset.mobilePage===page));if($('#mobileMoreBtn'))$('#mobileMoreBtn').classList.toggle('active',['pipeline','email','reminders','assets','notes','categories','approvals','connections'].includes(page));$('#noticeMenu').classList.add('hidden');closeMobileMore();if(page==='prospects')renderProspects();if(page==='email')renderEmail();if(window.matchMedia('(max-width:760px)').matches)window.scrollTo({top:0,behavior:'auto'})}
function modal(title,body){$('#genericModalCard').innerHTML=`<div class="modalhead"><h2>${esc(title)}</h2><button class="close" onclick="closeModal()">×</button></div>${body}`;$('#genericModal').classList.remove('hidden');document.body.classList.add('modal-open')}
window.closeModal=()=>{$('#genericModal').classList.add('hidden');document.body.classList.remove('modal-open')};

window.openProspect=id=>{
 selectedProspect=data.prospects.find(p=>p.id===id);if(!selectedProspect)return;const p=selectedProspect;
 $('#pdCompany').textContent=p.company;$('#pdCategory').textContent=p.category||'General';$('#pdMeta').textContent=[p.segment,p.location].filter(Boolean).join(' · ');
 $('#pdCategorySelect').innerHTML=categoryNames().map(x=>`<option>${esc(x)}</option>`).join('');$('#pdCategorySelect').value=p.category||'';$('#pdStage').innerHTML=STAGES.map(x=>`<option>${x}</option>`).join('');$('#pdStage').value=p.stage||'Research';
 $('#pdOwner').value=p.owner_assigned||'';$('#pdPriority').value=p.priority||'';$('#pdContact').value=p.contact_name||'';$('#pdEmail').value=p.contact_email||'';$('#pdWebsite').value=p.website||'';$('#pdLocation').value=p.location||'';$('#pdNextAction').value=p.next_action||'';$('#pdNextDate').value=p.next_action_date||'';
 $('#pdAssets').innerHTML=pAssets(id).map(a=>`<div class="focusrow"><div class="maincopy"><div class="title">${esc(a.title)}</div><div class="meta">${esc(a.asset_type)} · ${esc(a.status)}</div></div><button class="btn" onclick="editAsset('${a.id}')">Edit</button></div>`).join('')||'<div class="meta">No assets yet.</div>';
 $('#pdNotes').innerHTML=pNotes(id).map(n=>`<div class="noterow"><div><div class="title">${esc(n.title||'Note')}</div><div class="meta">${esc((n.body||'').slice(0,140))}</div></div></div>`).join('')||'<div class="meta">No notes yet.</div>';
 $('#pdReminders').innerHTML=pReminders(id).filter(r=>r.status==='open').map(r=>`<div class="reminderrow"><div class="maincopy"><div class="title">${esc(r.title)}</div><div class="meta">${new Date(r.due_at).toLocaleString()}</div></div></div>`).join('')||'<div class="meta">No open reminders.</div>';
 const opp=pOpportunity(id);if($('#pdOppValue'))$('#pdOppValue').value=opp?.estimated_value||'';if($('#pdOppKg'))$('#pdOppKg').value=opp?.monthly_volume_kg||'';if($('#pdOppProb'))$('#pdOppProb').value=opp?.probability_pct||'';if($('#pdOppNotes'))$('#pdOppNotes').value=opp?.commercial_notes||'';
 $('#pdActivity').innerHTML=pActivities(id).slice(0,20).map(a=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(a.activity_type||'Activity')}</div><div class="meta">${esc(a.subject||a.outcome||'')} · ${new Date(a.occurred_at).toLocaleDateString()}</div></div></div>`).join('')||'<div class="meta">No activity yet.</div>';
 $('#prospectDrawer').classList.remove('hidden');document.body.classList.add('modal-open');
};
async function saveProspect(){const p=selectedProspect;if(!p)return;await rpc('sales_os_save_prospect',{p_token:token,p_payload:{id:p.id,category:$('#pdCategorySelect').value,stage:$('#pdStage').value,owner_assigned:$('#pdOwner').value,priority:$('#pdPriority').value,contact_name:$('#pdContact').value,contact_email:$('#pdEmail').value,website:$('#pdWebsite').value,location:$('#pdLocation').value,next_action:$('#pdNextAction').value,next_action_date:$('#pdNextDate').value}});toast('Account updated');await load();openProspect(p.id)}
async function saveOpportunity(){
 const p=selectedProspect;if(!p)return;
 await rpc('sales_os_save_opportunity',{p_token:token,p_payload:{prospect_id:p.id,estimated_value:$('#pdOppValue').value,monthly_volume_kg:$('#pdOppKg').value,probability_pct:$('#pdOppProb').value,commercial_notes:$('#pdOppNotes').value,currency:'USD',updated_by:'Sales OS'}});
 toast('Opportunity updated');await load();openProspect(p.id);
}

function openProspectForm(){modal('Add prospect',`<div class="formgrid2"><div class="field"><label>Company</label><input id="npCompany" class="input"></div><div class="field"><label>Category</label><select id="npCategory" class="select">${categoryNames().map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div class="field"><label>Contact</label><input id="npContact" class="input"></div><div class="field"><label>Email</label><input id="npEmail" class="input"></div><div class="field"><label>Website</label><input id="npWebsite" class="input"></div><div class="field"><label>Owner</label><input id="npOwner" class="input" value="Yazeed"></div></div><button id="createProspectConfirm" class="btn primary">Create prospect</button>`);$('#createProspectConfirm').onclick=async()=>{const company=$('#npCompany').value.trim();if(!company)return toast('Company required');await rpc('sales_os_save_prospect',{p_token:token,p_payload:{company,category:$('#npCategory').value||'General',contact_name:$('#npContact').value,contact_email:$('#npEmail').value,website:$('#npWebsite').value,owner_assigned:$('#npOwner').value||'Yazeed',stage:'Research',status:'Not started',next_action:'Review and qualify'}});closeModal();toast('Prospect added');await load()}}

function openNoteForm(prospectId=null,note=null){modal(note?'Edit note':'New note',`<div class="field"><label>Title</label><input id="noteTitle" class="input" value="${esc(note?.title||'')}"></div><div class="field"><label>Note</label><textarea id="noteBody" class="textarea" rows="9">${esc(note?.body||'')}</textarea></div><label style="font-size:10px"><input id="notePinned" type="checkbox" ${note?.pinned?'checked':''}> Pin note</label><div style="margin-top:12px"><button id="saveNoteConfirm" class="btn primary">Save note</button></div>`);$('#saveNoteConfirm').onclick=async()=>{await rpc('sales_os_save_note',{p_token:token,p_payload:{id:note?.id,prospect_id:prospectId||note?.prospect_id,title:$('#noteTitle').value,body:$('#noteBody').value,pinned:$('#notePinned').checked,created_by:'Sales OS'}});closeModal();toast('Note saved');await load();if(prospectId)openProspect(prospectId)}}
window.editNote=id=>{const n=data.notes.find(x=>x.id===id);if(n)openNoteForm(n.prospect_id,n)};

function openReminderForm(prospectId=null,r=null){modal(r?'Edit reminder':'New reminder',`<div class="field"><label>Reminder</label><input id="remTitle" class="input" value="${esc(r?.title||'')}"></div><div class="field"><label>When</label><input id="remDue" type="datetime-local" class="input" value="${esc(dateTimeLocal(r?.due_at)||dateTimeLocal(new Date(Date.now()+86400000)))}"></div><div class="formgrid2"><div class="field"><label>Owner</label><input id="remOwner" class="input" value="${esc(r?.owner_assigned||'Yazeed')}"></div><div class="field"><label>Priority</label><select id="remPriority" class="select"><option>normal</option><option>high</option><option>low</option></select></div></div><div class="field"><label>Details</label><textarea id="remBody" class="textarea">${esc(r?.body||'')}</textarea></div><button id="saveReminderConfirm" class="btn primary">Save reminder</button>`);$('#saveReminderConfirm').onclick=async()=>{await rpc('sales_os_save_reminder',{p_token:token,p_payload:{id:r?.id,prospect_id:prospectId||r?.prospect_id,title:$('#remTitle').value,due_at:new Date($('#remDue').value).toISOString(),owner_assigned:$('#remOwner').value,priority:$('#remPriority').value,body:$('#remBody').value,status:r?.status||'open',notify_in_app:true,created_by:'Sales OS'}});closeModal();toast('Reminder saved');await load();if(prospectId)openProspect(prospectId)}}
window.completeReminder=async id=>{await rpc('sales_os_save_reminder',{p_token:token,p_payload:{id,status:'completed'}});toast('Reminder completed');await load()};

function openAssetForm(prospectId=null,a=null){modal(a?'Edit asset':'New asset',`<div class="field"><label>Prospect</label><select id="assetProspect" class="select">${data.prospects.map(p=>`<option value="${p.id}">${esc(p.company)}</option>`).join('')}</select></div><div class="formgrid2"><div class="field"><label>Type</label><select id="assetType" class="select"><option>Website</option><option>Proposal</option><option>Images</option><option>Spreadsheet</option><option>Research</option><option>Other</option></select></div><div class="field"><label>Status</label><select id="assetStatus" class="select"><option>Built</option><option>Draft</option><option>Needs QA</option><option>Sent</option></select></div></div><div class="field"><label>Title</label><input id="assetTitle" class="input" value="${esc(a?.title||'')}"></div><div class="field"><label>URL</label><input id="assetUrl" class="input" value="${esc(a?.url||'')}"></div><div class="field"><label>Notes</label><textarea id="assetNotes" class="textarea">${esc(a?.notes||'')}</textarea></div><button id="saveAssetConfirm" class="btn primary">Save asset</button>`);$('#assetProspect').value=prospectId||a?.prospect_id||data.prospects[0]?.id||'';if(a){$('#assetType').value=a.asset_type||'Other';$('#assetStatus').value=a.status||'Built'}$('#saveAssetConfirm').onclick=async()=>{await rpc('sales_os_save_asset',{p_token:token,p_payload:{id:a?.id,prospect_id:$('#assetProspect').value,asset_type:$('#assetType').value,status:$('#assetStatus').value,title:$('#assetTitle').value,url:$('#assetUrl').value,notes:$('#assetNotes').value}});closeModal();toast('Asset saved');await load();if(prospectId)openProspect(prospectId)}}
window.editAsset=id=>{const a=data.assets.find(x=>x.id===id);if(a)openAssetForm(a.prospect_id,a)};

function openNewDraft(prospectId=null){modal('New email draft',`<div class="field"><label>Prospect</label><select id="draftProspect" class="select">${data.prospects.map(p=>`<option value="${p.id}">${esc(p.company)}</option>`).join('')}</select></div><div class="field"><label>Subject</label><input id="draftSubject" class="input"></div><div class="field"><label>Message</label><textarea id="draftBody" class="textarea" rows="10"></textarea></div><div class="pageactions"><button id="draftAI" class="btn">AI writing</button><button id="createDraftConfirm" class="btn primary">Save draft</button></div>`);if(prospectId)$('#draftProspect').value=prospectId;$('#draftAI').onclick=()=>openAIWriter($('#draftProspect').value);$('#createDraftConfirm').onclick=async()=>{const p=data.prospects.find(x=>x.id===$('#draftProspect').value);await rpc('sales_os_save_email_draft',{p_token:token,p_payload:{prospect_id:p.id,recipient:p.contact_email||'',sender_name:p.sender_name||'Robert Gibbons',sender_email:p.sender_email||'robert@morpheuspd.io',subject:$('#draftSubject').value,body:$('#draftBody').value,status:'draft',created_by:'Sales OS'}});closeModal();toast('Draft saved');await load();go('email')}}
async function saveCurrentDraft(){const d=currentDraft;if(!d)return;await rpc('sales_os_save_email_draft',{p_token:token,p_payload:{id:d.id,recipient:$('#edTo').value,sender_email:$('#edFrom').value,subject:$('#edSubject').value,body:$('#edBody').value,status:'draft'}});toast('Draft saved');await load()}

function openAIWriter(prospectId){
 const p=data.prospects.find(x=>x.id===prospectId),as=pAssets(prospectId),acts=pActivities(prospectId).slice(0,8);
 const prompt=`You are helping write a concise B2B sales email for Morpheus Sales OS.

PROSPECT
Company: ${p?.company||''}
Category: ${p?.category||''}
Contact: ${p?.contact_name||''}
Current stage: ${p?.stage||''}
Next action: ${p?.next_action||''}

ASSETS WE HAVE MADE
${as.map(a=>'- '+a.asset_type+': '+a.title+(a.url?' — '+a.url:'')).join('\n')||'- None'}

RECENT CRM CONTEXT
${acts.map(a=>'- '+a.activity_type+': '+(a.subject||a.outcome||'')).join('\n')||'- None'}

Write a natural, short, non-hype outreach email. Do not invent facts. If an asset exists, use it naturally. Return:
SUBJECT:
BODY:`;
 modal('AI writing',`<div class="ai-box"><h3>ChatGPT-ready context</h3><p>While the private MCP connection is being activated, this keeps the context clean and complete.</p></div><div class="field" style="margin-top:10px"><textarea id="aiPrompt" class="textarea" rows="17" readonly>${esc(prompt)}</textarea></div><div class="pageactions"><button id="copyAiPrompt" class="btn primary">Copy prompt</button><button id="openChatGPT" class="btn">Open ChatGPT</button></div>`);$('#copyAiPrompt').onclick=async()=>{await navigator.clipboard.writeText($('#aiPrompt').value);toast('AI prompt copied')};$('#openChatGPT').onclick=()=>window.open('https://chatgpt.com/','_blank');
}
async function launchApprovedSend(d,approval=null){
 const p=data.prospects.find(x=>x.id===d.prospect_id);
 const approvalLine=approval?` This draft has Sales OS approval ID ${approval.id}; verify that approval before sending.`:' This send is initiated from an authenticated Sales OS Owner session.';
 const prompt=`Use my connected Morpheus Sales OS and Gmail apps.

Open the Sales OS prospect "${p?.company||''}" and find email draft ID ${d.id}.${approvalLine}
Review the exact saved recipient, subject and body. If the approved snapshot no longer matches the current draft, do not send and tell me. Otherwise send that exact draft through my connected Gmail account, then call Sales OS mark_email_sent with the Gmail message ID so the CRM and audit trail stay synchronized.`;
 await navigator.clipboard.writeText(prompt);window.open('https://chatgpt.com/','_blank');toast('Approved send instruction copied');
}
async function handleDirectSend(){
 const d=currentDraft;if(!d)return;
 await saveCurrentDraft();
 const fresh=data.email_drafts.find(x=>x.id===d.id)||d;
 if(actor?.role==='owner'){await launchApprovedSend(fresh,null);return}
 const approved=approvalForDraft(fresh.id,'approved');
 if(approved&&approvalMatchesDraft(approved,fresh)){await launchApprovedSend(fresh,approved);return}
 const pending=approvalForDraft(fresh.id,'pending');
 if(pending&&approvalMatchesDraft(pending,fresh)){go('approvals');toast('Already waiting for owner approval');return}
 try{
  await rpc('sales_os_request_approval',{p_token:token||null,p_payload:{
    prospect_id:fresh.prospect_id,item_type:'email_send',source_table:'sales_os_email_drafts',source_id:fresh.id,
    title:'Send email to '+(prospectName(fresh.prospect_id)||fresh.recipient||'prospect'),
    description:'Protected outbound email. Approval is tied to this exact draft snapshot.',
    ai_assisted:!!fresh.ai_assisted,
    payload:{recipient:fresh.recipient||'',sender_name:fresh.sender_name||'',sender_email:fresh.sender_email||'',subject:fresh.subject||'',body:fresh.body||''}
  }});
  await load();go('approvals');toast('Approval requested');
 }catch(e){toast('Could not request approval: '+String(e.message||e))}
}
async function markNotice(id,action){await rpc('sales_os_set_notification_state',{p_token:token,p_id:id,p_action:action});await load()}
window.markNotice=markNotice;

function openConnection(key){
 if(key==='chatgpt'){
  const base='https://viajmvbwpmkiqxjtgshv.supabase.co/functions/v1/sales-os-mcp/mcp';
  const privateMode=!!token;
  const mcp=privateMode?base+'?access_code='+encodeURIComponent(token):base;
  modal('Connect ChatGPT',`<div class="ai-box"><h3>${privateMode?'Private team MCP is ready':'Personal Sales OS identity is active'}</h3><p>${privateMode?'Use the private MCP URL below in ChatGPT. It carries your current Sales OS team access code.':'Your dashboard is now using a named member session. The Sales OS MCP backend also supports member OAuth; until the Supabase OAuth Server setting is enabled, use emergency shared-code access when you need to copy the private MCP URL.'}</p></div>
  <div style="margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:13px">
    <div class="title">1 · ${privateMode?'Copy the private MCP URL':'Member MCP endpoint'}</div>
    <div class="meta" style="font-size:11px;line-height:1.7">${privateMode?'Treat this URL like a password. Share it only with the Sales OS team.':'Per-user OAuth is prepared on this endpoint. Your personal dashboard session does not expose the team code.'}</div>
    <input id="mcpUrlCopy" class="input" readonly value="${esc(mcp)}" style="margin-top:7px">
    ${privateMode?'<button id="copyMcpBtn" class="btn primary" style="margin-top:8px">Copy MCP URL</button>':''}
  </div>
  <div style="margin-top:9px;border:1px solid var(--line);border-radius:12px;padding:13px">
    <div class="title">2 · Add it to ChatGPT</div>
    <div class="meta" style="font-size:11px;line-height:1.7">In ChatGPT, add a custom MCP / private plugin connection and paste the URL. No additional authentication should be required for this team-code build.</div>
  </div>
  <div style="margin-top:9px;border:1px solid var(--line);border-radius:12px;padding:13px">
    <div class="title">3 · Work naturally</div>
    <div class="meta" style="font-size:11px;line-height:1.7">Ask ChatGPT to search or create prospects, update stages, add notes and reminders, create/edit asset records, draft email, or save drafts back into Sales OS. For an actual email send, use the connected Gmail app in the same ChatGPT conversation, then ChatGPT can mark the Sales OS draft as sent.</div>
  </div>
  <details style="margin-top:12px"><summary style="font-size:11px;font-weight:800;cursor:pointer">Stronger OAuth mode later</summary><p class="meta" style="font-size:11px;line-height:1.7">The OAuth consent screen and member allow-list are already built. When Supabase OAuth Server is enabled, the same MCP backend can switch to per-user OAuth instead of the shared team code.</p></details>`);
  if($('#copyMcpBtn'))$('#copyMcpBtn').onclick=async()=>{await navigator.clipboard.writeText(mcp);toast('Private MCP URL copied')};
 } else {
  modal('Email connection',`<div class="ai-box"><h3>Email works through ChatGPT + Gmail</h3><p>Sales OS stores the editable draft and account context. ChatGPT can use your connected Gmail app to send the actual message, then update the exact Sales OS draft and activity history.</p></div>
  <p class="meta" style="font-size:11px;line-height:1.7;margin-top:12px">This avoids placing Gmail credentials in the static dashboard. If Gmail is connected in ChatGPT, the full flow is: open Sales OS in ChatGPT → draft/update → send via Gmail → mark the CRM draft sent.</p>`);
 }
}
window.openConnection=openConnection;

function openCategoryManager(){modal('Manage categories',`<div class="formgrid2"><div class="field"><label>Category</label><input id="newCatName" class="input" placeholder="Dog Food · Retail"></div><div class="field"><label>Description</label><input id="newCatDesc" class="input"></div></div><button id="addCatConfirm" class="btn primary">Add category</button><div style="margin-top:14px">${categoryNames().map(c=>`<div class="focusrow"><div class="maincopy"><div class="title">${esc(c)}</div><div class="meta">${data.prospects.filter(p=>p.category===c).length} prospects</div></div></div>`).join('')}</div>`);$('#addCatConfirm').onclick=async()=>{const name=$('#newCatName').value.trim();if(!name)return;await rpc('sales_os_save_category',{p_token:token,p_payload:{name,description:$('#newCatDesc').value,active:true}});closeModal();toast('Category added');await load()}}
const HEADER_ALIASES={'company name':'company','business':'company','business name':'company','prospect':'company','market':'category','industry':'category','contact':'contact_name','contact person':'contact_name','decision maker':'contact_name','role':'contact_role','title':'contact_role','email':'contact_email','e mail':'contact_email','url':'website','site':'website','owner':'owner_assigned','assigned to':'owner_assigned','source':'source_groups','sources':'source_notes','asset':'asset_title','asset link':'asset_url','subject':'outreach_subject','message':'outreach_message'};
function cleanHeader(x){return String(x||'').replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[\/\-]+/g,' ').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim()}
function canonicalHeader(x){const n=cleanHeader(x);return HEADER_ALIASES[n]||n.replaceAll(' ','_')}
function parseCSV(text){text=String(text||'').replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell=''}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(ch!=='\r')cell+=ch}if(cell.length||row.length){row.push(cell);rows.push(row)}if(!rows.length)return[];const headers=rows.shift().map(canonicalHeader);return rows.filter(r=>r.some(c=>String(c).trim())).map(r=>{const o={};headers.forEach((k,i)=>{if(k)o[k]=String(r[i]??'').trim()});return o})}
function importPrompt(category){return `Convert every relevant prospect/contact already identified in this chat into a downloadable UTF-8 CSV for Morpheus Sales OS.

DEFAULT CATEGORY: ${category||'[CATEGORY NAME]'}

Use EXACTLY this header:
${CSV_COLUMNS.join(',')}

Rules:
- One company per row. company is required. Deduplicate companies.
- Use public business information only. Never invent contacts, emails, phone numbers, URLs or claims.
- owner_assigned defaults to Yazeed; stage defaults to Research; status defaults to Not started.
- priority may be A+, A, B or C; score may be 0-100 only when defensible.
- tags, source_groups and source_notes use | between multiple values inside one CSV cell.
- asset fields are optional and must only be used for real assets already created.
- outreach_subject and outreach_message are optional DRAFT fields only; never claim a message was sent without evidence.
- next_action_date must be YYYY-MM-DD or blank.
- Return a real .csv file, not a markdown table.`}
function openImporter(){const cats=categoryNames();modal('Import prospects',`<div class="formgrid2"><div class="field"><label>Default category</label><select id="impCat" class="select"><option value="">Use CSV category</option>${cats.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div class="field"><label>Import mode</label><select id="impMode" class="select"><option value="smart">Smart merge</option><option value="overwrite">Update existing</option><option value="new_only">New only</option></select></div></div><div class="field"><label>CSV file</label><input id="impFile" class="input" type="file" accept=".csv,text/csv"></div><div class="ai-box"><h3>Research prompt</h3><p>Copy this into any ChatGPT prospect-research conversation.</p><textarea id="impPrompt" class="textarea" rows="9" readonly></textarea><button id="copyImpPrompt" class="btn" style="margin-top:8px">Copy ChatGPT prompt</button></div><div id="impPreview" style="margin-top:12px"></div>`);const update=()=>$('#impPrompt').value=importPrompt($('#impCat').value);update();$('#impCat').onchange=update;$('#copyImpPrompt').onclick=async()=>{await navigator.clipboard.writeText($('#impPrompt').value);toast('Import prompt copied')};$('#impFile').onchange=async e=>{if(!e.target.files?.[0])return;const rows=parseCSV(await e.target.files[0].text()).filter(r=>r.company);$('#impPreview').innerHTML=`<p style="font-size:11px">${rows.length} rows ready.</p><button id="importNow" class="btn primary">Import ${rows.length}</button>`;$('#importNow').onclick=async()=>{const normalized=rows.map(r=>({...r,tags:String(r.tags||'').split(/[|;]/).filter(Boolean),source_groups:String(r.source_groups||'').split(/[|;]/).filter(Boolean),source_notes:String(r.source_notes||'').split(/[|;]/).filter(Boolean)}));const res=await rpc('sales_os_bulk_import',{p_token:token,p_rows:normalized,p_mode:$('#impMode').value,p_defaults:{category:$('#impCat').value,owner_assigned:'Yazeed',stage:'Research',status:'Not started',sender_name:'Robert Gibbons',sender_email:'robert@morpheuspd.io'}});closeModal();toast(`${res.inserted||0} new · ${res.updated||0} merged`);await load()}}}
async function requestBrowserNotifications(){if(!('Notification'in window)){toast('Browser notifications are not supported here');return}const p=await Notification.requestPermission();toast(p==='granted'?'Browser notifications enabled':'Notification permission not granted');if(p==='granted')showDueBrowserNotifications()}
function showDueBrowserNotifications(){if(!('Notification'in window)||Notification.permission!=='granted')return;data.reminders.filter(dueReminder).slice(0,3).forEach(r=>new Notification('Morpheus Sales OS',{body:r.title+(prospectName(r.prospect_id)?' · '+prospectName(r.prospect_id):'')}))}

function openMobileMore(){$('#mobileMoreSheet')?.classList.remove('hidden');document.body.classList.add('modal-open')}
function closeMobileMore(){$('#mobileMoreSheet')?.classList.add('hidden');if($('#genericModal')?.classList.contains('hidden')&&$('#prospectDrawer')?.classList.contains('hidden'))document.body.classList.remove('modal-open')}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll('[data-mobile-page]').forEach(b=>b.onclick=()=>go(b.dataset.mobilePage));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
document.querySelectorAll('[data-more-page]').forEach(b=>b.onclick=()=>go(b.dataset.morePage));
if($('#mobileMoreBtn'))$('#mobileMoreBtn').onclick=openMobileMore;
if($('#mobileMoreClose'))$('#mobileMoreClose').onclick=closeMobileMore;
document.querySelectorAll('[data-close-mobile-more]').forEach(x=>x.onclick=closeMobileMore);
if($('#mobileFab'))$('#mobileFab').onclick=openProspectForm;
if($('#mobileMoreLock'))$('#mobileMoreLock').onclick=signOutWorkspace;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e});
if($('#mobileInstallApp'))$('#mobileInstallApp').onclick=async()=>{
 if(deferredInstallPrompt){
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  closeMobileMore();
 }else{
  toast('Use your browser menu → Add to Home screen');
 }
};
$('#loginBtn').onclick=login;if($('#memberLoginBtn'))$('#memberLoginBtn').onclick=memberLogin;$('#accessCode').addEventListener('keydown',e=>{if(e.key==='Enter'){if($('#memberEmail')?.value.trim())memberLogin();else login()}});$('#lockBtn').onclick=signOutWorkspace;if($('#identityBtn'))$('#identityBtn').onclick=()=>go('approvals');if($('#approvalRefreshBtn'))$('#approvalRefreshBtn').onclick=load;
$('#notificationBtn').onclick=()=>$('#noticeMenu').classList.toggle('hidden');$('#globalSearch').oninput=()=>{renderProspects();if($('#globalSearch').value)go('prospects')};
if($('#syncInboxGuideBtn'))$('#syncInboxGuideBtn').onclick=()=>openChatGPTAutopilot('sync');
if($('#aiQueueGuideBtn'))$('#aiQueueGuideBtn').onclick=()=>openChatGPTAutopilot('autopilot');
function openChatGPTAutopilot(mode){
 const text=mode==='sync'
 ? 'Use my connected Gmail and Morpheus Sales OS apps. Find new prospect emails since the last Sales OS sync, match them to the correct prospect, write each real message into Sales OS with sync_email_message, classify inbound replies, and create only useful next-action recommendations. Do not send any email.'
 : 'Use my Morpheus Sales OS app. Run get_autopilot_brief, review the open AI action queue, and help me work the highest-priority items first. Draft where useful, but do not send anything without my approval.';
 navigator.clipboard.writeText(text).then(()=>{window.open('https://chatgpt.com/','_blank');toast('Autopilot instruction copied')});
}

['prospectSearch','prospectCategory','prospectStage','prospectOwner'].forEach(id=>$('#'+id).addEventListener(id==='prospectSearch'?'input':'change',renderProspects));
$('#quickProspectBtn').onclick=openProspectForm;$('#addProspectBtn').onclick=openProspectForm;$('#quickNoteBtn').onclick=()=>openNoteForm();$('#newNoteBtn').onclick=()=>openNoteForm();$('#newReminderBtn').onclick=()=>openReminderForm();$('#dashReminderBtn').onclick=()=>openReminderForm();$('#browserNotifyBtn').onclick=requestBrowserNotifications;
$('#newAssetBtn').onclick=()=>openAssetForm();$('#newEmailBtn').onclick=()=>openNewDraft();$('#categoryManagerBtn').onclick=openCategoryManager;$('#openImportBtn').onclick=openImporter;$('#categoryImportBtn').onclick=openImporter;$('#dashImportBtn').onclick=openImporter;$('#prospectImportBtn').onclick=openImporter;
$('#saveProspect').onclick=saveProspect;if($('#saveOpportunity'))$('#saveOpportunity').onclick=saveOpportunity;$('#pdNewAsset').onclick=()=>openAssetForm(selectedProspect?.id);$('#pdNewNote').onclick=()=>openNoteForm(selectedProspect?.id);$('#pdNewReminder').onclick=()=>openReminderForm(selectedProspect?.id);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{const el=$('#'+b.dataset.close);el?.classList.add('hidden');if(b.dataset.close==='prospectDrawer')document.body.classList.remove('modal-open')});$('#genericModal').addEventListener('click',e=>{if(e.target.id==='genericModal')closeModal()});$('#prospectDrawer').addEventListener('click',e=>{if(e.target.id==='prospectDrawer'){e.currentTarget.classList.add('hidden');document.body.classList.remove('modal-open')}});
(async()=>{
 const lastEmail=localStorage.getItem('salesOsMemberEmail');
 if(lastEmail&&$('#memberEmail'))$('#memberEmail').value=lastEmail;
 const memberOk=await tryMemberSession();
 if(memberOk)return;
 const saved=localStorage.getItem('salesOsToken');
 if(saved&&$('#accessCode'))$('#accessCode').value=saved;
})().catch(()=>{});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
