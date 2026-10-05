const SUPABASE_URL='https://viajmvbwpmkiqxjtgshv.supabase.co';
const APIKEY='sb_publishable_gGFZftPonWKNZCdvUSM3yQ_gZvyI6_H';
const RPC=SUPABASE_URL+'/rest/v1/rpc/';
const AUTH_BOOTSTRAP=SUPABASE_URL+'/functions/v1/sales-os-auth-bootstrap';
const COPILOT_URL=SUPABASE_URL+'/functions/v1/sales-os-copilot';
const COMMAND_URL=SUPABASE_URL+'/functions/v1/sales-os-command';
const ZOHO_REDIRECT_URI=SUPABASE_URL+'/functions/v1/sales-os-zoho-oauth';
const STAGES=['Research','Asset ready','Ready to contact','Contacted','Follow-up','Replied','Qualified','Meeting','Proposal','Negotiation','Won','Lost','Disqualified','Hold'];
const PIPELINE=['Research','Asset ready','Ready to contact','Contacted','Follow-up','Replied','Qualified','Proposal'];

let token='',sessionAccessToken='',supabaseClient=null,actor=null,currentRoute='command',currentProspect=null,currentDraft=null,currentAssetId=null;
let providerStatus={ai:false};
let todayQueue=[],lastCommandPlan=null;
let data={prospects:[],workflow_state:[],assets:[],asset_versions:[],asset_work_requests:[],asset_deliverables:[],asset_job_notes:[],asset_builders:[],activities:[],templates:[],categories:[],notes:[],research_reports:[],reminders:[],email_drafts:[],notifications:[],connections:[],gmail_connections:[],zoho_connections:[],email_messages:[],inbox_threads:[],recommendations:[],opportunities:[],approvals:[],audit_log:[],members:[],copilot_threads:[]};
let copilotThreadId=null,copilotProspectId=null,copilotLocal=[];

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const safeUrl=u=>{try{const parsed=new URL(String(u||'').trim());return ['http:','https:'].includes(parsed.protocol)?parsed.href:''}catch{return ''}};
const today=()=>new Date().toISOString().slice(0,10);
const prospectName=id=>data.prospects.find(p=>p.id===id)?.company||'';
const pAssets=id=>data.assets.filter(a=>a.prospect_id===id);
const pJobs=id=>data.asset_work_requests.filter(j=>j.prospect_id===id).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
const pNotes=id=>data.notes.filter(n=>n.prospect_id===id).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
const pResearch=id=>data.research_reports.filter(r=>r.prospect_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
const pMessages=id=>data.email_messages.filter(m=>m.prospect_id===id).sort((a,b)=>new Date(a.sent_at)-new Date(b.sent_at));
const pDrafts=id=>data.email_drafts.filter(d=>d.prospect_id===id).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
const pOpportunity=id=>data.opportunities.find(o=>o.prospect_id===id)||null;
const jobDeliverables=id=>data.asset_deliverables.filter(d=>d.work_request_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
const jobNotes=id=>data.asset_job_notes.filter(n=>n.work_request_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
const pActivities=id=>data.activities.filter(a=>a.prospect_id===id).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
const workflowFor=id=>data.workflow_state.find(w=>w.prospect_id===id)||null;
const currentGmail=()=>data.gmail_connections.find(c=>c.active&&String(c.member_email||'').toLowerCase()===String(actor?.email||'').toLowerCase())||null;
const currentZoho=()=>data.zoho_connections.find(c=>c.active&&String(c.member_email||'').toLowerCase()===String(actor?.email||'').toLowerCase())||null;
const mailProviderLabel=provider=>provider==='zoho_mail'?'Zoho Mail':'Gmail';
function draftMailProvider(d=currentDraft){
  const requested=['gmail','zoho_mail'].includes(d?.provider)?d.provider:'';
  if(requested)return requested;
  if(currentGmail())return'gmail';
  if(currentZoho())return'zoho_mail';
  return'gmail';
}
function mailProviderOptions(d=currentDraft){
  const selected=draftMailProvider(d),items=[];
  if(currentGmail()||selected==='gmail')items.push({value:'gmail',label:currentGmail()?'Gmail · '+currentGmail().google_email:'Gmail · not connected'});
  if(currentZoho()||selected==='zoho_mail')items.push({value:'zoho_mail',label:currentZoho()?'Zoho Mail · '+currentZoho().zoho_email:'Zoho Mail · not connected'});
  return items.map(item=>'<option value="'+item.value+'" '+(item.value===selected?'selected':'')+'>'+esc(item.label)+'</option>').join('');
}

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2400)}
function statusClass(s=''){const v=String(s).toLowerCase();if(v.includes('ready')||v.includes('replied')||v.includes('won'))return'lime';if(v.includes('research')||v.includes('contacted'))return'cyan';if(v.includes('review')||v.includes('follow'))return'amber';return''}
function favicon(p){try{const d=new URL(p.website||p.any_asset_url||'');return 'https://www.google.com/s2/favicons?domain='+encodeURIComponent(d.hostname)+'&sz=128'}catch{return''}}
function norm(){for(const k of Object.keys(data))if(!['actor','synced_at'].includes(k)&&!Array.isArray(data[k]))data[k]=[]}

async function rpc(fn,payload={}){
  const headers={apikey:APIKEY,'Content-Type':'application/json'};
  if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;
  const r=await fetch(RPC+fn,{method:'POST',headers,body:JSON.stringify(payload)});
  const txt=await r.text();if(!r.ok)throw new Error(txt||('HTTP '+r.status));return txt?JSON.parse(txt):null;
}
async function ensureSupabase(){
  if(supabaseClient)return supabaseClient;
  const mod=await import('https://esm.sh/@supabase/supabase-js@2');
  supabaseClient=mod.createClient(SUPABASE_URL,APIKEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});supabaseClient.auth.onAuthStateChange((event,session)=>{sessionAccessToken=session?.access_token||''});
  return supabaseClient;
}
async function memberLogin(){
  const email=$('#memberEmail').value.trim(),code=$('#accessCode').value.trim();$('#loginError').textContent='';
  if(!email||!code){$('#loginError').textContent='Choose your profile and enter the access code.';return}
  try{
    localStorage.setItem('salesOsMemberEmail',email);$('#memberLoginBtn').disabled=true;$('#memberLoginBtn').textContent='Opening…';
    const r=await fetch(AUTH_BOOTSTRAP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,access_code:code,return_url:location.origin+'/sales-os-v2/oauth/?mode=app'})});
    const d=await r.json();if(!r.ok||!d.action_link)throw new Error(d.error||d.detail||'Could not sign in');
    const generated=new URL(d.action_link),tokenHash=generated.searchParams.get('token'),type=generated.searchParams.get('type')||'magiclink';
    if(!tokenHash)throw new Error('Sign-in token missing');
    const sb=await ensureSupabase(),verified=await sb.auth.verifyOtp({token_hash:tokenHash,type});
    if(verified.error)throw verified.error;if(!verified.data?.session)throw new Error('Session not created');
    sessionAccessToken=verified.data.session.access_token;token='';actor=await rpc('sales_os_whoami',{p_token:null});
    await load();$('#login').classList.add('hidden');$('#app').classList.remove('hidden');route(location.hash||'#/command',false);
  }catch(e){$('#loginError').textContent=String(e.message||e);$('#memberLoginBtn').disabled=false;$('#memberLoginBtn').textContent='Open Sales OS'}
}
async function sharedLogin(){
  const code=$('#accessCode').value.trim();if(!code)return;
  try{const ok=await rpc('sales_os_verify',{p_token:code});if(!ok)throw new Error('Invalid code');token=code;actor={display_name:'Shared',authenticated:false};localStorage.setItem('salesOsToken',code);await load();$('#login').classList.add('hidden');$('#app').classList.remove('hidden');route('#/command',false)}catch(e){$('#loginError').textContent='Could not open Sales OS.'}
}
async function trySession(){
  try{const sb=await ensureSupabase(),{data:{session}}=await sb.auth.getSession();if(!session)return false;sessionAccessToken=session.access_token;actor=await rpc('sales_os_whoami',{p_token:null});await load();$('#login').classList.add('hidden');$('#app').classList.remove('hidden');return true}catch{return false}
}
async function signOut(){
  localStorage.removeItem('salesOsToken');localStorage.removeItem('salesOsMemberEmail');try{const sb=await ensureSupabase();await sb.auth.signOut()}catch{}location.href=location.pathname;
}

async function refreshAI(){
  try{const headers={'Content-Type':'application/json',apikey:APIKEY};if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;else if(token)headers['x-sales-os-access-code']=token;
    const r=await fetch(COPILOT_URL,{method:'POST',headers,body:JSON.stringify({action:'status'})});const d=await r.json();providerStatus.ai=!!(d.connected&&d.api_ok)}catch{providerStatus.ai=false}
}
async function load(){
  data=await rpc('sales_os_snapshot',{p_token:token||null});norm();actor=data.actor||actor;
  try{data.zoho_connections=await rpc('sales_os_zoho_status',{p_token:token||null})||[]}catch{data.zoho_connections=[]}
  try{todayQueue=await rpc('sales_os_today_queue',{p_token:token||null,p_limit:30})||[]}catch{todayQueue=[]}
  await refreshAI();renderIdentity();renderAll();
}
function renderIdentity(){
  const name=actor?.display_name||actor?.email||'Shared';$('#sideIdentity').innerHTML='<span class="avatar">'+esc(name.charAt(0).toUpperCase())+'</span><div><b>'+esc(name)+'</b><small>Sales OS member</small></div>';$('#topIdentity').textContent=name.charAt(0).toUpperCase();
}

