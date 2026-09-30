const API='https://viajmvbwpmkiqxjtgshv.supabase.co/rest/v1/rpc/';
const APIKEY='sb_publishable_gGFZftPonWKNZCdvUSM3yQ_gZvyI6_H';
const SUPABASE_URL='https://viajmvbwpmkiqxjtgshv.supabase.co';
const AUTH_BOOTSTRAP=SUPABASE_URL+'/functions/v1/sales-os-auth-bootstrap';
const STAGES=['Research','Asset ready','Ready to contact','Contacted','Follow-up','Replied','Qualified','Meeting','Proposal','Negotiation','Won','Lost','Disqualified','Hold'];
const PIPELINE_STAGES=['Research','Ready to contact','Contacted','Follow-up','Replied','Qualified','Proposal','Negotiation'];
const CSV_COLUMNS=['company','category','segment','location','website','contact_name','contact_role','contact_email','phone','priority','score','owner_assigned','sender_name','sender_email','stage','status','next_action','next_action_date','caution','notes','tags','source_groups','source_notes','asset_type','asset_title','asset_url','asset_status','outreach_subject','outreach_message'];

let token='';
let data={prospects:[],assets:[],asset_versions:[],asset_work_requests:[],asset_deliverables:[],asset_job_notes:[],asset_builders:[],activities:[],templates:[],categories:[],notes:[],reminders:[],email_drafts:[],notifications:[],connections:[],gmail_connections:[],email_messages:[],inbox_threads:[],recommendations:[],opportunities:[],approvals:[],audit_log:[],members:[],copilot_threads:[]};
let selectedProspect=null,currentDraft=null,currentPage='dashboard',deferredInstallPrompt=null;
let sessionAccessToken='',supabaseClient=null,actor=null;
let selectedInboxThread=null,copilotThreadId=null,copilotProspectId=null,copilotLocal=[];
let providerStatus={ai:false};

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const isPhone=()=>window.matchMedia('(max-width:760px)').matches;
const lockPage=()=>{if(!isPhone())document.body.classList.add('modal-open')};
const unlockPage=()=>{document.body.classList.remove('modal-open')};
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
function norm(){for(const k of ['prospects','assets','asset_versions','asset_work_requests','asset_deliverables','asset_job_notes','asset_builders','activities','templates','categories','notes','reminders','email_drafts','notifications','connections','gmail_connections','email_messages','inbox_threads','recommendations','opportunities','approvals','audit_log','members','copilot_threads'])data[k]=Array.isArray(data[k])?data[k]:[]}

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

  // The Supabase project is shared with QAJ, so do not follow its Site URL redirect.
  // Redeem the one-time sign-in token directly on the Sales OS page.
  const generated=new URL(d.action_link);
  const tokenHash=generated.searchParams.get('token');
  const verifyType=generated.searchParams.get('type')||'magiclink';
  if(!tokenHash)throw new Error('Sales OS sign-in token was not generated');

  const sb=await ensureSupabaseClient();
  const verified=await sb.auth.verifyOtp({token_hash:tokenHash,type:verifyType});
  if(verified.error)throw verified.error;
  const session=verified.data?.session;
  if(!session)throw new Error('Sales OS session was not created');

  sessionAccessToken=session.access_token;token='';
  actor=await rpc('sales_os_whoami',{p_token:null});
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await load();
 }catch(e){
  $('#memberLoginBtn').disabled=false;$('#memberLoginBtn').textContent='Open Sales OS';
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
 if(isPhone())unlockPage();
 data=await rpc('sales_os_snapshot',{p_token:token||null});norm();actor=data.actor||actor;
 try{const ai=await refreshAIStatus();providerStatus.ai=!!(ai.connected&&ai.api_ok)}catch(e){providerStatus.ai=false}
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
const pAssetJobs=id=>data.asset_work_requests.filter(j=>j.prospect_id===id).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
const jobDeliverables=id=>data.asset_deliverables.filter(d=>d.work_request_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
const jobNotes=id=>data.asset_job_notes.filter(n=>n.work_request_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
const isEngaged=p=>['Replied','Qualified','Meeting','Proposal','Negotiation','Won'].includes(p.stage);
const dueReminder=r=>r.status==='open'&&new Date(r.due_at)<=new Date();
const followupDue=p=>p.next_action_date&&p.next_action_date<=todayISO()&&!['Won','Lost','Disqualified','Hold'].includes(p.stage);

function renderCounts(){
 const drafts=data.email_drafts.filter(d=>d.status==='draft').length,openR=data.reminders.filter(r=>r.status==='open').length;
 const pendingApprovals=data.approvals.filter(a=>a.status==='pending').length;
 const due=data.reminders.filter(dueReminder).length+data.prospects.filter(followupDue).length+(actor?.authenticated===true?pendingApprovals:0);
 const inboxActions=data.inbox_threads.length?data.inbox_threads.filter(t=>t.status==='open').length:data.email_messages.filter(m=>m.requires_action).length;
 const aiActions=data.recommendations.filter(r=>r.status==='open').length;
 const activeValue=data.opportunities.filter(o=>!['Won','Lost','Disqualified','Hold'].includes(data.prospects.find(p=>p.id===o.prospect_id)?.stage)).reduce((sum,o)=>sum+Number(o.estimated_value||0),0);
 $('#navProspects').textContent=data.prospects.length;$('#navAssets').textContent=data.assets.length;$('#navDrafts').textContent=drafts;$('#navReminders').textContent=openR;
 if($('#navInbox'))$('#navInbox').textContent=inboxActions;if($('#navAI'))$('#navAI').textContent=aiActions;if($('#navApprovals'))$('#navApprovals').textContent=pendingApprovals;
 $('#statProspects').textContent=data.prospects.filter(p=>!['Won','Lost','Disqualified','Hold'].includes(p.stage)).length;$('#statDue').textContent=due;$('#statDrafts').textContent=drafts;
 if($('#statInbox'))$('#statInbox').textContent=inboxActions;if($('#statAI'))$('#statAI').textContent=aiActions;if($('#statValue'))$('#statValue').textContent='$'+activeValue.toLocaleString(undefined,{maximumFractionDigits:0});
 $('#notificationDot').classList.toggle('hidden',!data.notifications.some(n=>!n.read_at&&!n.dismissed_at));$('#todayDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
}
function renderDashboard(){
 const focus=[];
 data.reminders.filter(r=>r.status==='open').forEach(r=>focus.push({title:r.title,meta:(prospectName(r.prospect_id)||'General')+' · '+new Date(r.due_at).toLocaleString(),kind:'Reminder',due:new Date(r.due_at),pid:r.prospect_id}));
 data.prospects.filter(followupDue).forEach(p=>focus.push({title:p.next_action||'Follow up',meta:p.company+' · '+p.next_action_date,kind:'Follow-up',due:new Date(p.next_action_date),pid:p.id}));
 if(actor?.authenticated===true)data.approvals.filter(a=>a.status==='pending').forEach(a=>focus.push({title:a.title,meta:'Approval requested by '+(a.requested_by_name||a.requested_by_email||'team member'),kind:'Approval',due:new Date(a.requested_at),pid:a.prospect_id}));
 focus.sort((a,b)=>a.due-b.due);
 $('#todayFocus').innerHTML=focus.length?focus.slice(0,8).map(x=>`<div class="focusrow" ${x.pid?`onclick="openProspect('${x.pid}')"`:''}><div class="maincopy"><div class="title">${esc(x.title)}</div><div class="meta">${esc(x.meta)}</div></div><span class="pill ${x.due<new Date()?'red':'amber'}">${esc(x.kind)}</span></div>`).join(''):'<div class="empty">Nothing urgent right now.</div>';
 $('#recentActivity').innerHTML=data.activities.slice(0,8).map(a=>`<div class="activityrow" onclick="openProspect('${a.prospect_id}')"><div class="maincopy"><div class="title">${esc(a.activity_type||'Activity')} · ${esc(prospectName(a.prospect_id))}</div><div class="meta">${esc(a.subject||a.outcome||'')}${a.occurred_at?' · '+new Date(a.occurred_at).toLocaleDateString():''}</div></div></div>`).join('')||'<div class="empty">No activity yet.</div>';
 $('#pipelineSummary').innerHTML=STAGES.map(s=>({s,n:data.prospects.filter(p=>p.stage===s).length})).filter(x=>x.n).map(x=>`<div class="stagecard"><b>${x.n}</b><span>${esc(x.s)}</span></div>`).join('')||'<div class="empty">No pipeline data.</div>';
}
function syncFilters(){
 const c=$('#prospectCategory').value,s=$('#prospectStage').value,o=$('#prospectOwner').value;
 $('#prospectCategory').innerHTML='<option value="">All categories</option>'+categoryNames().map(x=>`<option>${esc(x)}</option>`).join('');
 $('#prospectStage').innerHTML='<option value="">All stages</option>'+STAGES.map(x=>`<option>${x}</option>`).join('');
 $('#prospectOwner').innerHTML='<option value="">All assignees</option>'+owners().map(x=>`<option>${esc(x)}</option>`).join('');
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
    <div class="mobile-prospect-row"><div class="mobile-prospect-meta">Assigned · ${esc(p.owner_assigned||'Unassigned')}</div><button class="btn" onclick="event.stopPropagation();openProspect('${p.id}')">Open</button></div>
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

 const actionCount=threads.filter(t=>t.status==='open').length;
 $('#inboxSummary').textContent=`${threads.length} threads · ${actionCount} need attention`;
 if($('#syncInboxGuideBtn'))$('#syncInboxGuideBtn').textContent=myGmailConnection()?'Sync Gmail now':'Sync with ChatGPT';
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
 ${(()=>{const a=approvalForDraft(d.id,'approved');const approved=a&&approvalMatchesDraft(a,d);const native=!!myGmailConnection()&&!!actor?.authenticated;const label=actor?.authenticated===true?(native?'Send via Gmail':'Send with ChatGPT'):(approved?(native?'Send approved':'Send approved with ChatGPT'):'Request approval');const help=actor?.authenticated===true?(native?'This will send through your connected Gmail and write the real Gmail message ID back to Sales OS.':'Gmail is not connected directly; the approved send will use the ChatGPT/Gmail fallback.'):(approved?'A named Sales OS member approved this exact draft.':'Shared access cannot send protected email without approval from a named Sales OS member.');return `<div class="pageactions"><button class="btn" id="saveDraftBtn">Save</button><button class="btn" id="copyDraftBtn">Copy</button><button class="btn green" id="directSendBtn">${label}</button></div><p class="meta" style="margin-top:10px">${help}</p>`})()}`;
 $('#saveDraftBtn').onclick=saveCurrentDraft;$('#copyDraftBtn').onclick=async()=>{await navigator.clipboard.writeText($('#edBody').value);toast('Copied')};$('#aiDraftBtn').onclick=()=>openAIWriter(d.prospect_id);$('#directSendBtn').onclick=()=>handleDirectSend(d.id);
}
window.openDraft=id=>{currentDraft=data.email_drafts.find(d=>d.id===id);renderEmail();if(window.matchMedia('(max-width:760px)').matches)setTimeout(()=>$('#emailEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),60)};
function renderAssets(){
 const queue=[...data.asset_work_requests].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
 const open=queue.filter(j=>['queued','in_progress','ready_for_review'].includes(j.status));
 if($('#ahamedQueueSummary'))$('#ahamedQueueSummary').textContent=`${open.length} active · ${queue.filter(j=>j.status==='ready_for_review').length} ready for review`;
 if($('#ahamedQueue')){
   $('#ahamedQueue').innerHTML=open.length?open.map(j=>`<div class="asset-build-row" onclick="openAssetJob('${j.id}')">
     <div class="maincopy"><div class="title">${esc(j.title||j.request_text||'Asset build')}</div><div class="meta">${esc(prospectName(j.prospect_id)||'Unknown prospect')} · ${esc((j.assigned_to||'Ahamed'))} · ${esc(j.priority||'normal')}</div></div>
     <span class="pill ${j.status==='ready_for_review'?'amber':j.status==='in_progress'?'blue':''}">${esc(j.status.replaceAll('_',' '))}</span>
   </div>`).join(''):'<div class="empty">No active Ahamed asset jobs.</div>';
 }
 $('#assetGrid').innerHTML=data.assets.length?data.assets.map(a=>`<article class="assetcard"><span class="pill">${esc(a.asset_type)}</span><h3 style="font-size:13px;margin:9px 0 4px">${esc(a.title)}</h3><p>${esc(prospectName(a.prospect_id)||'Unlinked')} · ${esc(a.status||'')}</p><div class="assetactions">${a.url?`<a class="btn" href="${esc(a.url)}" target="_blank">Open ↗</a>`:''}<button class="btn" onclick="editAsset('${a.id}')">Edit</button></div></article>`).join(''):'<div class="empty">No assets.</div>';
}

function renderProspectAssetJobs(id){
 if(!$('#pdAssetJobs'))return;
 const jobs=pAssetJobs(id);
 $('#pdAssetJobs').innerHTML=jobs.length?jobs.map(j=>`<div class="focusrow" onclick="openAssetJob('${j.id}')"><div class="maincopy"><div class="title">${esc(j.title||j.request_text||'Asset build')}</div><div class="meta">Ahamed · ${esc(j.status.replaceAll('_',' '))}${j.due_at?' · due '+new Date(j.due_at).toLocaleDateString():''}</div></div><span class="pill ${j.status==='ready_for_review'?'amber':j.status==='approved'?'green':''}">${esc(j.priority||'normal')}</span></div>`).join(''):'<div class="meta">No asset request assigned to Ahamed yet.</div>';
}
function openAhamedRequest(prospectId){
 const p=data.prospects.find(x=>x.id===prospectId);if(!p)return;
 const autoResearch=[p.notes,...(p.source_notes||[])].filter(Boolean).join('\n\n');
 modal('Send asset request to Ahamed',`<div class="ai-box"><h3>${esc(p.company)}</h3><p>Ahamed will receive a scoped snapshot of this prospect's research, sources, notes and existing assets — not the rest of Sales OS.</p></div>
 <div class="field" style="margin-top:12px"><label>Job title</label><input id="ajTitle" class="input" value="${esc('Build prospect asset for '+p.company)}"></div>
 <div class="formgrid2"><div class="field"><label>Work type</label><select id="ajType" class="select"><option value="build">New build</option><option value="edit">Edit existing asset</option><option value="images">Images / renders</option><option value="proposal">Proposal</option><option value="research">Research asset</option></select></div><div class="field"><label>Priority</label><select id="ajPriority" class="select"><option>normal</option><option>high</option><option>urgent</option><option>low</option></select></div></div>
 <div class="field"><label>What Ahamed should make</label><textarea id="ajRequest" class="textarea" rows="7" placeholder="Describe exactly what to build, what the prospect should see, mobile requirements, references, etc."></textarea></div>
 <div class="field"><label>Extra build brief</label><textarea id="ajBrief" class="textarea" rows="5" placeholder="Brand direction, CTA, must-use copy, products, references…">${esc(autoResearch.slice(0,1800))}</textarea></div>
 <div class="field"><label>Due date</label><input id="ajDue" class="input" type="datetime-local"></div>
 <button id="assignAhamedConfirm" class="btn primary">Assign to Ahamed</button>`);
 $('#assignAhamedConfirm').onclick=async()=>{
   const request=$('#ajRequest').value.trim();if(!request)return toast('Describe what Ahamed should build');
   try{
     await rpc('sales_os_assign_asset_job',{p_token:token||null,p_payload:{
       prospect_id:p.id,builder_slug:'ahamed',title:$('#ajTitle').value.trim(),request_text:request,work_type:$('#ajType').value,
       priority:$('#ajPriority').value,due_at:$('#ajDue').value?new Date($('#ajDue').value).toISOString():null,
       deliverable_types:['preview_url','deployment_url','repository_url'],
       brief_json:{build_brief:$('#ajBrief').value.trim(),requested_from:'Sales OS',company:p.company,category:p.category}
     }});
     closeModal();toast('Sent to Ahamed');await load();openProspect(p.id);
   }catch(e){toast('Could not assign: '+String(e.message||e))}
 };
}
window.openAhamedRequest=openAhamedRequest;

window.openAssetJob=id=>{
 const j=data.asset_work_requests.find(x=>x.id===id);if(!j)return;
 const ds=jobDeliverables(id),ns=jobNotes(id),company=prospectName(j.prospect_id)||'Prospect';
 modal('Asset job · '+company,`<div class="panelhead"><div><h2 style="margin:0">${esc(j.title||j.request_text||'Asset job')}</h2><small>Ahamed · ${esc(j.status.replaceAll('_',' '))}</small></div><span class="pill ${j.status==='ready_for_review'?'amber':j.status==='approved'?'green':''}">${esc(j.priority||'normal')}</span></div>
 <div class="thread-context"><div class="meta"><b>Request</b><br>${esc(j.request_text||'')}${j.due_at?'<br><br><b>Due:</b> '+new Date(j.due_at).toLocaleString():''}</div></div>
 <div class="section"><h3>Deliverables</h3>${ds.length?ds.map(d=>`<div class="focusrow"><div class="maincopy"><div class="title">${esc(d.title)}</div><div class="meta">${esc(d.version_label||d.kind||'link')}${d.notes?' · '+esc(d.notes):''}</div></div><a class="btn" target="_blank" href="${esc(d.deployment_url||d.url||'#')}">Open ↗</a></div>`).join(''):'<div class="meta">Nothing submitted yet.</div>'}</div>
 <div class="section"><h3>Conversation</h3>${ns.length?ns.map(n=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(n.author_name||n.author_type)}</div><div class="meta">${esc(n.body)} · ${new Date(n.created_at).toLocaleString()}</div></div></div>`).join(''):'<div class="meta">No notes yet.</div>'}</div>
 ${j.status==='ready_for_review'?'<div class="section"><h3>Review</h3><div class="field"><label>Review note</label><textarea id="assetReviewNote" class="textarea" rows="4"></textarea></div><div class="pageactions"><button id="approveAssetJob" class="btn green">Approve asset</button><button id="changeAssetJob" class="btn">Request changes</button></div></div>':''}`);
 if($('#approveAssetJob'))$('#approveAssetJob').onclick=()=>reviewAssetJob(id,'approved');
 if($('#changeAssetJob'))$('#changeAssetJob').onclick=()=>reviewAssetJob(id,'changes_requested');
};
async function reviewAssetJob(id,decision){
 try{
   await rpc('sales_os_review_asset_job',{p_token:token||null,p_job_id:id,p_decision:decision,p_notes:$('#assetReviewNote')?.value||''});
   closeModal();toast(decision==='approved'?'Asset approved':'Changes sent to Ahamed');await load();
 }catch(e){toast('Review failed: '+String(e.message||e))}
}
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
const COPILOT_URL=SUPABASE_URL+'/functions/v1/sales-os-copilot';
async function copilotFetch(payload={}){
 const headers={'Content-Type':'application/json',apikey:APIKEY};
 if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;
 else if(token)headers['x-sales-os-access-code']=token;
 const r=await fetch(COPILOT_URL,{method:'POST',headers,body:JSON.stringify(payload)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Object.assign(new Error(d.detail||d.error||'Copilot request failed'),{payload:d,status:r.status});
 return d;
}
async function refreshAIStatus(){
 try{
  const d=await copilotFetch({action:'status'});
  providerStatus.ai=!!(d.connected&&d.api_ok);
  return d;
 }catch(e){providerStatus.ai=false;return {connected:false,api_ok:false}}
}
function copilotQuickPrompts(){
 return copilotProspectId?[
  'Summarize this account and tell me what matters.',
  'Draft the best next follow-up email.',
  'What should happen next on this account?',
  'What risks or missing information should I notice?'
 ]:[
  'What needs my attention today?',
  'Which prospects are stalled and why?',
  'Find high-priority prospects with assets but no recent outreach.',
  'Give me a concise sales command brief.'
 ];
}
async function openCopilot(prospectId=null,preset=''){
 copilotProspectId=prospectId||null;copilotLocal=[];
 const existing=data.copilot_threads.filter(t=>(t.prospect_id||null)===(copilotProspectId||null)).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at))[0];
 copilotThreadId=existing?.id||null;
 const p=data.prospects.find(x=>x.id===copilotProspectId);
 $('#copilotTitle').textContent=p?('Copilot · '+p.company):'Sales Copilot';
 $('#copilotContext').textContent=p?([p.category,p.stage,p.owner_assigned].filter(Boolean).join(' · ')):'Live Sales OS workspace';
 $('#copilotQuick').innerHTML=copilotQuickPrompts().map(q=>`<button data-copilot-prompt="${esc(q)}">${esc(q)}</button>`).join('');
 document.querySelectorAll('[data-copilot-prompt]').forEach(b=>b.onclick=()=>{ $('#copilotInput').value=b.dataset.copilotPrompt; sendCopilot(); });
 $('#copilotDrawer').classList.remove('hidden');lockPage();
 const status=await refreshAIStatus();
 renderCopilotProvider(status);
 if(copilotThreadId&&providerStatus.ai){
  try{
   const hist=await copilotFetch({action:'history',thread_id:copilotThreadId});
   copilotLocal=(hist.messages||[]).map(m=>({role:m.role,content:m.content,structured:m.structured||{}}));
  }catch(e){}
 }
 renderCopilotMessages();
 if(preset){$('#copilotInput').value=preset;if(providerStatus.ai)setTimeout(sendCopilot,50)}
}
window.openCopilot=openCopilot;
function closeCopilot(){
 $('#copilotDrawer').classList.add('hidden');
 if(isPhone()||($('#genericModal').classList.contains('hidden')&&$('#prospectDrawer').classList.contains('hidden')))unlockPage();
}
function renderCopilotProvider(status={connected:providerStatus.ai,api_ok:providerStatus.ai}){
 const el=$('#copilotProviderBanner');if(!el)return;
 if(status.connected&&status.api_ok){el.classList.add('hidden');return}
 el.classList.remove('hidden');
 if(actor?.authenticated===true){
  el.innerHTML=`<b>Morpheus AI needs one provider connection.</b><br>The Copilot UI and context engine are ready. Connect an OpenAI API key once; it will be stored server-side in Supabase Vault.<div style="margin-top:8px"><button class="btn primary" id="connectAiFromCopilot">Connect AI provider</button></div>`;
  $('#connectAiFromCopilot').onclick=openAIProviderSetup;
 }else{
  el.innerHTML='<b>AI provider not connected.</b><br>A named Sales OS member needs to connect the OpenAI API provider from Connections. No API key is stored in this browser.';
 }
}
function renderCopilotMessages(){
 const box=$('#copilotMessages');if(!box)return;
 box.innerHTML=copilotLocal.length?copilotLocal.map((m,i)=>{
  let suggestions='';
  if(m.role==='assistant'&&m.structured){
    const st=m.structured;
    if(st.draft)suggestions+=`<div class="copilot-suggestion"><b>Email draft</b><p>${esc(st.draft.subject||'')}<br>${esc((st.draft.body||'').slice(0,260))}${(st.draft.body||'').length>260?'…':''}</p><button class="btn" onclick="saveCopilotSuggestion(${i},'draft')">Save draft</button></div>`;
    if(st.next_action)suggestions+=`<div class="copilot-suggestion"><b>Next action</b><p>${esc(st.next_action.text||'')}${st.next_action.date?' · '+esc(st.next_action.date):''}</p><button class="btn" onclick="saveCopilotSuggestion(${i},'next_action')">Set next action</button></div>`;
    if(st.reminder)suggestions+=`<div class="copilot-suggestion"><b>Reminder</b><p>${esc(st.reminder.title||'')}${st.reminder.due_at?' · '+esc(st.reminder.due_at):''}</p><button class="btn" onclick="saveCopilotSuggestion(${i},'reminder')">Create reminder</button></div>`;
    if(st.note)suggestions+=`<div class="copilot-suggestion"><b>Note</b><p>${esc(st.note.title||'')} · ${esc((st.note.body||'').slice(0,220))}</p><button class="btn" onclick="saveCopilotSuggestion(${i},'note')">Save note</button></div>`;
  }
  return `<div class="copilot-msg ${m.role==='user'?'user':'assistant'}">${esc(m.content||'')}${suggestions}</div>`;
 }).join(''):'<div class="empty">Ask something about the live CRM. Copilot uses the account, assets, email history, notes, reminders and opportunity context.</div>';
 box.scrollTop=box.scrollHeight;
}
async function sendCopilot(){
 const input=$('#copilotInput');const message=input.value.trim();if(!message)return;
 if(!providerStatus.ai){renderCopilotProvider({connected:false,api_ok:false});return toast('Connect the AI provider first')}
 input.value='';copilotLocal.push({role:'user',content:message,structured:{}});renderCopilotMessages();
 $('#copilotSend').disabled=true;$('#copilotSend').textContent='Thinking…';
 try{
  const d=await copilotFetch({message,prospect_id:copilotProspectId,thread_id:copilotThreadId});
  copilotThreadId=d.thread_id||copilotThreadId;
  copilotLocal.push({role:'assistant',content:d.answer||'',structured:d.structured||{}});
  renderCopilotMessages();
  if(!data.copilot_threads.some(t=>t.id===copilotThreadId))data.copilot_threads.unshift({id:copilotThreadId,prospect_id:copilotProspectId,updated_at:new Date().toISOString()});
 }catch(e){
  copilotLocal.push({role:'assistant',content:'Copilot error: '+String(e.message||e),structured:{}});
  renderCopilotMessages();
 }finally{$('#copilotSend').disabled=false;$('#copilotSend').textContent='Ask Copilot'}
}
window.sendCopilot=sendCopilot;
window.saveCopilotSuggestion=async(i,type)=>{
 const st=copilotLocal[i]?.structured||{},p=data.prospects.find(x=>x.id===copilotProspectId);
 if(!p&&['draft','next_action','reminder','note'].includes(type))return toast('Open Copilot from a prospect account for this action');
 try{
  if(type==='draft'&&st.draft){
    await rpc('sales_os_save_email_draft',{p_token:token||null,p_payload:{
      prospect_id:p.id,recipient:p.contact_email||'',sender_name:p.sender_name||actor?.display_name||'',
      sender_email:p.sender_email||actor?.email||'',subject:st.draft.subject||'',body:st.draft.body||'',status:'draft',
      ai_assisted:true,provider:'native_copilot',created_by:actor?.display_name||'Sales Copilot'
    }});toast('AI draft saved to Email workspace')
  }
  if(type==='next_action'&&st.next_action){
    await rpc('sales_os_save_prospect',{p_token:token||null,p_payload:{id:p.id,next_action:st.next_action.text||'',next_action_date:st.next_action.date||null}});
    toast('Next action updated')
  }
  if(type==='reminder'&&st.reminder){
    const due=st.reminder.due_at||new Date(Date.now()+86400000).toISOString();
    await rpc('sales_os_save_reminder',{p_token:token||null,p_payload:{prospect_id:p.id,title:st.reminder.title||'Sales follow-up',due_at:due,owner_assigned:p.owner_assigned||actor?.display_name||'',priority:'normal',status:'open',notify_in_app:true,created_by:actor?.display_name||'Sales Copilot'}});
    toast('Reminder created')
  }
  if(type==='note'&&st.note){
    await rpc('sales_os_save_note',{p_token:token||null,p_payload:{prospect_id:p.id,title:st.note.title||'Copilot note',body:st.note.body||'',pinned:false,created_by:actor?.display_name||'Sales Copilot'}});
    toast('Note saved')
  }
  await load();
 }catch(e){toast('Could not save suggestion: '+String(e.message||e))}
};
function openAIProviderSetup(){
 if(!actor?.authenticated)return toast('Named member sign-in required to connect an AI provider');
 modal('Connect Morpheus AI',`<div class="ai-box"><h3>OpenAI API provider</h3><p>The API key is sent directly to Supabase and stored encrypted in Vault. It is never written into the website source or local storage.</p></div><div class="provider-connect"><div class="field"><label>OpenAI API key</label><input id="openaiKeyInput" type="password" class="input" autocomplete="off" placeholder="sk-…"></div><button id="saveOpenAIKey" class="btn primary">Connect & verify</button><div id="openaiKeyStatus" class="meta"></div></div>`);
 $('#saveOpenAIKey').onclick=async()=>{
  const key=$('#openaiKeyInput').value.trim();if(key.length<20)return toast('Paste the complete API key');
  $('#saveOpenAIKey').disabled=true;$('#openaiKeyStatus').textContent='Saving securely…';
  try{
   await rpc('sales_os_store_secret',{p_token:token||null,p_name:'sales_os_openai_api_key',p_secret:key});
   $('#openaiKeyInput').value='';
   const status=await refreshAIStatus();
   if(!status.api_ok)throw new Error('The key was stored but OpenAI rejected it. Check the key/billing.');
   await rpc('sales_os_update_connection',{p_token:token||null,p_key:'ai',p_payload:{status:'connected',account_label:'OpenAI API',metadata:{model:status.model||'gpt-5.6-luna'}}}).catch(()=>{});
   providerStatus.ai=true;closeModal();toast('Morpheus AI connected');await load();if(!$('#copilotDrawer').classList.contains('hidden'))renderCopilotProvider(status);
  }catch(e){$('#openaiKeyStatus').textContent=String(e.message||e)}
  finally{$('#saveOpenAIKey').disabled=false}
 };
}
function myGmailConnection(){
 const email=String(actor?.email||'').toLowerCase();
 return data.gmail_connections.find(c=>String(c.member_email||'').toLowerCase()===email&&c.active)||null;
}
function renderConnections(){
 if(!$('#connectionsGrid'))return;
 const gmail=myGmailConnection();
 $('#connectionsGrid').innerHTML=data.connections.map(c=>{
   let status=c.status||'setup_required',desc='',button='Set up';
   if(c.key==='ai'){
     status=providerStatus.ai?'connected':'provider_required';
     desc=providerStatus.ai?'Native Morpheus Sales Copilot is connected to the OpenAI API and runs with live CRM context.':'Connect an OpenAI API key once to activate the native in-dashboard Copilot. The key is stored server-side in Supabase Vault.';
     button=providerStatus.ai?'Manage AI':'Connect AI';
   }else if(c.key==='chatgpt'){
     desc='Connect Sales OS to ChatGPT as a private MCP app so ChatGPT can work directly with prospects, assets, reminders, approvals and inbox state.';
   }else if(c.key==='gmail'){
     if(gmail){
       status=gmail.last_sync_status==='error'?'needs_attention':'connected';
       desc=`Gmail ${gmail.google_email||gmail.member_email} is connected directly. Prospect messages sync hourly${gmail.last_sync_at?' · last sync '+new Date(gmail.last_sync_at).toLocaleString():''}.`;
       button='Manage Gmail';
     }else{
       status=actor?.authenticated?'not_connected':'member_sign_in_required';
       desc=actor?.authenticated?'Connect your Gmail once for automatic prospect-thread sync. Only messages matching prospect email addresses are stored in Sales OS.':'Sign in as a named Sales OS member before connecting a personal Gmail mailbox.';
       button=actor?.authenticated?'Connect Gmail':'Member sign-in required';
     }
   }
   return `<article class="connection"><div class="panelhead"><h3>${esc(c.label)}</h3><span class="pill ${status==='connected'?'green':'amber'}">${esc(status.replaceAll('_',' '))}</span></div><p>${esc(desc)}</p><button class="btn ${status==='connected'?'':'primary'}" onclick="openConnection('${c.key}')">${esc(button)}</button></article>`;
 }).join('');
}
function renderIdentity(){
 const a=actor||data.actor||{display_name:'Shared'};
 const name=a.display_name||a.email||'Shared';
 if($('#identityName'))$('#identityName').textContent=name;
 if($('#identityRole'))$('#identityRole').textContent=a.authenticated?'Sales OS member':'Shared access';
 if($('#identityInitial'))$('#identityInitial').textContent=(name.trim().charAt(0)||'?').toUpperCase();
 if($('#sideIdentity'))$('#sideIdentity').innerHTML=`<b>${esc(name)}</b><span>${esc(a.authenticated?'Sales OS member · full access':'Shared fallback · protected actions require member review')}</span>`;
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
 const owner=(actor?.authenticated===true);
 $('#approvalList').innerHTML=pending.length?pending.map(a=>`<div class="approval-card">
   <div class="approval-main">
    <div class="title">${esc(a.title)}</div>
    <div class="meta">${esc(prospectName(a.prospect_id)||'General')} · requested by ${esc(a.requested_by_name||a.requested_by_email||'Shared access')} · ${new Date(a.requested_at).toLocaleString()}</div>
    ${a.description?`<p>${esc(a.description)}</p>`:''}
    ${a.item_type==='email_send'?`<div class="approval-email"><b>To:</b> ${esc(a.payload?.recipient||'')}<br><b>Subject:</b> ${esc(a.payload?.subject||'')}<div class="approval-body">${esc(a.payload?.body||'')}</div></div>`:''}
   </div>
   <div class="approval-actions">${owner?`<button class="btn green" onclick="reviewApproval('${a.id}','approved')">Approve</button><button class="btn" onclick="reviewApproval('${a.id}','changes_requested')">Changes</button><button class="btn danger" onclick="reviewApproval('${a.id}','rejected')">Reject</button>`:'<span class="pill amber">Waiting for member review</span>'}</div>
  </div>`).join(''):'<div class="empty">No pending approvals.</div>';
 $('#approvalHistory').innerHTML=history.length?history.map(a=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(a.title)}</div><div class="meta">${esc(a.status.replaceAll('_',' '))} · ${esc(a.reviewer_name||a.requested_by_name||'')} · ${new Date(a.reviewed_at||a.updated_at).toLocaleString()}</div>${a.review_note?`<div class="sub">${esc(a.review_note)}</div>`:''}</div></div>`).join(''):'<div class="empty">No approval history yet.</div>';
 $('#auditList').innerHTML=data.audit_log.slice(0,50).map(x=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(x.summary||x.action)}</div><div class="meta">${esc(x.actor_name||'System')} · ${esc(x.actor_role||'system')} · ${new Date(x.created_at).toLocaleString()}</div></div></div>`).join('')||'<div class="empty">No audit entries yet.</div>';
}
window.reviewApproval=async(id,decision)=>{
 if(!actor?.authenticated){toast('Named member sign-in required');return}
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

function go(page){currentPage=page;if(isPhone())unlockPage();document.querySelectorAll('[data-page-view]').forEach(s=>s.classList.toggle('hidden',s.dataset.pageView!==page));document.querySelectorAll('.navitem[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));document.querySelectorAll('[data-mobile-page]').forEach(b=>b.classList.toggle('active',b.dataset.mobilePage===page));if($('#mobileMoreBtn'))$('#mobileMoreBtn').classList.toggle('active',['pipeline','email','reminders','assets','notes','categories','approvals','connections'].includes(page));$('#noticeMenu').classList.add('hidden');closeMobileMore();if(page==='prospects')renderProspects();if(page==='inbox')renderInbox();if(page==='email')renderEmail();if(isPhone())requestAnimationFrame(()=>window.scrollTo(0,0))}
function modal(title,body){$('#genericModalCard').innerHTML=`<div class="modalhead"><h2>${esc(title)}</h2><button class="close" onclick="closeModal()">×</button></div>${body}`;$('#genericModal').classList.remove('hidden');lockPage()}
window.closeModal=()=>{$('#genericModal').classList.add('hidden');unlockPage()};

window.openProspect=id=>{
 selectedProspect=data.prospects.find(p=>p.id===id);if(!selectedProspect)return;const p=selectedProspect;
 $('#pdCompany').textContent=p.company;$('#pdCategory').textContent=p.category||'General';$('#pdMeta').textContent=[p.segment,p.location].filter(Boolean).join(' · ');
 $('#pdCategorySelect').innerHTML=categoryNames().map(x=>`<option>${esc(x)}</option>`).join('');$('#pdCategorySelect').value=p.category||'';$('#pdStage').innerHTML=STAGES.map(x=>`<option>${x}</option>`).join('');$('#pdStage').value=p.stage||'Research';
 $('#pdOwner').value=p.owner_assigned||'';$('#pdPriority').value=p.priority||'';$('#pdContact').value=p.contact_name||'';$('#pdEmail').value=p.contact_email||'';$('#pdWebsite').value=p.website||'';$('#pdLocation').value=p.location||'';$('#pdNextAction').value=p.next_action||'';$('#pdNextDate').value=p.next_action_date||'';
 $('#pdAssets').innerHTML=pAssets(id).map(a=>`<div class="focusrow"><div class="maincopy"><div class="title">${esc(a.title)}</div><div class="meta">${esc(a.asset_type)} · ${esc(a.status)}</div></div><button class="btn" onclick="editAsset('${a.id}')">Edit</button></div>`).join('')||'<div class="meta">No assets yet.</div>';
 renderProspectAssetJobs(id);
 $('#pdNotes').innerHTML=pNotes(id).map(n=>`<div class="noterow"><div><div class="title">${esc(n.title||'Note')}</div><div class="meta">${esc((n.body||'').slice(0,140))}</div></div></div>`).join('')||'<div class="meta">No notes yet.</div>';
 $('#pdReminders').innerHTML=pReminders(id).filter(r=>r.status==='open').map(r=>`<div class="reminderrow"><div class="maincopy"><div class="title">${esc(r.title)}</div><div class="meta">${new Date(r.due_at).toLocaleString()}</div></div></div>`).join('')||'<div class="meta">No open reminders.</div>';
 const opp=pOpportunity(id);if($('#pdOppValue'))$('#pdOppValue').value=opp?.estimated_value||'';if($('#pdOppKg'))$('#pdOppKg').value=opp?.monthly_volume_kg||'';if($('#pdOppProb'))$('#pdOppProb').value=opp?.probability_pct||'';if($('#pdOppNotes'))$('#pdOppNotes').value=opp?.commercial_notes||'';
 $('#pdActivity').innerHTML=pActivities(id).slice(0,20).map(a=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(a.activity_type||'Activity')}</div><div class="meta">${esc(a.subject||a.outcome||'')} · ${new Date(a.occurred_at).toLocaleDateString()}</div></div></div>`).join('')||'<div class="meta">No activity yet.</div>';
 $('#prospectDrawer').classList.remove('hidden');lockPage();
};
async function saveProspect(){const p=selectedProspect;if(!p)return;await rpc('sales_os_save_prospect',{p_token:token,p_payload:{id:p.id,category:$('#pdCategorySelect').value,stage:$('#pdStage').value,owner_assigned:$('#pdOwner').value,priority:$('#pdPriority').value,contact_name:$('#pdContact').value,contact_email:$('#pdEmail').value,website:$('#pdWebsite').value,location:$('#pdLocation').value,next_action:$('#pdNextAction').value,next_action_date:$('#pdNextDate').value}});toast('Account updated');await load();openProspect(p.id)}
async function saveOpportunity(){
 const p=selectedProspect;if(!p)return;
 await rpc('sales_os_save_opportunity',{p_token:token,p_payload:{prospect_id:p.id,estimated_value:$('#pdOppValue').value,monthly_volume_kg:$('#pdOppKg').value,probability_pct:$('#pdOppProb').value,commercial_notes:$('#pdOppNotes').value,currency:'USD',updated_by:'Sales OS'}});
 toast('Opportunity updated');await load();openProspect(p.id);
}

function openProspectForm(){modal('Add prospect',`<div class="formgrid2"><div class="field"><label>Company</label><input id="npCompany" class="input"></div><div class="field"><label>Category</label><select id="npCategory" class="select">${categoryNames().map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div class="field"><label>Contact</label><input id="npContact" class="input"></div><div class="field"><label>Email</label><input id="npEmail" class="input"></div><div class="field"><label>Website</label><input id="npWebsite" class="input"></div><div class="field"><label>Assigned to</label><input id="npOwner" class="input" value="Yazeed"></div></div><button id="createProspectConfirm" class="btn primary">Create prospect</button>`);$('#createProspectConfirm').onclick=async()=>{const company=$('#npCompany').value.trim();if(!company)return toast('Company required');await rpc('sales_os_save_prospect',{p_token:token,p_payload:{company,category:$('#npCategory').value||'General',contact_name:$('#npContact').value,contact_email:$('#npEmail').value,website:$('#npWebsite').value,owner_assigned:$('#npOwner').value||'Yazeed',stage:'Research',status:'Not started',next_action:'Review and qualify'}});closeModal();toast('Prospect added');await load()}}

function openNoteForm(prospectId=null,note=null){modal(note?'Edit note':'New note',`<div class="field"><label>Title</label><input id="noteTitle" class="input" value="${esc(note?.title||'')}"></div><div class="field"><label>Note</label><textarea id="noteBody" class="textarea" rows="9">${esc(note?.body||'')}</textarea></div><label style="font-size:10px"><input id="notePinned" type="checkbox" ${note?.pinned?'checked':''}> Pin note</label><div style="margin-top:12px"><button id="saveNoteConfirm" class="btn primary">Save note</button></div>`);$('#saveNoteConfirm').onclick=async()=>{await rpc('sales_os_save_note',{p_token:token,p_payload:{id:note?.id,prospect_id:prospectId||note?.prospect_id,title:$('#noteTitle').value,body:$('#noteBody').value,pinned:$('#notePinned').checked,created_by:'Sales OS'}});closeModal();toast('Note saved');await load();if(prospectId)openProspect(prospectId)}}
window.editNote=id=>{const n=data.notes.find(x=>x.id===id);if(n)openNoteForm(n.prospect_id,n)};

function openReminderForm(prospectId=null,r=null){modal(r?'Edit reminder':'New reminder',`<div class="field"><label>Reminder</label><input id="remTitle" class="input" value="${esc(r?.title||'')}"></div><div class="field"><label>When</label><input id="remDue" type="datetime-local" class="input" value="${esc(dateTimeLocal(r?.due_at)||dateTimeLocal(new Date(Date.now()+86400000)))}"></div><div class="formgrid2"><div class="field"><label>Assigned to</label><input id="remOwner" class="input" value="${esc(r?.owner_assigned||'Yazeed')}"></div><div class="field"><label>Priority</label><select id="remPriority" class="select"><option>normal</option><option>high</option><option>low</option></select></div></div><div class="field"><label>Details</label><textarea id="remBody" class="textarea">${esc(r?.body||'')}</textarea></div><button id="saveReminderConfirm" class="btn primary">Save reminder</button>`);$('#saveReminderConfirm').onclick=async()=>{await rpc('sales_os_save_reminder',{p_token:token,p_payload:{id:r?.id,prospect_id:prospectId||r?.prospect_id,title:$('#remTitle').value,due_at:new Date($('#remDue').value).toISOString(),owner_assigned:$('#remOwner').value,priority:$('#remPriority').value,body:$('#remBody').value,status:r?.status||'open',notify_in_app:true,created_by:'Sales OS'}});closeModal();toast('Reminder saved');await load();if(prospectId)openProspect(prospectId)}}
window.completeReminder=async id=>{await rpc('sales_os_save_reminder',{p_token:token,p_payload:{id,status:'completed'}});toast('Reminder completed');await load()};

function openAssetForm(prospectId=null,a=null){modal(a?'Edit asset':'New asset',`<div class="field"><label>Prospect</label><select id="assetProspect" class="select">${data.prospects.map(p=>`<option value="${p.id}">${esc(p.company)}</option>`).join('')}</select></div><div class="formgrid2"><div class="field"><label>Type</label><select id="assetType" class="select"><option>Website</option><option>Proposal</option><option>Images</option><option>Spreadsheet</option><option>Research</option><option>Other</option></select></div><div class="field"><label>Status</label><select id="assetStatus" class="select"><option>Built</option><option>Draft</option><option>Needs QA</option><option>Sent</option></select></div></div><div class="field"><label>Title</label><input id="assetTitle" class="input" value="${esc(a?.title||'')}"></div><div class="field"><label>URL</label><input id="assetUrl" class="input" value="${esc(a?.url||'')}"></div><div class="field"><label>Notes</label><textarea id="assetNotes" class="textarea">${esc(a?.notes||'')}</textarea></div><button id="saveAssetConfirm" class="btn primary">Save asset</button>`);$('#assetProspect').value=prospectId||a?.prospect_id||data.prospects[0]?.id||'';if(a){$('#assetType').value=a.asset_type||'Other';$('#assetStatus').value=a.status||'Built'}$('#saveAssetConfirm').onclick=async()=>{await rpc('sales_os_save_asset',{p_token:token,p_payload:{id:a?.id,prospect_id:$('#assetProspect').value,asset_type:$('#assetType').value,status:$('#assetStatus').value,title:$('#assetTitle').value,url:$('#assetUrl').value,notes:$('#assetNotes').value}});closeModal();toast('Asset saved');await load();if(prospectId)openProspect(prospectId)}}
window.editAsset=id=>{const a=data.assets.find(x=>x.id===id);if(a)openAssetForm(a.prospect_id,a)};

function openNewDraft(prospectId=null){modal('New email draft',`<div class="field"><label>Prospect</label><select id="draftProspect" class="select">${data.prospects.map(p=>`<option value="${p.id}">${esc(p.company)}</option>`).join('')}</select></div><div class="field"><label>Subject</label><input id="draftSubject" class="input"></div><div class="field"><label>Message</label><textarea id="draftBody" class="textarea" rows="10"></textarea></div><div class="pageactions"><button id="draftAI" class="btn">AI writing</button><button id="createDraftConfirm" class="btn primary">Save draft</button></div>`);if(prospectId)$('#draftProspect').value=prospectId;$('#draftAI').onclick=()=>openAIWriter($('#draftProspect').value);$('#createDraftConfirm').onclick=async()=>{const p=data.prospects.find(x=>x.id===$('#draftProspect').value);await rpc('sales_os_save_email_draft',{p_token:token,p_payload:{prospect_id:p.id,recipient:p.contact_email||'',sender_name:p.sender_name||'Robert Gibbons',sender_email:p.sender_email||'robert@morpheuspd.io',subject:$('#draftSubject').value,body:$('#draftBody').value,status:'draft',created_by:'Sales OS'}});closeModal();toast('Draft saved');await load();go('email')}}
async function saveCurrentDraft(){const d=currentDraft;if(!d)return;await rpc('sales_os_save_email_draft',{p_token:token,p_payload:{id:d.id,recipient:$('#edTo').value,sender_email:$('#edFrom').value,subject:$('#edSubject').value,body:$('#edBody').value,status:'draft'}});toast('Draft saved');await load()}

function prospectResearchPrompt(p){
 const notes=pNotes(p.id).slice(0,8).map(n=>'- '+(n.title||'Note')+': '+(n.body||'')).join('\n');
 return `Research this real company for Morpheus Sales OS using current public web sources.

COMPANY: ${p.company}
CATEGORY: ${p.category||''}
SEGMENT: ${p.segment||''}
LOCATION IN CRM: ${p.location||''}
WEBSITE IN CRM: ${p.website||''}
KNOWN CONTACT: ${[p.contact_name,p.contact_role,p.contact_email].filter(Boolean).join(' · ')}
CURRENT NOTES:
${notes||p.notes||'None'}

Find and verify:
1. What the company does and who it serves.
2. Relevant products/services and positioning.
3. Public decision makers/contact routes only when actually verified.
4. Why this company may fit Morpheus commercially.
5. The strongest personalized asset we should create for them.
6. 3 useful outreach angles.
7. Any cautions or reasons not to pursue.
8. Source URLs for every important factual claim.

Do not invent names, emails, scale, revenue, buying intent, volumes or claims.
Return a concise research brief I can save into Sales OS.`;
}

function aiWritingPrompt(p){
 const assets=pAssets(p.id).map(a=>'- '+a.asset_type+': '+a.title+(a.url?' — '+a.url:'')).join('\n');
 const notes=pNotes(p.id).slice(0,8).map(n=>'- '+(n.title||'Note')+': '+(n.body||'')).join('\n');
 const emails=pMessages(p.id).slice(-8).map(m=>'- '+m.direction+' · '+(m.subject||'')+': '+(m.snippet||m.body||'')).join('\n');
 return `Write the best concise B2B sales email for this Morpheus Sales OS prospect.

Company: ${p.company}
Category: ${p.category||''}
Contact: ${p.contact_name||''} ${p.contact_role||''}
Stage: ${p.stage||''}
Next action: ${p.next_action||''}

Assets:
${assets||'- None'}

Research / notes:
${notes||p.notes||'- None'}

Recent email context:
${emails||'- None'}

Use only verified context above. Do not invent facts. Keep it natural and short.
Return:
SUBJECT:
BODY:`;
}

async function startProspectResearch(prospectId){
 const p=data.prospects.find(x=>x.id===prospectId);if(!p)return;
 const status=$('#pdResearchStatus');
 if(!providerStatus.ai){
   const prompt=prospectResearchPrompt(p);
   try{await navigator.clipboard.writeText(prompt)}catch(e){}
   window.open('https://chatgpt.com/','_blank');
   if(status)status.textContent='Native AI is not connected. Research prompt copied and ChatGPT opened.';
   toast('Research prompt copied');
   return;
 }
 if(status)status.textContent='Researching current public sources…';
 try{
   const headers={'Content-Type':'application/json',apikey:APIKEY};
   if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;
   else if(token)headers['x-sales-os-access-code']=token;
   const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-prospect-research',{method:'POST',headers,body:JSON.stringify({prospect_id:p.id})});
   const out=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(out.detail||out.error||'Research failed');
   await load();
   const result=out.result||{};
   const sources=Array.isArray(result.source_urls)?result.source_urls:[];
   modal('Research · '+p.company,`<div class="ai-box"><h3>Research saved to Sales OS</h3><p>${esc(result.summary||'Research complete.')}</p></div>
     ${result.fit?`<div class="section"><h3>Why it fits</h3><p class="meta" style="font-size:11px;line-height:1.6">${esc(result.fit)}</p></div>`:''}
     ${result.asset_recommendation?.concept?`<div class="section"><h3>Suggested asset</h3><div class="title">${esc(result.asset_recommendation.type||'Asset')}</div><p class="meta" style="font-size:11px;line-height:1.6">${esc(result.asset_recommendation.concept)}</p></div>`:''}
     ${Array.isArray(result.outreach_angles)&&result.outreach_angles.length?`<div class="section"><h3>Outreach angles</h3>${result.outreach_angles.map(x=>`<div class="focusrow"><div class="title">${esc(x)}</div></div>`).join('')}</div>`:''}
     ${sources.length?`<div class="section"><h3>Sources</h3><div class="source-links">${sources.map(u=>`<a href="${esc(u)}" target="_blank">Source ↗</a>`).join('')}</div></div>`:''}
     <div class="pageactions" style="margin-top:14px"><button id="researchWriteEmail" class="btn primary">AI write email</button><button id="researchSendAhamed" class="btn">Send to Ahamed</button></div>`);
   if($('#researchWriteEmail'))$('#researchWriteEmail').onclick=()=>{closeModal();openAIWriter(p.id)};
   if($('#researchSendAhamed'))$('#researchSendAhamed').onclick=()=>{closeModal();openAhamedRequest(p.id)};
   if(status)status.textContent='Research saved.';
 }catch(e){
   if(status)status.textContent='Research failed: '+String(e.message||e);
   toast('Research failed');
 }
}
window.startProspectResearch=startProspectResearch;

function openAIWriter(prospectId){
 const p=data.prospects.find(x=>x.id===prospectId);if(!p)return;
 if(providerStatus.ai){
   openCopilot(prospectId,'Draft the best concise next sales email for this prospect using the live account context and saved research. Do not invent facts. Return a subject and body.');
 }else{
   const prompt=aiWritingPrompt(p);
   navigator.clipboard.writeText(prompt).catch(()=>{});
   window.open('https://chatgpt.com/','_blank');
   toast('AI writing prompt copied');
 }
}

function discoveryChatGPTPrompt(category,geography,count,criteria){
 return `Find ${count} strong NEW B2B prospects for Morpheus Sales OS.

CATEGORY / MARKET: ${category}
GEOGRAPHY: ${geography||'No restriction'}
EXTRA CRITERIA: ${criteria||'None'}

Research current real companies using public web sources.
For each company provide:
- company
- website
- segment
- location
- public contact name/role/email only if verified
- why it fits
- suggested priority A+, A, B or C
- research score 0-100
- source URLs

Do not invent contacts, emails, revenue, volumes, scale or buying intent.
Deduplicate the results.
Return the final list as a downloadable CSV suitable for Morpheus Sales OS.`;
}

function renderDiscoveryResults(runData){
 const run=runData.run||{},candidates=runData.candidates||[];
 $('#discoveryModalBody').innerHTML=`<div class="panelhead"><div><h2 style="margin:0">${esc(run.category||'Research results')}</h2><small>${candidates.length} candidates</small></div></div>
   <div class="discovery-candidates">${candidates.map(c=>`<article class="discovery-card" data-candidate="${c.id}">
     <div class="discovery-top"><div><h3>${esc(c.company)}</h3><div class="meta">${esc([c.segment,c.location].filter(Boolean).join(' · '))}</div></div><span class="pill ${c.review_status==='duplicate'?'red':''}">${esc(c.review_status)}</span></div>
     <p>${esc(c.why_fit||'')}</p>
     <div class="discovery-meta">${c.suggested_priority?`<span class="pill">${esc(c.suggested_priority)}</span>`:''}${c.score!=null?`<span class="pill blue">Score ${esc(c.score)}</span>`:''}${c.confidence?`<span class="pill">${esc(c.confidence)}</span>`:''}</div>
     <div class="source-links">${(c.source_urls||[]).slice(0,4).map(u=>`<a href="${esc(u)}" target="_blank">Source ↗</a>`).join('')}</div>
     ${c.review_status==='pending'?`<div class="discovery-actions"><button class="btn green" onclick="reviewDiscoveryCandidate('${c.id}','approved','${run.id}')">Add to Sales OS</button><button class="btn" onclick="reviewDiscoveryCandidate('${c.id}','rejected','${run.id}')">Reject</button></div>`:''}
   </article>`).join('')||'<div class="empty">No candidates returned.</div>'}</div>`;
}

async function reviewDiscoveryCandidate(id,decision,runId){
 try{
   await rpc('sales_os_review_discovery_candidate',{p_token:token||null,p_candidate_id:id,p_decision:decision});
   const fresh=await rpc('sales_os_get_discovery_run',{p_token:token||null,p_run_id:runId});
   renderDiscoveryResults(fresh);
   if(decision==='approved')await load();
 }catch(e){toast('Could not review candidate: '+String(e.message||e))}
}
window.reviewDiscoveryCandidate=reviewDiscoveryCandidate;

function openFindProspects(){
 modal('Find new prospects',`<div class="formgrid2"><div class="field"><label>Category / market</label><input id="fpCategory" class="input" placeholder="e.g. Dog Food · Independent Retail"></div><div class="field"><label>Geography</label><input id="fpGeography" class="input" placeholder="e.g. Northeast USA"></div></div>
 <div class="formgrid2"><div class="field"><label>How many</label><select id="fpCount" class="select"><option>10</option><option selected>20</option><option>25</option></select></div><div></div></div>
 <div class="field"><label>Extra criteria</label><textarea id="fpCriteria" class="textarea" rows="4" placeholder="Independent retailers, strong livestock business, avoid national chains…"></textarea></div>
 <div class="pageactions"><button id="fpRun" class="btn primary">✦ Start research</button><button id="fpChatGPT" class="btn">Use ChatGPT instead</button></div>
 <div id="fpStatus" class="meta" style="margin-top:10px"></div>
 <div id="discoveryModalBody" style="margin-top:14px"></div>`);
 const run=async()=>{
   const category=$('#fpCategory').value.trim(),geography=$('#fpGeography').value.trim(),count=Number($('#fpCount').value||20),criteria=$('#fpCriteria').value.trim();
   if(!category)return toast('Enter a category or market');
   if(!providerStatus.ai){
     const prompt=discoveryChatGPTPrompt(category,geography,count,criteria);
     navigator.clipboard.writeText(prompt).catch(()=>{});
     window.open('https://chatgpt.com/','_blank');
     $('#fpStatus').textContent='Native AI is not connected. Prompt copied and ChatGPT opened.';
     return;
   }
   $('#fpRun').disabled=true;$('#fpRun').textContent='Researching…';$('#fpStatus').textContent='Searching current public sources and deduplicating against Sales OS…';
   try{
     const headers={'Content-Type':'application/json',apikey:APIKEY};
     if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken; else if(token)headers['x-sales-os-access-code']=token;
     const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-discovery',{method:'POST',headers,body:JSON.stringify({category,geography,target_count:count,criteria})});
     const out=await r.json().catch(()=>({}));
     if(!r.ok)throw new Error(out.detail||out.error||'Discovery failed');
     const result=await rpc('sales_os_get_discovery_run',{p_token:token||null,p_run_id:out.run_id});
     $('#fpStatus').textContent='Research complete. Review before adding.';
     renderDiscoveryResults(result);
   }catch(e){$('#fpStatus').textContent='Research failed: '+String(e.message||e)}
   finally{$('#fpRun').disabled=false;$('#fpRun').textContent='✦ Start research'}
 };
 $('#fpRun').onclick=run;
 $('#fpChatGPT').onclick=()=>{
   const category=$('#fpCategory').value.trim(),geography=$('#fpGeography').value.trim(),count=Number($('#fpCount').value||20),criteria=$('#fpCriteria').value.trim();
   if(!category)return toast('Enter a category or market');
   navigator.clipboard.writeText(discoveryChatGPTPrompt(category,geography,count,criteria)).catch(()=>{});
   window.open('https://chatgpt.com/','_blank');toast('Prospect research prompt copied');
 };
}

async function sendDraftNative(d){
 if(!sessionAccessToken||!myGmailConnection())throw new Error('Direct Gmail connection required');
 const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-gmail-send',{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:JSON.stringify({draft_id:d.id})});
 const out=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(out.error||out.detail||'Gmail send failed');
 await load();go('inbox');selectedInboxThread=out.thread_id||d.provider_thread_id||selectedInboxThread;renderInbox();toast('Email sent through Gmail');
 return out;
}
async function launchApprovedSend(d,approval=null){
 const p=data.prospects.find(x=>x.id===d.prospect_id);
 const approvalLine=approval?` This draft has Sales OS approval ID ${approval.id}; verify that approval before sending.`:' This send is initiated from an authenticated named Sales OS member session.';
 const prompt=`Use my connected Morpheus Sales OS and Gmail apps.

Open the Sales OS prospect "${p?.company||''}" and find email draft ID ${d.id}.${approvalLine}
Review the exact saved recipient, subject and body. If the approved snapshot no longer matches the current draft, do not send and tell me. Otherwise send that exact draft through my connected Gmail account, then call Sales OS mark_email_sent with the Gmail message ID so the CRM and audit trail stay synchronized.`;
 await navigator.clipboard.writeText(prompt);window.open('https://chatgpt.com/','_blank');toast('Approved send instruction copied');
}
async function handleDirectSend(){
 const d=currentDraft;if(!d)return;
 await saveCurrentDraft();
 const fresh=data.email_drafts.find(x=>x.id===d.id)||d;
 const native=!!myGmailConnection()&&!!actor?.authenticated;
 if(actor?.authenticated===true){
   try{if(native)await sendDraftNative(fresh);else await launchApprovedSend(fresh,null)}catch(e){toast('Send failed: '+String(e.message||e))}
   return;
 }
 const approved=approvalForDraft(fresh.id,'approved');
 if(approved&&approvalMatchesDraft(approved,fresh)){
   try{if(native)await sendDraftNative(fresh);else await launchApprovedSend(fresh,approved)}catch(e){toast('Send failed: '+String(e.message||e))}
   return;
 }
 const pending=approvalForDraft(fresh.id,'pending');
 if(pending&&approvalMatchesDraft(pending,fresh)){go('approvals');toast('Already waiting for member approval');return}
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
 if(key==='ai'){
   if(providerStatus.ai){
     modal('Morpheus AI',`<div class="ai-box"><h3>Native Copilot is connected</h3><p>Sales OS is using the OpenAI API server-side. The API key is stored in Supabase Vault and is not exposed to this browser.</p></div><div style="margin-top:12px"><button id="testNativeCopilot" class="btn primary">Open Copilot</button></div>`);
     $('#testNativeCopilot').onclick=()=>{closeModal();openCopilot()};
   }else openAIProviderSetup();
   return;
 }
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
   const gmail=myGmailConnection();
   if(!actor?.authenticated){
     modal('Connect Gmail',`<div class="ai-box"><h3>Personal member sign-in required</h3><p>Direct Gmail sync is attached to an individual Sales OS member, not the shared team code.</p></div><p class="meta" style="margin-top:10px">Sign out, then use your Sales OS email + team access code to create your personal session.</p>`);
   }else if(gmail){
     modal('Gmail connected',`<div class="ai-box"><h3>${esc(gmail.google_email||gmail.member_email)}</h3><p>Prospect threads synchronize hourly in the background. Only messages that match prospect contact email addresses are imported.</p></div><div class="thread-context" style="margin-top:12px"><div class="meta"><b>Last sync:</b> ${gmail.last_sync_at?new Date(gmail.last_sync_at).toLocaleString():'Not yet'}<br><b>Status:</b> ${esc(gmail.last_sync_status||'connected')}<br>${esc(gmail.last_sync_detail||'')}</div></div><div class="pageactions"><button id="gmailSyncNow" class="btn primary">Sync now</button></div>`);
     $('#gmailSyncNow').onclick=syncGmailNow;
   }else{
     const callback=SUPABASE_URL+'/functions/v1/sales-os-gmail-oauth';
     modal('Connect Gmail',`<div class="ai-box"><h3>Automatic Sales Inbox</h3><p>Authorize Gmail once. Sales OS will then synchronize only email conversations that match prospect contact addresses and keep thread status current automatically.</p></div><div style="margin-top:12px"><button id="connectGmailNative" class="btn primary">Connect my Gmail</button></div><details style="margin-top:12px"><summary class="meta" style="cursor:pointer">Google OAuth callback</summary><div class="codehead" style="margin-top:7px">${esc(callback)}</div><p class="meta">If Google reports redirect_uri_mismatch, this exact URL must be added once to the existing Google OAuth client's Authorized redirect URIs.</p></details>`);
     $('#connectGmailNative').onclick=connectGmailNative;
   }
 }
}
window.openConnection=openConnection;

async function connectGmailNative(){
 if(!actor?.authenticated||!sessionAccessToken)return toast('Personal member sign-in required');
 try{
   const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-gmail-oauth',{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:'{}'});
   const d=await r.json();
   if(!r.ok||!d.authorization_url)throw new Error(d.detail||d.error||'Could not start Gmail authorization');
   location.href=d.authorization_url;
 }catch(e){toast('Gmail connection failed: '+String(e.message||e))}
}
async function syncGmailNow(){
 if(!actor?.authenticated||!sessionAccessToken)return toast('Personal member sign-in required');
 try{
   toast('Synchronizing Gmail…');
   const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-gmail-sync',{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:'{}'});
   const d=await r.json();
   if(!r.ok||d.ok===false)throw new Error(d.connections?.find(x=>!x.ok)?.error||d.error||'Gmail sync failed');
   closeModal();await load();go('inbox');toast('Gmail synchronized');
 }catch(e){toast('Gmail sync failed: '+String(e.message||e))}
}
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

function openMobileMore(){$('#mobileMoreSheet')?.classList.remove('hidden');lockPage()}
function closeMobileMore(){$('#mobileMoreSheet')?.classList.add('hidden');if(isPhone()||($('#genericModal')?.classList.contains('hidden')&&$('#prospectDrawer')?.classList.contains('hidden')))unlockPage()}
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
if($('#copilotBtn'))$('#copilotBtn').onclick=()=>openCopilot();
if($('#pdResearch'))$('#pdResearch').onclick=()=>startProspectResearch(selectedProspect?.id);
if($('#pdAIWrite'))$('#pdAIWrite').onclick=()=>openAIWriter(selectedProspect?.id);
if($('#pdAskAI'))$('#pdAskAI').onclick=()=>openCopilot(selectedProspect?.id||null);
if($('#findProspectsBtn'))$('#findProspectsBtn').onclick=openFindProspects;
if($('#pdCopilot'))$('#pdCopilot').onclick=()=>openCopilot(selectedProspect?.id||null);
if($('#aiAskCopilotBtn'))$('#aiAskCopilotBtn').onclick=()=>openCopilot();
if($('#inboxCopilotBtn'))$('#inboxCopilotBtn').onclick=()=>selectedInboxThread?openInboxCopilot(selectedInboxThread):openCopilot();
if($('#copilotClose'))$('#copilotClose').onclick=closeCopilot;
document.querySelectorAll('[data-close-copilot]').forEach(x=>x.onclick=closeCopilot);
if($('#copilotSend'))$('#copilotSend').onclick=sendCopilot;
if($('#copilotInput'))$('#copilotInput').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')sendCopilot()});
if($('#inboxStatusFilter'))$('#inboxStatusFilter').onchange=renderInbox;
if($('#inboxClassFilter'))$('#inboxClassFilter').onchange=renderInbox;
if($('#syncInboxGuideBtn'))$('#syncInboxGuideBtn').onclick=()=>myGmailConnection()?syncGmailNow():openChatGPTAutopilot('sync');
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
$('#saveProspect').onclick=saveProspect;if($('#saveOpportunity'))$('#saveOpportunity').onclick=saveOpportunity;$('#pdNewAsset').onclick=()=>openAssetForm(selectedProspect?.id);if($('#pdAssignAhamed'))$('#pdAssignAhamed').onclick=()=>openAhamedRequest(selectedProspect?.id);$('#pdNewNote').onclick=()=>openNoteForm(selectedProspect?.id);$('#pdNewReminder').onclick=()=>openReminderForm(selectedProspect?.id);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{const el=$('#'+b.dataset.close);el?.classList.add('hidden');if(b.dataset.close==='prospectDrawer')unlockPage()});$('#genericModal').addEventListener('click',e=>{if(e.target.id==='genericModal')closeModal()});$('#prospectDrawer').addEventListener('click',e=>{if(e.target.id==='prospectDrawer'){e.currentTarget.classList.add('hidden');unlockPage()}});
(async()=>{
 const lastEmail=localStorage.getItem('salesOsMemberEmail');
 if(lastEmail&&$('#memberEmail'))$('#memberEmail').value=lastEmail;
 const memberOk=await tryMemberSession();
 if(memberOk)return;
 const saved=localStorage.getItem('salesOsToken');
 if(saved&&$('#accessCode'))$('#accessCode').value=saved;
})().catch(()=>{});
const gmailResult=new URLSearchParams(location.search).get('gmail');
if(gmailResult==='connected'){
  history.replaceState({},'',location.pathname);
  setTimeout(()=>{toast('Gmail connected');if(actor?.authenticated)syncGmailNow()},700);
}else if(gmailResult==='error'){
  const detail=new URLSearchParams(location.search).get('detail')||'Google authorization failed';
  history.replaceState({},'',location.pathname);
  setTimeout(()=>toast('Gmail: '+detail),700);
}
window.addEventListener('orientationchange',()=>{if(isPhone())unlockPage()});
window.addEventListener('pageshow',()=>{if(isPhone())unlockPage()});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