function route(hash,push=true){
  const raw=String(hash||'#/command').replace(/^#/,'').replace(/^\//,'');const [page,id]=raw.split('/');
  currentRoute=page||'command';$$('.route-page').forEach(x=>x.classList.add('hidden'));
  const el=$('#page-'+(currentRoute==='prospect'?'prospect':currentRoute))||$('#page-command');el.classList.remove('hidden');
  $$('[data-route]').forEach(b=>b.classList.toggle('active',b.dataset.route===currentRoute));
  if(push&&location.hash!=='#/'+raw)location.hash='/'+raw;
  closeSheet();
  if(currentRoute==='prospect'&&id)renderProspectDetail(id);
  if(currentRoute==='command')renderCommand();
  if(currentRoute==='prospects')renderProspects();
  if(currentRoute==='research')renderResearch();
  if(currentRoute==='assets')renderAssets();
  if(currentRoute==='outreach')renderOutreach();
  if(currentRoute==='pipeline')renderPipeline();
  if(currentRoute==='settings')renderSettings();
  window.scrollTo(0,0);
}
window.addEventListener('hashchange',()=>route(location.hash,false));

function renderAll(){renderCommand();renderProspects();renderResearch();renderAssets();renderOutreach();renderPipeline();renderSettings();if(currentRoute==='prospect'&&currentProspect)renderProspectDetail(currentProspect.id)}
function priorityProspects(){
  const named=["Dave's Rare Aquarium Fish","Aqua Huna","Imperial Tropicals","The Wet Spot Tropical Fish"];
  const map=new Map(data.prospects.map(p=>[p.company,p]));const arr=named.map(n=>map.get(n)).filter(Boolean);
  for(const p of [...data.prospects].sort((a,b)=>(b.score||0)-(a.score||0)))if(arr.length<4&&!arr.some(x=>x.id===p.id)&&!['Lost','Disqualified'].includes(p.stage))arr.push(p);
  return arr.slice(0,4);
}
function renderCommand(){
  if(!$('#todayPriorities'))return;
  const priorities=todayQueue.slice(0,5);
  $('#todayPriorities').innerHTML=priorities.length?priorities.map((x,i)=>{
    const company=x.title||prospectName(x.prospect_id)||'Sales task';
    const sub=[x.category,x.assigned_to,'Urgency '+x.score].filter(Boolean).join(' · ');
    return '<div class="priority-row" data-urgency="'+esc(x.score)+'"><div class="priority-art"></div><div><h3>'+esc(x.action_label||company)+'</h3><p>'+esc(company)+' · '+esc(x.reason||'')+'</p><div class="priority-score">'+esc(sub)+'</div></div><button class="btn" onclick="runTodayItem('+i+')">'+esc(x.action_label||'Open')+' →</button></div>';
  }).join(''):'<div class="empty">Nothing urgent right now.</div>';

  const activity=[...data.activities].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)).slice(0,4);
  $('#teamActivity').innerHTML=activity.map(a=>'<div class="activity-row"><span class="activity-icon">'+(a.activity_type==='Sent'?'➤':a.activity_type==='Reply'?'✦':'▣')+'</span><div><b>'+esc(a.actor_name||a.activity_type||'Activity')+'</b><span>'+esc((a.subject||a.outcome||prospectName(a.prospect_id)||'').slice(0,76))+'</span></div><time>'+new Date(a.occurred_at).toLocaleDateString()+'</time></div>').join('')||'<div class="empty">No activity yet.</div>';

  const pp=priorityProspects();
  const actionable=todayQueue.filter(x=>x.score>=70).length;
  $('#priorityCount').textContent=actionable+' active moves';
  $('#priorityProspects').innerHTML=pp.map(p=>showcaseCard(p)).join('');
  $('#commandCounts').textContent=data.prospects.length+' prospects  |  '+data.assets.length+' assets  |  '+todayQueue.length+' ranked actions';

  const reviewCount=data.asset_work_requests.filter(j=>j.status==='ready_for_review').length;
  const replyCount=data.inbox_threads.filter(t=>t.status==='open'&&t.last_direction==='inbound').length;
  const followCount=data.workflow_state.filter(w=>w.recommended_action==='Follow up').length;
  const ai=$('#commandAskAI');
  if(ai)ai.innerHTML='<b>'+replyCount+' replies · '+reviewCount+' reviews · '+followCount+' follow-ups</b><span>Morpheus has ranked the next moves</span>';
}
window.runTodayItem=async i=>{
  const x=todayQueue[i];if(!x)return;
  if(x.item_type==='reminder'){
    modal('Reminder','<div class="command-plan-answer">'+esc(x.reason||x.title)+'</div><div class="editor-actions"><button id="completeTodayReminder" class="btn lime">Complete reminder</button></div>');
    $('#completeTodayReminder').onclick=async()=>{await rpc('sales_os_complete_reminder',{p_token:token||null,p_id:x.entity_id}).catch(async()=>{await rpc('sales_os_save_reminder',{p_token:token||null,p_payload:{id:x.entity_id,status:'completed'}})});closeModal();await load();toast('Reminder completed')};
    return;
  }
  if(x.item_type==='approval'){
    openApprovalItem(x.entity_id);return;
  }
  const p=data.prospects.find(v=>v.id===x.prospect_id);if(!p)return;
  if(x.action_kind==='reply'){route('#/prospect/'+p.id);return}
  if(x.action_kind==='asset_review'){
    const j=pJobs(p.id).find(j=>j.status==='ready_for_review');if(j){openAssetJob(j.id);return}
    route('#/assets');return;
  }
  if(x.action_kind==='draft_ready'){const d=pDrafts(p.id).find(d=>d.status==='draft');if(d){currentDraft=d;route('#/outreach');renderOutreach();return}}
  if(x.action_kind==='asset_ready'){aiWrite(p.id);return}
  if(x.action_kind==='waiting'){aiWrite(p.id);return}
  if(x.action_kind==='research'||x.action_kind==='research_ready'){if(x.action_kind==='research')startResearch(p.id);else route('#/prospect/'+p.id);return}
  route('#/prospect/'+p.id);
};
function openApprovalItem(id){
  const a=data.approvals.find(x=>x.id===id);if(!a)return toast('Approval not found');
  modal('Review approval','<div class="command-plan-answer"><b>'+esc(a.title)+'</b><br>'+esc(a.description||'Protected action awaiting review.')+'</div><div class="editor-actions"><button id="approveTodayItem" class="btn lime">Approve</button><button id="rejectTodayItem" class="btn">Reject</button></div>');
  $('#approveTodayItem').onclick=()=>reviewTodayApproval(id,'approved');
  $('#rejectTodayItem').onclick=()=>reviewTodayApproval(id,'rejected');
}
async function reviewTodayApproval(id,decision){
  if(!actor?.authenticated)return toast('Sign in as Saad or Yazeed');
  await rpc('sales_os_review_approval',{p_token:token||null,p_id:id,p_decision:decision,p_note:''});closeModal();await load();toast(decision==='approved'?'Approved':'Rejected');
}

window.routeToPriority=(routeName,pid)=>{if(routeName==='prospect'&&pid)route('#/prospect/'+pid);else route('#/'+routeName)};
function showcaseCard(p){
  const f=favicon(p),tag=p.stage==='Ready to contact'?'Draft ready':p.stage==='Research'?'Research ready':p.stage;
  return '<article class="showcase-card" onclick="route(\'#/prospect/'+p.id+'\')">'+(f?'<img class="favicon" src="'+esc(f)+'" alt="">':'')+'<div><h3>'+esc(p.company)+'</h3><p>'+esc(p.segment||p.category||'')+'</p><div class="showcase-footer"><span class="status-chip '+statusClass(tag)+'">'+esc(tag)+'</span><button class="round-go">→</button></div></div></article>';
}

function syncFilters(){
  const cats=[...new Set(data.prospects.map(p=>p.category).filter(Boolean))].sort(),ass=[...new Set(data.prospects.map(p=>p.owner_assigned).filter(Boolean))].sort();
  const cv=$('#prospectCategory')?.value||'',sv=$('#prospectStage')?.value||'',av=$('#prospectAssignee')?.value||'';
  if($('#prospectCategory')){$('#prospectCategory').innerHTML='<option value="">All markets</option>'+cats.map(x=>'<option>'+esc(x)+'</option>').join('');$('#prospectCategory').value=cv}
  if($('#prospectStage')){$('#prospectStage').innerHTML='<option value="">All stages</option>'+STAGES.map(x=>'<option>'+x+'</option>').join('');$('#prospectStage').value=sv}
  if($('#prospectAssignee')){$('#prospectAssignee').innerHTML='<option value="">All assignees</option>'+ass.map(x=>'<option>'+esc(x)+'</option>').join('');$('#prospectAssignee').value=av}
}
function filteredProspects(){
  const q=($('#prospectSearch')?.value||'').toLowerCase()||($('#globalSearch')?.value||'').toLowerCase(),cat=$('#prospectCategory')?.value||'',stage=$('#prospectStage')?.value||'',ass=$('#prospectAssignee')?.value||'';
  return data.prospects.filter(p=>{const blob=[p.company,p.category,p.segment,p.location,p.contact_name,p.contact_email,p.website,p.notes].join(' ').toLowerCase();return(!q||blob.includes(q))&&(!cat||p.category===cat)&&(!stage||p.stage===stage)&&(!ass||p.owner_assigned===ass)}).sort((a,b)=>(b.score||0)-(a.score||0)||a.company.localeCompare(b.company));
}
function renderProspects(){
  if(!$('#prospectGrid'))return;syncFilters();const rows=filteredProspects();
  $('#prospectGrid').innerHTML=rows.map(p=>'<article class="prospect-card" onclick="route(\'#/prospect/'+p.id+'\')"><div class="prospect-card-head"><div><span class="eyebrow">'+esc(p.category||'General')+'</span><h3>'+esc(p.company)+'</h3><p>'+esc([p.segment,p.location].filter(Boolean).join(' · '))+'</p></div><span class="status-chip '+statusClass(p.stage)+'">'+esc(p.stage)+'</span></div><div class="card-mid"><span class="status-chip">'+pAssets(p.id).length+' assets</span><span class="status-chip">'+esc(p.owner_assigned||'Unassigned')+'</span></div><div class="prospect-card-footer"><small>'+esc(workflowFor(p.id)?.recommended_action||p.next_action||'No next action')+'</small><button class="round-go">→</button></div></article>').join('')||'<div class="empty">No prospects found.</div>';
}

function researchExists(p){return pResearch(p.id).length>0||pNotes(p.id).some(n=>String(n.title||'').toLowerCase().startsWith('research'))}
function renderResearch(){
  if(!$('#researchQueue'))return;const queue=data.prospects.filter(p=>!researchExists(p)&&!['Lost','Disqualified'].includes(p.stage)).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,20);
  $('#researchQueueCount').textContent=queue.length+' ready';$('#researchQueue').innerHTML=queue.map(p=>'<div class="stack-item"><div class="main"><b>'+esc(p.company)+'</b><span>'+esc(p.category||'')+' · '+esc(p.owner_assigned||'')+'</span></div><button class="btn" onclick="startResearch(\''+p.id+'\')">Start research →</button></div>').join('')||'<div class="empty">Research queue is clear.</div>';
  const reports=[...data.research_reports].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,20);
  $('#recentResearch').innerHTML=reports.map(r=>'<div class="stack-item" onclick="route(\'#/prospect/'+r.prospect_id+'\')"><div class="main"><b>'+esc(prospectName(r.prospect_id))+'</b><span>'+esc((r.summary||'Research complete').slice(0,90))+'</span></div><span class="status-chip cyan">Ready</span></div>').join('')||'<div class="empty">No saved research yet.</div>';
}

function renderAssets(){
  if(!$('#assetQueue'))return;const jobs=[...data.asset_work_requests].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  const active=jobs.filter(j=>['queued','in_progress','ready_for_review'].includes(j.status));$('#assetQueueCount').textContent=active.length+' active';
  $('#assetQueue').innerHTML=active.map(j=>'<article class="asset-job-card" onclick="openAssetJob(\''+j.id+'\')"><div class="row"><span class="eyebrow">AHAMED</span><span class="status-chip '+(j.status==='ready_for_review'?'amber':'cyan')+'">'+esc(j.status.replaceAll('_',' '))+'</span></div><h3>'+esc(j.title||j.request_text||'Asset build')+'</h3><p>'+esc(prospectName(j.prospect_id))+' · '+esc(j.priority||'normal')+'</p></article>').join('')||'<div class="empty">No active asset jobs.</div>';
  $('#assetLibraryCount').textContent=data.assets.length+' assets';$('#assetLibrary').innerHTML=data.assets.map(a=>'<article class="asset-card"><span class="eyebrow">'+esc(a.asset_type||'Asset')+'</span><h3>'+esc(a.title)+'</h3><p>'+esc(prospectName(a.prospect_id))+' · '+esc(a.status||'')+'</p><div class="asset-actions">'+(safeUrl(a.url)?'<a class="btn" target="_blank" href="'+esc(a.url)+'">Open ↗</a>':'')+'<button class="btn" onclick="route(\'#/prospect/'+a.prospect_id+'\')">Account</button></div></article>').join('')||'<div class="empty">No assets yet.</div>';
}

function renderOutreach(){
  if(!$('#draftList'))return;const drafts=[...data.email_drafts].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));$('#draftCount').textContent=drafts.filter(d=>d.status==='draft').length+' drafts';
  $('#draftList').innerHTML=drafts.map(d=>'<div class="draft-row '+(currentDraft?.id===d.id?'active':'')+'" onclick="openDraft(\''+d.id+'\')"><b>'+esc(d.subject||'(No subject)')+'</b><span>'+esc(prospectName(d.prospect_id))+' · '+esc(d.status)+'</span></div>').join('')||'<div class="empty">No drafts yet.</div>';
  if(currentDraft){const d=data.email_drafts.find(x=>x.id===currentDraft.id);if(d)renderDraftEditor(d)}
}
function openDraft(id){currentDraft=data.email_drafts.find(d=>d.id===id)||null;renderOutreach()}
window.openDraft=openDraft;
function renderDraftEditor(d){
  const p=data.prospects.find(x=>x.id===d.prospect_id);$('#draftEditor').innerHTML='<div class="panel-head"><div><h2>'+esc(p?.company||'Email draft')+'</h2><span class="quiet">'+esc(d.status)+'</span></div><button class="btn" onclick="aiWrite(\''+d.prospect_id+'\')">✦ AI write</button></div><div class="field"><label>From</label><select id="draftProvider" class="control">'+mailProviderOptions(d)+'</select></div><div class="field"><label>To</label><input id="draftTo" class="control" value="'+esc(d.recipient||'')+'"></div><div class="field"><label>Subject</label><input id="draftSubject" class="control" value="'+esc(d.subject||'')+'"></div><div class="field"><label>Message</label><textarea id="draftBody">'+esc(d.body||'')+'</textarea></div><div class="editor-actions"><button class="btn" onclick="saveDraft()">Save draft</button><button class="btn lime" onclick="sendDraft()">Review & send</button></div>';
}
async function saveDraft(){
  if(!currentDraft)return;await rpc('sales_os_save_email_draft',{p_token:token||null,p_payload:{id:currentDraft.id,recipient:$('#draftTo').value,subject:$('#draftSubject').value,body:$('#draftBody').value,status:'draft',ai_assisted:currentDraft.ai_assisted,provider:$('#draftProvider')?.value||currentDraft.provider}});toast('Draft saved');await load();currentDraft=data.email_drafts.find(d=>d.id===currentDraft.id);renderOutreach();
}
async function sendDraft(){
  if(!currentDraft)return;await saveDraft();if(!actor?.authenticated){toast('Sign in as Saad or Yazeed to send');return}
  const provider=draftMailProvider(currentDraft),conn=provider==='zoho_mail'?currentZoho():currentGmail();
  if(!conn){openConnection(provider==='zoho_mail'?'zoho':'gmail');return}
  const endpoint=provider==='zoho_mail'?'sales-os-zoho-send':'sales-os-gmail-send';
  try{const r=await fetch(SUPABASE_URL+'/functions/v1/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:JSON.stringify({draft_id:currentDraft.id})});const out=await r.json();if(!r.ok)throw new Error(out.error||'Send failed');toast('Email sent via '+mailProviderLabel(provider));currentDraft=null;await load();renderOutreach()}catch(e){toast(String(e.message||e))}
}

function renderPipeline(){
  if(!$('#pipelineBoard'))return;$('#pipelineBoard').innerHTML=PIPELINE.map(stage=>{const ps=data.prospects.filter(p=>p.stage===stage);return '<section class="pipeline-lane"><div class="pipeline-lane-head"><span>'+stage+'</span><span>'+ps.length+'</span></div>'+ps.slice(0,50).map(p=>'<div class="pipeline-deal" onclick="route(\'#/prospect/'+p.id+'\')"><b>'+esc(p.company)+'</b><span>'+esc(p.category||'')+'</span></div>').join('')+'</section>'}).join('');
}

function renderSettings(){
  if(!$('#connectionsGrid'))return;const ai=providerStatus.ai,gmail=currentGmail(),zoho=currentZoho(),zohoSetup=data.connections.find(c=>c.key==='zoho_mail');
  const items=[
    {key:'ai',title:'Morpheus AI',status:ai?'connected':'not connected',desc:ai?'Native account-aware Copilot is active.':'Connect an OpenAI API key for native research and writing.'},
    {key:'gmail',title:'Gmail',status:gmail?'connected':'not connected',desc:gmail?'Prospect threads sync automatically for '+gmail.google_email+'.':'Connect Gmail for automatic inbox sync and direct sending.'},
    {key:'zoho',title:'Zoho Mail',status:zoho?'connected':zohoSetup?.status==='ready_to_connect'?'ready':'not connected',desc:zoho?'Matched prospect threads sync for '+zoho.zoho_email+'.':zohoSetup?.status==='ready_to_connect'?'OAuth is configured. Authorize your Zoho mailbox.':'Connect Zoho Mail without changing Sales OS as the source of truth.'},
    {key:'chatgpt',title:'ChatGPT',status:'available',desc:'Use the private MCP connection when you want ChatGPT to operate Sales OS directly.'}
  ];
  $('#connectionsGrid').innerHTML=items.map(x=>'<article class="connection-card"><div class="panel-head"><h3>'+esc(x.title)+'</h3><span class="status-chip '+(x.status==='connected'?'lime':'')+'">'+esc(x.status)+'</span></div><p>'+esc(x.desc)+'</p><button class="btn" onclick="openConnection(\''+x.key+'\')">'+(x.status==='connected'?'Manage':'Connect')+'</button></article>').join('');
}

function briefFor(p){
  if((p.category||'').toLowerCase().includes('aquanix'))return[
    ['◎','1,000 kg starting MOQ','Scalable private-label production'],
    ['▣','Own-brand packaging','Custom formula and your branding'],
    ['⇢','Delivery from New York','Efficient US fulfilment and logistics']
  ];
  if((p.category||'').toLowerCase().includes('tin tech'))return[
    ['▣','Dedicated supply program','Packaging capacity built around demand'],
    ['◎','Commercial proposal','Volume, tooling and pricing tracked'],
    ['⇢','Delivered program','Supply planning and logistics included']
  ];
  return[
    ['⌕','Research-backed opportunity','Built from verified prospect context'],
    ['▣','Personalized asset','Something concrete to react to'],
    ['➤','Prepared outreach','Sales message tied to the asset']
  ];
}
function stageState(p){
  const research=researchExists(p),assets=pAssets(p.id).length>0,review=pJobs(p.id).some(j=>j.status==='ready_for_review'||j.status==='approved'),outreach=pMessages(p.id).some(m=>m.direction==='outbound')||pDrafts(p.id).length>0;
  return{research,assets,review,outreach};
}
function renderProspectDetail(id){
  const p=data.prospects.find(x=>x.id===id);if(!p)return route('#/prospects');currentProspect=p;const state=stageState(p),assets=pAssets(id),jobs=pJobs(id),reports=pResearch(id),draft=pDrafts(id)[0]||null,opp=pOpportunity(id),sources=[p.website,...(p.source_notes||[])].filter(safeUrl).slice(0,8),brief=briefFor(p);
  currentAssetId=currentAssetId&&assets.some(a=>a.id===currentAssetId)?currentAssetId:assets[0]?.id||null;const activeAsset=assets.find(a=>a.id===currentAssetId)||assets[0]||null;
  const f=favicon(p),insight=reports[0]?.structured?.fit||reports[0]?.summary||p.next_action||'Use the research, asset and outreach context together before the next move.';
  $('#prospectDetail').innerHTML=
  '<div class="prospect-top"><button class="icon-btn" onclick="history.back()">←</button><div class="prospect-avatar">'+(f?'<img src="'+esc(f)+'" alt="">':esc(p.company.charAt(0)))+'</div><div><div class="eyebrow">'+esc(p.category||'PROSPECT')+'</div><h1>'+esc(p.company)+'</h1><p>'+esc(p.segment||p.location||'Opportunity account')+'</p></div><button class="btn lime" onclick="aiWrite(\''+p.id+'\')">➤ Prepare outreach →</button></div>'+
  '<div class="step-rail">'+stepHtml('Research',1,state.research,state.research&&!state.assets)+stepHtml('Assets',2,state.assets,state.assets&&!state.review)+stepHtml('Review',3,state.review,state.review&&!state.outreach)+stepHtml('Outreach',4,state.outreach,false)+'</div>'+
  '<div class="prospect-layout">'+
    '<section class="panel detail-card"><h2>Opportunity brief</h2>'+brief.map(x=>'<div class="brief-stat"><span>'+x[0]+'</span><div><b>'+esc(x[1])+'</b><small>'+esc(x[2])+'</small></div></div>').join('')+
    '<div class="tab-row"><button class="active">Brief</button><button onclick="startResearch(\''+p.id+'\')">Research</button><button onclick="openEditProspect(\''+p.id+'\')">Contact</button></div>'+
    '<div class="brief-text">'+esc(reports[0]?.summary||p.notes||'Research this prospect to generate a sourced opportunity brief.')+'</div>'+
    '<div class="source-list">'+sources.map(u=>'<a href="'+esc(u)+'" target="_blank">↗ '+esc(new URL(u).hostname.replace(/^www\./,''))+'</a>').join('')+'</div>'+
    '<div class="editor-actions"><button class="btn primary" onclick="startResearch(\''+p.id+'\')">✦ Start research</button><button class="btn" onclick="assignAhamed(\''+p.id+'\')">Send to Ahamed</button></div></section>'+
    '<section class="panel detail-card"><div class="panel-head"><h2>Asset studio</h2><span class="status-chip '+(jobs.some(j=>j.status==='ready_for_review')?'amber':assets.length?'lime':'')+'">'+esc(jobs.some(j=>j.status==='ready_for_review')?'Awaiting review':assets.length?'Asset ready':'No asset')+'</span></div>'+
      '<div class="asset-stage"><div class="asset-stage-head"><span class="eyebrow">'+esc(activeAsset?.asset_type||'CONCEPT ASSET')+'</span>'+(activeAsset?.url?'<a class="text-link" target="_blank" href="'+esc(activeAsset.url)+'">Open asset ↗</a>':'')+'</div>'+
      '<div class="asset-preview">'+(activeAsset?.url?'<iframe src="'+esc(activeAsset.url)+'" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>':'<div class="asset-preview-empty"><div><b>No asset yet</b><br><span>Send the prospect to Ahamed when the research is ready.</span></div></div>')+'</div>'+
      '<div class="asset-thumbs">'+assets.map(a=>'<button class="asset-thumb '+(a.id===currentAssetId?'active':'')+'" onclick="selectAsset(\''+a.id+'\')"><b>'+esc(a.title)+'</b><span>'+esc(a.asset_type)+'</span></button>').join('')+'</div></div>'+
      ahamedStrip(p,jobs)+
    '</section>'+
    '<section class="detail-right"><div class="copilot-insight"><div class="eyebrow">MORPHEUS SUGGESTS</div><b>'+esc((reports[0]?.structured?.asset_recommendation?.concept||'Lead with the clearest commercial opportunity.').slice(0,110))+'</b><p>'+esc(insight.slice(0,260))+'</p></div>'+
      '<section class="panel detail-card outreach-draft-card"><div class="panel-head"><h2>Outreach draft</h2><button class="text-link" onclick="aiWrite(\''+p.id+'\')">✦ Refine</button></div><textarea id="prospectDraftBody" placeholder="No draft yet. Use AI Write to prepare one.">'+esc(draft?.body||'')+'</textarea><div class="editor-actions"><button class="btn lime" onclick="saveProspectDraft(\''+p.id+'\')">Save draft</button><button class="btn" onclick="openCopilot(\''+p.id+'\')">Ask Morpheus</button></div></section>'+
      '<section class="panel detail-card next-action-card"><div class="eyebrow">NEXT ACTION</div><h2>'+esc(workflowFor(p.id)?.recommended_action||p.next_action||'Define the next move')+'</h2><p class="quiet">'+esc(workflowFor(p.id)?.reason||'')+'</p><p class="quiet">'+esc(p.owner_assigned||'Unassigned')+(p.next_action_date?' · '+p.next_action_date:'')+'</p><div class="editor-actions"><button class="btn lime" onclick="runProspectNextMove(\''+p.id+'\')">Do next move</button><button class="btn" onclick="addProspectNote(\''+p.id+'\')">Add note</button><button class="btn" onclick="addProspectReminder(\''+p.id+'\')">Reminder</button></div></section>'+
    '</section>'+
  '</div>'+
  '<div class="timeline-bar">'+timeline('Research added',state.research)+timeline('Asset requested',jobs.length>0)+timeline('Draft ready',!!draft)+timeline('Outreach',state.outreach)+'</div>';
}
function stepHtml(label,n,done,active){return '<div class="step '+(done?'done ':'')+(active?'active':'')+'"><i>'+(done?'✓':n)+'</i><span>'+label+'</span></div>'}
function timeline(label,done){return '<div class="timeline-item '+(done?'done':'')+'"><i>'+(done?'✓':'○')+'</i><span>'+label+'</span></div>'}
function ahamedStrip(p,jobs){
  const job=jobs[0];return '<div class="ahamed-strip"><div class="who"><i>A</i><div><b>Ahamed</b><small>'+(job?esc(job.status.replaceAll('_',' ')):'No active job')+'</small></div></div>'+(job?'<button class="btn" onclick="openAssetJob(\''+job.id+'\')">'+(job.status==='ready_for_review'?'Review':'View job')+'</button>':'<button class="btn" onclick="assignAhamed(\''+p.id+'\')">Request asset</button>')+'</div>';
}
window.selectAsset=id=>{currentAssetId=id;renderProspectDetail(currentProspect.id)}

function modal(title,body){$('#modalCard').innerHTML='<div class="modal-head"><div><h2>'+esc(title)+'</h2></div><button class="icon-btn" data-close-modal>×</button></div>'+body;$('#modal').classList.remove('hidden');$$('[data-close-modal]').forEach(x=>x.onclick=closeModal)}
function closeModal(){$('#modal').classList.add('hidden')}
function closeSheet(){$('#moreSheet').classList.add('hidden')}
function openSheet(){$('#moreSheet').classList.remove('hidden')}

async function startResearch(id){
  const p=data.prospects.find(x=>x.id===id);if(!p)return;
  if(!providerStatus.ai){const prompt=researchPrompt(p);navigator.clipboard.writeText(prompt).catch(()=>{});openContextChat(contextPrompt(prompt,id));toast('Research prompt copied');return}
  toast('Researching '+p.company+'…');
  try{const headers={'Content-Type':'application/json',apikey:APIKEY};if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;else if(token)headers['x-sales-os-access-code']=token;
    const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-prospect-research',{method:'POST',headers,body:JSON.stringify({prospect_id:id})});const out=await r.json();if(!r.ok)throw new Error(out.detail||out.error||'Research failed');await load();toast('Research saved');route('#/prospect/'+id)}catch(e){toast(String(e.message||e))}
}
window.startResearch=startResearch;
function researchPrompt(p){return 'Research this real company for Morpheus Sales OS using current public sources.\n\nCompany: '+p.company+'\nCategory: '+(p.category||'')+'\nWebsite: '+(p.website||'')+'\nKnown context: '+(p.notes||'')+'\n\nVerify what the company does, public contacts when actually available, why it fits Morpheus, the strongest personalized asset to create, outreach angles, cautions, and source URLs. Do not invent facts.'}
function aiWrite(id){const p=data.prospects.find(x=>x.id===id);if(!p)return;if(providerStatus.ai){openCopilot(id,'Draft the best concise next sales email for this prospect using the live account context, research and assets. Do not invent facts. Return a subject and body.')}else{const prompt='Write a concise B2B sales email for '+p.company+'. Use only verified context from this Sales OS account. Do not invent facts. Return SUBJECT and BODY.';navigator.clipboard.writeText(prompt).catch(()=>{});openContextChat(contextPrompt(prompt,id));toast('AI writing prompt copied')}}
window.aiWrite=aiWrite;
async function saveProspectDraft(id){
  const p=data.prospects.find(x=>x.id===id),body=$('#prospectDraftBody').value.trim();if(!body)return toast('Draft is empty');
  const existing=pDrafts(id)[0];await rpc('sales_os_save_email_draft',{p_token:token||null,p_payload:{id:existing?.id,prospect_id:id,recipient:p.contact_email||'',sender_name:actor?.display_name||'',sender_email:actor?.email||'',subject:existing?.subject||('A thought for '+p.company),body,status:'draft',ai_assisted:existing?.ai_assisted||false,provider:'sales_os',created_by:actor?.display_name||'Sales OS'}});toast('Draft saved');await load();renderProspectDetail(id)
}
window.saveProspectDraft=saveProspectDraft;

window.runProspectNextMove=id=>{
  const p=data.prospects.find(x=>x.id===id),w=workflowFor(id);if(!p)return;
  const phase=w?.phase||'research';
  if(phase==='research'){startResearch(id);return}
  if(phase==='research_ready'){assignAhamed(id);return}
  if(phase==='asset_build'){const j=pJobs(id).find(j=>['queued','in_progress','ready_for_review'].includes(j.status));if(j){openAssetJob(j.id);return}route('#/assets');return}
  if(phase==='asset_review'){const j=pJobs(id).find(j=>j.status==='ready_for_review');if(j){openAssetJob(j.id);return}route('#/assets');return}
  if(phase==='draft_ready'){const d=pDrafts(id).find(d=>d.status==='draft');if(d){currentDraft=d;route('#/outreach');renderOutreach();return}aiWrite(id);return}
  if(phase==='asset_ready'||phase==='waiting'||phase==='reply'){aiWrite(id);return}
  route('#/prospect/'+id);
};
function openEditProspect(id){
  const p=data.prospects.find(x=>x.id===id);if(!p)return;modal('Edit '+p.company,'<div class="field"><label>Contact</label><input id="epContact" class="control" value="'+esc(p.contact_name||'')+'"></div><div class="field"><label>Email</label><input id="epEmail" class="control" value="'+esc(p.contact_email||'')+'"></div><div class="field"><label>Website</label><input id="epWebsite" class="control" value="'+esc(p.website||'')+'"></div><div class="field"><label>Assigned to</label><input id="epAssignee" class="control" value="'+esc(p.owner_assigned||'')+'"></div><div class="field"><label>Next action</label><input id="epNext" class="control" value="'+esc(p.next_action||'')+'"></div><button id="saveProspectEdit" class="btn lime wide">Save changes</button>');$('#saveProspectEdit').onclick=async()=>{await rpc('sales_os_save_prospect',{p_token:token||null,p_payload:{id:p.id,contact_name:$('#epContact').value,contact_email:$('#epEmail').value,website:$('#epWebsite').value,owner_assigned:$('#epAssignee').value,next_action:$('#epNext').value}});closeModal();await load();renderProspectDetail(id);toast('Account updated')}}
window.openEditProspect=openEditProspect;

function assignAhamed(id){
  const p=data.prospects.find(x=>x.id===id);if(!p)return;modal('Send to Ahamed','<div class="field"><label>Job title</label><input id="ajTitle" class="control" value="'+esc('Build prospect asset for '+p.company)+'"></div><div class="field"><label>What should Ahamed make?</label><textarea id="ajRequest" placeholder="Describe exactly what to build, what the prospect should see, mobile requirements and references."></textarea></div><div class="field"><label>Priority</label><select id="ajPriority" class="control"><option>normal</option><option>high</option><option>urgent</option><option>low</option></select></div><button id="assignAhamedNow" class="btn lime wide">Assign to Ahamed</button>');$('#assignAhamedNow').onclick=async()=>{const request=$('#ajRequest').value.trim();if(!request)return toast('Describe the asset');await rpc('sales_os_assign_asset_job',{p_token:token||null,p_payload:{prospect_id:id,builder_slug:'ahamed',title:$('#ajTitle').value,request_text:request,work_type:'build',priority:$('#ajPriority').value,deliverable_types:['preview_url','deployment_url','repository_url'],brief_json:{requested_from:'V4',company:p.company,category:p.category}}});closeModal();await load();renderProspectDetail(id);toast('Sent to Ahamed')}}
window.assignAhamed=assignAhamed;

function openAssetJob(id){
  const j=data.asset_work_requests.find(x=>x.id===id);if(!j)return;const ds=jobDeliverables(id),ns=jobNotes(id);
  modal('Asset job · '+prospectName(j.prospect_id),'<div class="panel-head"><div><h2>'+esc(j.title||'Asset job')+'</h2><span class="quiet">Ahamed · '+esc(j.status.replaceAll('_',' '))+'</span></div><span class="status-chip '+(j.status==='ready_for_review'?'amber':'')+'">'+esc(j.priority||'normal')+'</span></div><div class="brief-text">'+esc(j.request_text||'')+'</div><div class="source-list">'+ds.map(d=>'<a href="'+esc(d.deployment_url||d.url||'#')+'" target="_blank">↗ '+esc(d.title)+'</a>').join('')+'</div><div class="stack-list">'+ns.map(n=>'<div class="stack-item"><div class="main"><b>'+esc(n.author_name||n.author_type)+'</b><span>'+esc(n.body)+'</span></div></div>').join('')+'</div>'+(j.status==='ready_for_review'?'<div class="field" style="margin-top:12px"><label>Review note</label><textarea id="jobReviewNote"></textarea></div><div class="editor-actions"><button class="btn lime" onclick="reviewAssetJob(\''+id+'\',\'approved\')">Approve</button><button class="btn" onclick="reviewAssetJob(\''+id+'\',\'changes_requested\')">Request changes</button></div>':''));
}
window.openAssetJob=openAssetJob;
async function reviewAssetJob(id,decision){await rpc('sales_os_review_asset_job',{p_token:token||null,p_job_id:id,p_decision:decision,p_notes:$('#jobReviewNote')?.value||''});closeModal();await load();renderAssets();toast(decision==='approved'?'Asset approved':'Changes sent to Ahamed')}
window.reviewAssetJob=reviewAssetJob;

function openAddProspect(){
  modal('Add prospect','<div class="field"><label>Company</label><input id="npCompany" class="control"></div><div class="field"><label>Category</label><input id="npCategory" class="control"></div><div class="field"><label>Website</label><input id="npWebsite" class="control"></div><div class="field"><label>Assigned to</label><select id="npAssignee" class="control"><option>Yazeed</option><option>Saad</option></select></div><button id="createProspectNow" class="btn lime wide">Create prospect</button>');$('#createProspectNow').onclick=async()=>{const company=$('#npCompany').value.trim();if(!company)return toast('Company required');await rpc('sales_os_save_prospect',{p_token:token||null,p_payload:{company,category:$('#npCategory').value||'General',website:$('#npWebsite').value,owner_assigned:$('#npAssignee').value,stage:'Research',status:'Not started',next_action:'Research and qualify'}});closeModal();await load();route('#/prospects');toast('Prospect created')}}
function openFindProspects(){
  modal('Find new prospects','<div class="field"><label>Market / category</label><input id="fpCategory" class="control" placeholder="e.g. Fish Food · Retail"></div><div class="field"><label>Geography</label><input id="fpGeo" class="control" placeholder="e.g. Northeast USA"></div><div class="field"><label>Extra criteria</label><textarea id="fpCriteria" placeholder="Independent retailers, avoid chains…"></textarea></div><div class="field"><label>How many?</label><select id="fpCount" class="control"><option>10</option><option selected>20</option><option>25</option></select></div><button id="runDiscovery" class="btn lime wide">✦ Start research</button><div id="discoveryResults"></div>');
  $('#runDiscovery').onclick=async()=>{const category=$('#fpCategory').value.trim();if(!category)return toast('Enter a category');if(!providerStatus.ai){navigator.clipboard.writeText('Find '+$('#fpCount').value+' new B2B prospects for '+category+' in '+($('#fpGeo').value||'the target market')+'. '+($('#fpCriteria').value||'')+' Use current public sources, verify contacts, do not invent facts, and return a CSV for Morpheus Sales OS.').catch(()=>{});openContextChat(discoveryPrompt());toast('Research prompt copied');return}
    $('#runDiscovery').disabled=true;$('#runDiscovery').textContent='Researching…';try{const headers={'Content-Type':'application/json',apikey:APIKEY};if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;else if(token)headers['x-sales-os-access-code']=token;const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-discovery',{method:'POST',headers,body:JSON.stringify({category,geography:$('#fpGeo').value,target_count:Number($('#fpCount').value),criteria:$('#fpCriteria').value})});const out=await r.json();if(!r.ok)throw new Error(out.detail||out.error||'Discovery failed');const run=await rpc('sales_os_get_discovery_run',{p_token:token||null,p_run_id:out.run_id});renderDiscovery(run)}catch(e){toast(String(e.message||e))}finally{$('#runDiscovery').disabled=false;$('#runDiscovery').textContent='✦ Start research'}}
}
function renderDiscovery(x){const c=x.candidates||[];$('#discoveryResults').innerHTML='<div class="stack-list" style="margin-top:12px">'+c.map(v=>'<div class="stack-item"><div class="main"><b>'+esc(v.company)+'</b><span>'+esc(v.why_fit||'')+'</span></div>'+(v.review_status==='pending'?'<button class="btn" onclick="reviewCandidate(\''+v.id+'\',\'approved\',\''+x.run.id+'\')">Add</button>':'<span class="status-chip">'+esc(v.review_status)+'</span>')+'</div>').join('')+'</div>'}
async function reviewCandidate(id,decision,runId){await rpc('sales_os_review_discovery_candidate',{p_token:token||null,p_candidate_id:id,p_decision:decision});const run=await rpc('sales_os_get_discovery_run',{p_token:token||null,p_run_id:runId});renderDiscovery(run);await load()}
window.reviewCandidate=reviewCandidate;

function openNewDraft(){
  modal('New email draft','<div class="field"><label>Prospect</label><select id="ndProspect" class="control">'+data.prospects.map(p=>'<option value="'+p.id+'">'+esc(p.company)+'</option>').join('')+'</select></div><div class="field"><label>Subject</label><input id="ndSubject" class="control"></div><div class="field"><label>Message</label><textarea id="ndBody"></textarea></div><button id="saveNewDraft" class="btn lime wide">Save draft</button>');$('#saveNewDraft').onclick=async()=>{const p=data.prospects.find(x=>x.id===$('#ndProspect').value);await rpc('sales_os_save_email_draft',{p_token:token||null,p_payload:{prospect_id:p.id,recipient:p.contact_email||'',sender_name:actor?.display_name||'',sender_email:actor?.email||'',subject:$('#ndSubject').value,body:$('#ndBody').value,status:'draft',created_by:actor?.display_name||'Sales OS'}});closeModal();await load();route('#/outreach');toast('Draft saved')}}
function openConnection(key){
  if(key==='ai'){if(providerStatus.ai){modal('Morpheus AI','<div class="copilot-insight"><b>Native AI is connected.</b><p>Research and writing run inside Sales OS.</p></div><button class="btn lime" onclick="openCopilot()">Open Copilot</button>')}else{if(!actor?.authenticated)return toast('Sign in as Saad or Yazeed first');modal('Connect Morpheus AI','<div class="field"><label>OpenAI API key</label><input id="openaiKey" type="password" class="control" placeholder="sk-…"></div><p class="quiet">The key is stored server-side in Supabase Vault, not in the browser.</p><button id="saveAiKey" class="btn lime wide">Connect AI</button>');$('#saveAiKey').onclick=async()=>{const keyv=$('#openaiKey').value.trim();if(keyv.length<20)return toast('Paste the full API key');await rpc('sales_os_store_secret',{p_token:token||null,p_name:'sales_os_openai_api_key',p_secret:keyv});closeModal();await refreshAI();renderSettings();toast('Morpheus AI connected')}};return}
  if(key==='gmail'){if(!actor?.authenticated)return toast('Sign in as Saad or Yazeed first');const conn=data.gmail_connections.find(c=>String(c.member_email||'').toLowerCase()===String(actor.email||'').toLowerCase()&&c.active);if(conn){modal('Gmail connected','<div class="copilot-insight"><b>'+esc(conn.google_email||conn.member_email)+'</b><p>Prospect threads sync automatically. Last sync: '+esc(conn.last_sync_at?new Date(conn.last_sync_at).toLocaleString():'Not yet')+'</p></div><button id="syncGmailNow" class="btn lime">Sync now</button>');$('#syncGmailNow').onclick=syncGmail}else{modal('Connect Gmail','<p class="brief-text">Authorize Gmail once. Sales OS will sync only conversations matching prospect contact addresses.</p><button id="connectGmail" class="btn lime wide">Connect my Gmail</button>');$('#connectGmail').onclick=connectGmail};return}
  if(key==='zoho'){
    if(!actor?.authenticated)return toast('Sign in as Saad or Yazeed first');
    const conn=currentZoho(),setup=data.connections.find(c=>c.key==='zoho_mail');
    if(conn){
      modal('Zoho Mail connected','<div class="copilot-insight"><b>'+esc(conn.zoho_email||conn.member_email)+'</b><p>Only threads matching saved prospect email addresses enter Sales OS. Last sync: '+esc(conn.last_sync_at?new Date(conn.last_sync_at).toLocaleString():'Not yet')+'</p></div><div class="editor-actions"><button id="syncZohoNow" class="btn lime">Sync now</button><button id="updateZohoCredentials" class="btn">Update OAuth credentials</button></div>');
      $('#syncZohoNow').onclick=syncZoho;$('#updateZohoCredentials').onclick=openZohoCredentialSetup;
    }else if(setup?.status==='ready_to_connect'){
      modal('Authorize Zoho Mail','<p class="brief-text">The secure OAuth bridge is configured. Choose your Zoho data centre, then authorize the mailbox you want Sales OS to use.</p>'+zohoRegionField()+'<div class="field"><label>Registered callback URL</label><input id="zohoCallback" class="control" readonly value="'+esc(ZOHO_REDIRECT_URI)+'"></div><div class="editor-actions"><button id="connectZoho" class="btn lime">Authorize Zoho Mail</button><button id="updateZohoCredentials" class="btn">Update credentials</button></div>');
      $('#connectZoho').onclick=connectZoho;$('#updateZohoCredentials').onclick=openZohoCredentialSetup;
    }else openZohoCredentialSetup();
    return;
  }
  if(key==='chatgpt'){const base=SUPABASE_URL+'/functions/v1/sales-os-mcp/mcp',url=token?base+'?access_code='+encodeURIComponent(token):base;modal('Connect ChatGPT','<p class="brief-text">Use this MCP endpoint when adding the private Sales OS connection in ChatGPT.</p><div class="field"><label>MCP endpoint</label><input id="mcpCopy" class="control" readonly value="'+esc(url)+'"></div><button id="copyMcp" class="btn lime">Copy endpoint</button>');$('#copyMcp').onclick=()=>navigator.clipboard.writeText(url).then(()=>toast('Copied'));return}
}
window.openConnection=openConnection;
async function connectGmail(){const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-gmail-oauth',{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:'{}'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not connect');location.href=d.authorization_url}
async function syncGmail(){const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-gmail-sync',{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:'{}'});const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'Sync failed');closeModal();await load();toast('Gmail synchronized')}
function zohoRegionField(){
  const selected=localStorage.getItem('salesOsZohoAccountsDomain')||'https://accounts.zoho.com';
  const regions=[['https://accounts.zoho.com','United States / Global'],['https://accounts.zoho.eu','Europe'],['https://accounts.zoho.in','India'],['https://accounts.zoho.com.au','Australia'],['https://accounts.zoho.jp','Japan'],['https://accounts.zohocloud.ca','Canada'],['https://accounts.zoho.sa','Saudi Arabia']];
  return '<div class="field"><label>Zoho data centre</label><select id="zohoAccountsDomain" class="control">'+regions.map(x=>'<option value="'+x[0]+'" '+(x[0]===selected?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></div>';
}
function openZohoCredentialSetup(){
  modal('Configure Zoho OAuth','<p class="brief-text">Create a server-based client in the Zoho API Console and register this exact callback URL. The client secret is stored in Supabase Vault and is never returned to the browser.</p><div class="field"><label>Registered callback URL</label><input id="zohoCallback" class="control" readonly value="'+esc(ZOHO_REDIRECT_URI)+'"></div><button id="copyZohoCallback" class="text-link">Copy callback URL</button><div class="field"><label>Zoho Client ID</label><input id="zohoClientId" class="control" autocomplete="off" placeholder="1000.…"></div><div class="field"><label>Zoho Client Secret</label><input id="zohoClientSecret" type="password" class="control" autocomplete="new-password" placeholder="Paste client secret"></div>'+zohoRegionField()+'<button id="saveZohoCredentials" class="btn lime wide">Save securely & continue</button>');
  $('#copyZohoCallback').onclick=()=>navigator.clipboard.writeText(ZOHO_REDIRECT_URI).then(()=>toast('Callback URL copied'));
  $('#saveZohoCredentials').onclick=saveZohoCredentials;
}
async function saveZohoCredentials(){
  const clientId=$('#zohoClientId').value.trim(),clientSecret=$('#zohoClientSecret').value.trim();
  if(clientId.length<10||clientSecret.length<20)return toast('Paste the full Zoho client ID and secret');
  const button=$('#saveZohoCredentials');button.disabled=true;button.textContent='Saving securely…';
  try{
    await rpc('sales_os_store_secret',{p_token:token||null,p_name:'sales_os_zoho_client_id',p_secret:clientId});
    await rpc('sales_os_store_secret',{p_token:token||null,p_name:'sales_os_zoho_client_secret',p_secret:clientSecret});
    localStorage.setItem('salesOsZohoAccountsDomain',$('#zohoAccountsDomain').value);
    closeModal();await load();openConnection('zoho');toast('Zoho OAuth configured');
  }catch(e){toast(String(e.message||e));button.disabled=false;button.textContent='Save securely & continue'}
}
async function connectZoho(){
  const accountsDomain=$('#zohoAccountsDomain')?.value||localStorage.getItem('salesOsZohoAccountsDomain')||'https://accounts.zoho.com';
  localStorage.setItem('salesOsZohoAccountsDomain',accountsDomain);
  const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-zoho-oauth',{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:JSON.stringify({accounts_domain:accountsDomain})});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not connect Zoho Mail');location.href=d.authorization_url;
}
async function syncZoho(){
  const button=$('#syncZohoNow');if(button){button.disabled=true;button.textContent='Synchronizing…'}
  try{const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-zoho-sync',{method:'POST',headers:{'Content-Type':'application/json',apikey:APIKEY,Authorization:'Bearer '+sessionAccessToken},body:'{}'});const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.connections?.find(x=>!x.ok)?.error||d.error||'Sync failed');closeModal();await load();toast('Zoho Mail synchronized')}catch(e){toast(String(e.message||e));if(button){button.disabled=false;button.textContent='Sync now'}}
}
window.openZohoCredentialSetup=openZohoCredentialSetup;

async function copilotFetch(payload={}){
  const headers={'Content-Type':'application/json',apikey:APIKEY};if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;else if(token)headers['x-sales-os-access-code']=token;
  const r=await fetch(COPILOT_URL,{method:'POST',headers,body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.detail||d.error||'Copilot failed');return d;
}
async function openCopilot(id=null,preset=''){
  copilotProspectId=id||null;copilotLocal=[];const p=data.prospects.find(x=>x.id===id);$('#copilotTitle').textContent=p?('Copilot · '+p.company):'Ask Morpheus';$('#copilotContext').textContent=p?([p.category,p.stage,p.owner_assigned].filter(Boolean).join(' · ')):'Live Sales OS workspace';
  $('#copilotQuick').innerHTML=(p?['Summarize this account','Draft the next email','What should happen next?','What are we missing?']:['What needs attention today?','Which prospects are stalled?','What assets should we review?','Give me a sales brief']).map(q=>'<button onclick="quickCopilot(\''+esc(q).replace(/'/g,"\\'")+'\')">'+esc(q)+'</button>').join('');
  $('#copilot').classList.remove('hidden');$('#copilotProvider').classList.toggle('hidden',providerStatus.ai);
  $('#copilotProvider').innerHTML=providerStatus.ai?'':'Native AI is not connected. Use Settings → Morpheus AI, or the command will open ChatGPT instead.';
  $('#copilotMessages').innerHTML='<div class="empty">Ask something about the live account or workspace.</div>';if(preset){$('#copilotInput').value=preset;if(providerStatus.ai)setTimeout(sendCopilot,40)}
}
window.openCopilot=openCopilot;window.quickCopilot=q=>{$('#copilotInput').value=q;sendCopilot()}
function closeCopilot(){$('#copilot').classList.add('hidden')}
async function sendCopilot(){
  const msg=$('#copilotInput').value.trim();if(!msg)return;if(!providerStatus.ai){navigator.clipboard.writeText(msg).catch(()=>{});openContextChat(contextPrompt(msg,copilotProspectId));toast('Prompt copied');return}
  copilotLocal.push({role:'user',content:msg});$('#copilotInput').value='';renderCopilotMsgs();$('#copilotSend').disabled=true;$('#copilotSend').textContent='Thinking…';
  try{const d=await copilotFetch({message:msg,prospect_id:copilotProspectId,thread_id:copilotThreadId});copilotThreadId=d.thread_id||copilotThreadId;copilotLocal.push({role:'assistant',content:d.answer||'',structured:d.structured||{}});renderCopilotMsgs()}catch(e){copilotLocal.push({role:'assistant',content:String(e.message||e)});renderCopilotMsgs()}finally{$('#copilotSend').disabled=false;$('#copilotSend').textContent='Ask'}
}
function renderCopilotMsgs(){$('#copilotMessages').innerHTML=copilotLocal.map(m=>'<div class="copilot-msg '+m.role+'">'+esc(m.content)+'</div>').join('');$('#copilotMessages').scrollTop=$('#copilotMessages').scrollHeight}

function addProspectNote(id){
  const p=data.prospects.find(x=>x.id===id);if(!p)return;
  modal('Add note · '+p.company,'<div class="field"><label>Title</label><input id="noteTitle" class="control" value="Sales note"></div><div class="field"><label>Note</label><textarea id="noteBody"></textarea></div><button id="saveQuickNote" class="btn lime wide">Save note</button>');
  $('#saveQuickNote').onclick=async()=>{const body=$('#noteBody').value.trim();if(!body)return toast('Write the note');await rpc('sales_os_save_note',{p_token:token||null,p_payload:{prospect_id:id,title:$('#noteTitle').value,body,pinned:false,created_by:actor?.display_name||'Sales OS'}});closeModal();await load();renderProspectDetail(id);toast('Note saved')};
}
window.addProspectNote=addProspectNote;
function addProspectReminder(id){
  const p=data.prospects.find(x=>x.id===id);if(!p)return;
  modal('Add reminder · '+p.company,'<div class="field"><label>Reminder</label><input id="remTitle" class="control" value="Follow up"></div><div class="field"><label>When</label><input id="remDue" class="control" type="datetime-local"></div><button id="saveQuickReminder" class="btn lime wide">Create reminder</button>');
  $('#saveQuickReminder').onclick=async()=>{if(!$('#remDue').value)return toast('Choose a date and time');await rpc('sales_os_save_reminder',{p_token:token||null,p_payload:{prospect_id:id,title:$('#remTitle').value,due_at:new Date($('#remDue').value).toISOString(),owner_assigned:p.owner_assigned||actor?.display_name||'',priority:'normal',status:'open',notify_in_app:true,created_by:actor?.display_name||'Sales OS'}});closeModal();await load();renderProspectDetail(id);toast('Reminder created')};
}
window.addProspectReminder=addProspectReminder;
async function commandFetch(command){
  const headers={'Content-Type':'application/json',apikey:APIKEY};
  if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;
  else if(token)headers['x-sales-os-access-code']=token;
  const r=await fetch(COMMAND_URL,{method:'POST',headers,body:JSON.stringify({command})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d.detail||d.error||'Morpheus command failed'),{status:r.status,payload:d});
  return d;
}
async function runUniversalCommand(command){
  command=String(command||'').trim();if(!command)return;
  if(!providerStatus.ai){
    const fallback='Use my connected Morpheus Sales OS context to handle this request safely. Do not send email or make irreversible changes without asking me first.\n\nREQUEST:\n'+command;
    navigator.clipboard.writeText(fallback).catch(()=>{});
    openContextChat(contextPrompt(command));
    toast('Native AI is not connected — command copied to ChatGPT');
    return;
  }
  $('#universalCommandRun').disabled=true;$('#universalCommandRun').textContent='…';
  try{
    const out=await commandFetch(command);
    lastCommandPlan=out.plan||{answer:'',actions:[]};
    renderCommandPlan(command);
  }catch(e){toast(String(e.message||e))}
  finally{$('#universalCommandRun').disabled=false;$('#universalCommandRun').textContent='⌁'}
}
function renderCommandPlan(command=''){
  const plan=lastCommandPlan||{answer:'',actions:[]};
  modal('Morpheus plan',`<div class="command-plan-answer">${esc(plan.answer||'Here is what I can do.')}</div><div class="command-plan-list">${(plan.actions||[]).map((a,i)=>`<article class="command-plan-card ${a._done?'done':''}" id="commandAction-${i}"><div class="top"><div><b>${esc(a.label||a.type)}</b><p>${esc(a.reason||'')}</p></div><span class="workflow-pill">${a.requires_confirmation?'<strong>Confirm</strong>':'Ready'}</span></div><div class="actions"><button class="btn ${a.requires_confirmation?'lime':''}" onclick="runCommandAction(${i})">${a._done?'Done ✓':a.requires_confirmation?'Confirm & run':'Run'}</button>${a.prospect_id?`<button class="btn" onclick="closeModal();route('#/prospect/${a.prospect_id}')">Open account</button>`:''}</div></article>`).join('')||'<div class="empty">No action needed.</div>'}</div>`);
}
window.runCommandAction=async i=>{
  const a=lastCommandPlan?.actions?.[i];if(!a||a._done)return;
  const p=a.prospect_id?data.prospects.find(x=>x.id===a.prospect_id):null;
  try{
    if(a.type==='open_prospect'){closeModal();route('#/prospect/'+a.prospect_id);return}
    if(a.type==='research_prospect'){closeModal();await startResearch(a.prospect_id);return}
    if(a.type==='ai_write'){closeModal();aiWrite(a.prospect_id);return}
    if(a.type==='show_route'){closeModal();route('#/'+(a.payload?.route||'command'));return}
    if(a.type==='assign_ahamed'){
      if(!p)throw new Error('Prospect not found');
      await rpc('sales_os_assign_asset_job',{p_token:token||null,p_payload:{
        prospect_id:p.id,builder_slug:'ahamed',
        title:a.payload?.title||('Build prospect asset for '+p.company),
        request_text:a.payload?.request_text||'Create the strongest prospect-facing asset using the saved research and account context.',
        work_type:'build',priority:a.payload?.priority||'normal',
        deliverable_types:['preview_url','deployment_url','repository_url'],
        brief_json:{requested_from:'Morpheus Command',company:p.company,category:p.category}
      }});
      toast('Sent to Ahamed');
    }else if(a.type==='create_note'){
      if(!p)throw new Error('Prospect not found');
      await rpc('sales_os_save_note',{p_token:token||null,p_payload:{prospect_id:p.id,title:a.payload?.title||'Morpheus note',body:a.payload?.body||a.reason||'',pinned:false,created_by:actor?.display_name||'Morpheus Command'}});
      toast('Note saved');
    }else if(a.type==='create_reminder'){
      if(!p)throw new Error('Prospect not found');
      if(!a.payload?.due_at){closeModal();addProspectReminder(p.id);return}
      await rpc('sales_os_save_reminder',{p_token:token||null,p_payload:{prospect_id:p.id,title:a.payload?.title||('Follow up with '+p.company),due_at:a.payload.due_at,owner_assigned:p.owner_assigned||actor?.display_name||'',priority:'normal',status:'open',notify_in_app:true,created_by:actor?.display_name||'Morpheus Command'}});
      toast('Reminder created');
    }else if(a.type==='create_draft'){
      if(!p)throw new Error('Prospect not found');
      await rpc('sales_os_save_email_draft',{p_token:token||null,p_payload:{prospect_id:p.id,recipient:p.contact_email||'',sender_name:actor?.display_name||'',sender_email:actor?.email||'',subject:a.payload?.subject||'',body:a.payload?.body||'',status:'draft',ai_assisted:true,provider:'morpheus_command',created_by:actor?.display_name||'Morpheus Command'}});
      toast('Draft saved');
    }else if(a.type==='update_next_action'){
      if(!p)throw new Error('Prospect not found');
      await rpc('sales_os_save_prospect',{p_token:token||null,p_payload:{id:p.id,next_action:a.payload?.text||a.label,next_action_date:a.payload?.date||null}});
      toast('Next action updated');
    }else if(a.type==='find_prospects'){
      a._done=true;renderCommandPlan();closeModal();await runDiscoveryFromCommand(a.payload||{});return;
    }
    a._done=true;await load();renderCommandPlan();
  }catch(e){toast('Could not run action: '+String(e.message||e))}
};
async function runDiscoveryFromCommand(payload){
  const category=String(payload.category||'').trim();if(!category)return openFindProspects();
  modal('Prospect discovery','<div id="discoveryResults"><div class="empty">Researching current public sources…</div></div>');
  const headers={'Content-Type':'application/json',apikey:APIKEY};if(sessionAccessToken)headers.Authorization='Bearer '+sessionAccessToken;else if(token)headers['x-sales-os-access-code']=token;
  const r=await fetch(SUPABASE_URL+'/functions/v1/sales-os-discovery',{method:'POST',headers,body:JSON.stringify({category,geography:payload.geography||'',target_count:Number(payload.target_count||20),criteria:payload.criteria||''})});
  const out=await r.json().catch(()=>({}));if(!r.ok){$('#discoveryResults').innerHTML='<div class="empty">'+esc(out.detail||out.error||'Discovery failed')+'</div>';return}
  const result=await rpc('sales_os_get_discovery_run',{p_token:token||null,p_run_id:out.run_id});renderDiscovery(result);
}

function manageCategories(){
  const cats=[...new Set(data.prospects.map(p=>p.category).filter(Boolean))].sort();modal('Categories','<div id="catList">'+cats.map(c=>'<div class="stack-item"><div class="main"><b>'+esc(c)+'</b><span>'+data.prospects.filter(p=>p.category===c).length+' prospects</span></div></div>').join('')+'</div><div class="field" style="margin-top:12px"><label>New category</label><input id="newCat" class="control"></div><button id="addCat" class="btn lime">Add category</button>');$('#addCat').onclick=async()=>{const name=$('#newCat').value.trim();if(!name)return;await rpc('sales_os_save_category',{p_token:token||null,p_payload:{name,active:true}});closeModal();await load();toast('Category added')}}
const CSV_HEADER_ALIASES={'company name':'company','business':'company','business name':'company','prospect':'company','market':'category','industry':'category','contact':'contact_name','contact person':'contact_name','decision maker':'contact_name','role':'contact_role','title':'contact_role','email':'contact_email','url':'website','site':'website','owner':'owner_assigned','assigned to':'owner_assigned','asset link':'asset_url','subject':'outreach_subject','message':'outreach_message'};
function cleanCsvHeader(x){return String(x||'').replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[\\/\-]+/g,' ').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim()}
function parseCsv(text){
  text=String(text||'').replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell=''}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(ch!=='\r')cell+=ch}
  if(cell.length||row.length){row.push(cell);rows.push(row)}if(!rows.length)return[];
  const headers=rows.shift().map(h=>CSV_HEADER_ALIASES[cleanCsvHeader(h)]||cleanCsvHeader(h).replaceAll(' ','_'));
  return rows.filter(r=>r.some(c=>String(c).trim())).map(r=>{const o={};headers.forEach((h,i)=>o[h]=String(r[i]??'').trim());return o});
}
function importCsv(){
  const cats=[...new Set(data.prospects.map(p=>p.category).filter(Boolean))].sort();
  modal('Import prospects','<div class="field"><label>Default category</label><select id="csvCategory" class="control"><option value="">Use CSV category</option>'+cats.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></div><div class="field"><label>Import mode</label><select id="csvMode" class="control"><option value="smart">Smart merge</option><option value="new_only">New companies only</option><option value="overwrite">Update existing</option></select></div><div class="field"><label>CSV file</label><input id="csvFile" class="control" type="file" accept=".csv,text/csv"></div><div id="csvPreview" class="quiet"></div>');
  $('#csvFile').onchange=async e=>{
    if(!e.target.files?.[0])return;const rows=parseCsv(await e.target.files[0].text()).filter(r=>r.company);
    $('#csvPreview').innerHTML='<p>'+rows.length+' valid company rows ready.</p><button id="runCsvImport" class="btn lime">Import '+rows.length+'</button>';
    $('#runCsvImport').onclick=async()=>{
      const normalized=rows.map(r=>({...r,tags:String(r.tags||'').split(/[|;]/).filter(Boolean),source_groups:String(r.source_groups||'').split(/[|;]/).filter(Boolean),source_notes:String(r.source_notes||'').split(/[|;]/).filter(Boolean)}));
      const res=await rpc('sales_os_bulk_import',{p_token:token||null,p_rows:normalized,p_mode:$('#csvMode').value,p_defaults:{category:$('#csvCategory').value,owner_assigned:'Yazeed',stage:'Research',status:'Not started',sender_name:'Robert Gibbons',sender_email:'robert@morpheuspd.io'}});
      closeModal();await load();route('#/prospects');toast((res.inserted||0)+' new · '+(res.updated||0)+' merged');
    };
  };
}
function requestNotifications(){if(!('Notification'in window))return toast('Notifications are not supported');Notification.requestPermission().then(p=>toast(p==='granted'?'Notifications enabled':'Permission not granted'))}

$$('[data-route]').forEach(b=>b.onclick=()=>route('#/'+b.dataset.route));
$('#mobileMore').onclick=openSheet;$$('[data-close-sheet]').forEach(x=>x.onclick=closeSheet);$$('[data-close-modal]').forEach(x=>x.onclick=closeModal);$$('[data-close-copilot]').forEach(x=>x.onclick=closeCopilot);
$('#modal').addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal()});$('#copilot').addEventListener('click',e=>{if(e.target.classList.contains('copilot-backdrop'))closeCopilot()});
$('#memberLoginBtn').onclick=memberLogin;$('#sharedLoginBtn').onclick=sharedLogin;$('#signOutBtn').onclick=signOut;$('#sheetSignOut').onclick=signOut;
$('#newProspectTop').onclick=openAddProspect;$('#commandNewProspect').onclick=openAddProspect;$('#addProspectBtn').onclick=openAddProspect;$('#findProspectsBtn').onclick=openFindProspects;$('#researchFindNew').onclick=openFindProspects;
$('#commandAskAI').onclick=()=>openCopilot();$('#mobileAI').onclick=()=>openCopilot();$('#newDraftBtn').onclick=openNewDraft;
$('#commandBar').addEventListener('submit',e=>{e.preventDefault();const q=$('#universalCommandInput').value.trim();if(q)runUniversalCommand(q)});
$$('[data-command]').forEach(b=>b.onclick=()=>{const q=b.dataset.command;$('#universalCommandInput').value=q;runUniversalCommand(q)});
$('#manageCategoriesBtn').onclick=manageCategories;$('#importCsvBtn').onclick=importCsv;$('#notificationsBtn').onclick=requestNotifications;
['prospectSearch','prospectCategory','prospectStage','prospectAssignee'].forEach(id=>$('#'+id)?.addEventListener(id==='prospectSearch'?'input':'change',renderProspects));
$('#globalSearch').addEventListener('input',()=>{if($('#globalSearch').value.trim())route('#/prospects');renderProspects()});
$('#copilotSend').onclick=sendCopilot;$('#copilotInput').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')sendCopilot()});
$('#topIdentity').onclick=()=>route('#/settings');

(async()=>{
  const last=localStorage.getItem('salesOsMemberEmail');if(last)$('#memberEmail').value=last;
  const ok=await trySession();if(!ok){const saved=localStorage.getItem('salesOsToken');if(saved)$('#accessCode').value=saved}else route(location.hash||'#/command',false);
  const gmailResult=new URLSearchParams(location.search).get('gmail');if(gmailResult==='connected'){history.replaceState({},'',location.pathname+location.hash);setTimeout(()=>toast('Gmail connected'),500)}
  const zohoResult=new URLSearchParams(location.search).get('zoho');if(zohoResult==='connected'){history.replaceState({},'',location.pathname+location.hash);setTimeout(()=>toast('Zoho Mail connected'),500)}
})().catch(()=>{});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
