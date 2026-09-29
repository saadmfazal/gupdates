const API='https://viajmvbwpmkiqxjtgshv.supabase.co/rest/v1/rpc/';
const APIKEY='sb_publishable_gGFZftPonWKNZCdvUSM3yQ_gZvyI6_H';
const STAGES=['Research','Asset ready','Ready to contact','Contacted','Follow-up','Replied','Qualified','Meeting','Proposal','Negotiation','Won','Lost','Hold'];
const PIPELINE_STAGES=['Research','Ready to contact','Follow-up','Replied','Qualified','Proposal'];
const CSV_COLUMNS=['company','category','segment','location','website','contact_name','contact_role','contact_email','phone','priority','score','owner_assigned','sender_name','sender_email','stage','status','next_action','next_action_date','caution','notes','tags','source_groups','source_notes','asset_type','asset_title','asset_url','asset_status','outreach_subject','outreach_message'];

let token='';
let data={prospects:[],assets:[],activities:[],templates:[],categories:[],notes:[],reminders:[],email_drafts:[],notifications:[],connections:[]};
let selectedProspect=null,currentDraft=null,currentPage='dashboard';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const todayISO=()=>new Date().toISOString().slice(0,10);
const dateTimeLocal=x=>{if(!x)return'';const d=new Date(x),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
const pill=s=>{const v=String(s||'Research');let c='';if(v==='Won')c='green';else if(['Lost','Hold'].includes(v))c='red';else if(['Follow-up','Ready to contact'].includes(v))c='amber';else if(['Replied','Qualified','Meeting'].includes(v))c='blue';return `<span class="pill ${c}">${esc(v)}</span>`};
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2200)}
async function rpc(fn,payload){const r=await fetch(API+fn,{method:'POST',headers:{apikey:APIKEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});const txt=await r.text();if(!r.ok)throw new Error(txt||`HTTP ${r.status}`);return txt?JSON.parse(txt):null}
function norm(){for(const k of ['prospects','assets','activities','templates','categories','notes','reminders','email_drafts','notifications','connections'])data[k]=Array.isArray(data[k])?data[k]:[]}

async function login(){
 const c=$('#accessCode').value.trim();$('#loginError').textContent='';
 try{const ok=await rpc('sales_os_verify',{p_token:c});if(!ok)throw new Error('denied');token=c;if($('#remember').checked)localStorage.setItem('salesOsToken',c);$('#login').classList.add('hidden');$('#app').classList.remove('hidden');await load()}
 catch(e){$('#loginError').textContent='Could not open Sales OS. Check the access code.'}
}
async function load(){data=await rpc('sales_os_snapshot',{p_token:token});norm();renderAll();$('#syncLabel').textContent='Last synced '+new Date(data.synced_at||Date.now()).toLocaleString();showDueBrowserNotifications()}
function renderAll(){renderCounts();renderDashboard();syncFilters();renderProspects();renderPipeline();renderEmail();renderAssets();renderReminders();renderNotes();renderCategories();renderConnections();renderNotifications()}
const categoryNames=()=>[...new Set([...data.categories.map(c=>c.name),...data.prospects.map(p=>p.category).filter(Boolean)])].sort();
const owners=()=>[...new Set(data.prospects.map(p=>p.owner_assigned).filter(Boolean))].sort();
const prospectName=id=>data.prospects.find(p=>p.id===id)?.company||'';
const pAssets=id=>data.assets.filter(a=>a.prospect_id===id);
const pNotes=id=>data.notes.filter(n=>n.prospect_id===id);
const pReminders=id=>data.reminders.filter(r=>r.prospect_id===id);
const pActivities=id=>data.activities.filter(a=>a.prospect_id===id).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
const isEngaged=p=>['Replied','Qualified','Meeting','Proposal','Negotiation','Won'].includes(p.stage);
const dueReminder=r=>r.status==='open'&&new Date(r.due_at)<=new Date();
const followupDue=p=>p.next_action_date&&p.next_action_date<=todayISO()&&!['Won','Lost','Hold'].includes(p.stage);

function renderCounts(){
 const drafts=data.email_drafts.filter(d=>d.status==='draft').length,openR=data.reminders.filter(r=>r.status==='open').length,due=data.reminders.filter(dueReminder).length+data.prospects.filter(followupDue).length;
 $('#navProspects').textContent=data.prospects.length;$('#navAssets').textContent=data.assets.length;$('#navDrafts').textContent=drafts;$('#navReminders').textContent=openR;
 $('#statProspects').textContent=data.prospects.filter(p=>!['Won','Lost'].includes(p.stage)).length;$('#statDue').textContent=due;$('#statDrafts').textContent=drafts;$('#statEngaged').textContent=data.prospects.filter(isEngaged).length;
 $('#notificationDot').classList.toggle('hidden',!data.notifications.some(n=>!n.read_at&&!n.dismissed_at));$('#todayDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
}
function renderDashboard(){
 const focus=[];
 data.reminders.filter(r=>r.status==='open').forEach(r=>focus.push({title:r.title,meta:(prospectName(r.prospect_id)||'General')+' · '+new Date(r.due_at).toLocaleString(),kind:'Reminder',due:new Date(r.due_at),pid:r.prospect_id}));
 data.prospects.filter(followupDue).forEach(p=>focus.push({title:p.next_action||'Follow up',meta:p.company+' · '+p.next_action_date,kind:'Follow-up',due:new Date(p.next_action_date),pid:p.id}));
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
 $('#prospectTable').innerHTML=filteredProspects().map(p=>`<tr><td><div class="company">${esc(p.company)}</div><div class="sub">${esc(p.location||p.segment||'')}</div></td><td>${esc(p.category||'General')}</td><td>${esc(p.contact_name||'')}<div class="sub">${esc(p.contact_email||'')}</div></td><td>${pAssets(p.id).length}</td><td>${esc(p.owner_assigned||'')}</td><td>${pill(p.stage)}</td><td>${p.next_action_date?`<span class="datechip">${esc(p.next_action_date)}</span>`:''}<div class="sub">${esc(p.next_action||'')}</div></td><td><button class="btn" onclick="openProspect('${p.id}')">Open</button></td></tr>`).join('');
}
function renderPipeline(){
 $('#kanban').innerHTML=PIPELINE_STAGES.map(s=>{const ps=data.prospects.filter(p=>p.stage===s);return`<section class="lane"><div class="lanehead"><span>${s}</span><span>${ps.length}</span></div>${ps.map(p=>`<div class="deal" onclick="openProspect('${p.id}')"><b>${esc(p.company)}</b><small>${esc(p.category||'')}</small>${p.next_action_date?`<div style="margin-top:7px"><span class="datechip">${esc(p.next_action_date)}</span></div>`:''}</div>`).join('')}</section>`}).join('');
}
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
 <div class="pageactions"><button class="btn" id="saveDraftBtn">Save</button><button class="btn" id="copyDraftBtn">Copy</button><button class="btn" id="openMailBtn">Open mail app</button><button class="btn green" id="directSendBtn">Send via Gmail</button></div><p class="meta" style="margin-top:10px">Direct Gmail sending activates only after the Gmail connection is authorized.</p>`;
 $('#saveDraftBtn').onclick=saveCurrentDraft;$('#copyDraftBtn').onclick=async()=>{await navigator.clipboard.writeText($('#edBody').value);toast('Copied')};$('#openMailBtn').onclick=()=>location.href=`mailto:${encodeURIComponent($('#edTo').value)}?subject=${encodeURIComponent($('#edSubject').value)}&body=${encodeURIComponent($('#edBody').value)}`;$('#aiDraftBtn').onclick=()=>openAIWriter(d.prospect_id);$('#directSendBtn').onclick=()=>handleDirectSend(d.id);
}
window.openDraft=id=>{currentDraft=data.email_drafts.find(d=>d.id===id);renderEmail()};
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
function renderNotifications(){
 const ns=data.notifications.filter(n=>!n.dismissed_at);$('#noticeList').innerHTML=ns.length?ns.slice(0,20).map(n=>`<div class="noticeitem ${n.read_at?'':'unread'}"><b>${esc(n.title)}</b><p>${esc(n.body||'')}</p><button class="btn" onclick="markNotice('${n.id}','read')">Read</button> <button class="btn" onclick="markNotice('${n.id}','dismiss')">Dismiss</button></div>`).join(''):'<div class="empty">You’re all caught up.</div>';
}

function go(page){currentPage=page;$$('[data-page-view]').forEach(s=>s.classList.toggle('hidden',s.dataset.pageView!==page));$$('.navitem[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$$('[data-mobile-page]').forEach(b=>b.classList.toggle('active',b.dataset.mobilePage===page));$('#noticeMenu').classList.add('hidden');if(page==='prospects')renderProspects();if(page==='email')renderEmail()}
function modal(title,body){$('#genericModalCard').innerHTML=`<div class="modalhead"><h2>${esc(title)}</h2><button class="close" onclick="closeModal()">×</button></div>${body}`;$('#genericModal').classList.remove('hidden')}
window.closeModal=()=>$('#genericModal').classList.add('hidden');

window.openProspect=id=>{
 selectedProspect=data.prospects.find(p=>p.id===id);if(!selectedProspect)return;const p=selectedProspect;
 $('#pdCompany').textContent=p.company;$('#pdCategory').textContent=p.category||'General';$('#pdMeta').textContent=[p.segment,p.location].filter(Boolean).join(' · ');
 $('#pdCategorySelect').innerHTML=categoryNames().map(x=>`<option>${esc(x)}</option>`).join('');$('#pdCategorySelect').value=p.category||'';$('#pdStage').innerHTML=STAGES.map(x=>`<option>${x}</option>`).join('');$('#pdStage').value=p.stage||'Research';
 $('#pdOwner').value=p.owner_assigned||'';$('#pdPriority').value=p.priority||'';$('#pdContact').value=p.contact_name||'';$('#pdEmail').value=p.contact_email||'';$('#pdWebsite').value=p.website||'';$('#pdLocation').value=p.location||'';$('#pdNextAction').value=p.next_action||'';$('#pdNextDate').value=p.next_action_date||'';
 $('#pdAssets').innerHTML=pAssets(id).map(a=>`<div class="focusrow"><div class="maincopy"><div class="title">${esc(a.title)}</div><div class="meta">${esc(a.asset_type)} · ${esc(a.status)}</div></div><button class="btn" onclick="editAsset('${a.id}')">Edit</button></div>`).join('')||'<div class="meta">No assets yet.</div>';
 $('#pdNotes').innerHTML=pNotes(id).map(n=>`<div class="noterow"><div><div class="title">${esc(n.title||'Note')}</div><div class="meta">${esc((n.body||'').slice(0,140))}</div></div></div>`).join('')||'<div class="meta">No notes yet.</div>';
 $('#pdReminders').innerHTML=pReminders(id).filter(r=>r.status==='open').map(r=>`<div class="reminderrow"><div class="maincopy"><div class="title">${esc(r.title)}</div><div class="meta">${new Date(r.due_at).toLocaleString()}</div></div></div>`).join('')||'<div class="meta">No open reminders.</div>';
 $('#pdActivity').innerHTML=pActivities(id).slice(0,20).map(a=>`<div class="activityrow"><div class="maincopy"><div class="title">${esc(a.activity_type||'Activity')}</div><div class="meta">${esc(a.subject||a.outcome||'')} · ${new Date(a.occurred_at).toLocaleDateString()}</div></div></div>`).join('')||'<div class="meta">No activity yet.</div>';
 $('#prospectDrawer').classList.remove('hidden');
};
async function saveProspect(){const p=selectedProspect;if(!p)return;await rpc('sales_os_save_prospect',{p_token:token,p_payload:{id:p.id,category:$('#pdCategorySelect').value,stage:$('#pdStage').value,owner_assigned:$('#pdOwner').value,priority:$('#pdPriority').value,contact_name:$('#pdContact').value,contact_email:$('#pdEmail').value,website:$('#pdWebsite').value,location:$('#pdLocation').value,next_action:$('#pdNextAction').value,next_action_date:$('#pdNextDate').value}});toast('Account updated');await load();openProspect(p.id)}
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
function handleDirectSend(){const d=currentDraft;if(!d)return;const p=data.prospects.find(x=>x.id===d.prospect_id);const prompt=`Use my connected Morpheus Sales OS and Gmail apps.

Open the Sales OS prospect "${p?.company||''}" and find the email draft with ID ${d.id}. Review the recipient, subject and body exactly as saved. If anything looks unsafe or incomplete, tell me instead of sending. Otherwise send that exact draft through my connected Gmail account, then call Sales OS mark_email_sent with the Gmail message ID so the CRM stays synchronized.`;navigator.clipboard.writeText(prompt).then(()=>{window.open('https://chatgpt.com/','_blank');toast('Send instruction copied — paste it into ChatGPT')})}
async function markNotice(id,action){await rpc('sales_os_set_notification_state',{p_token:token,p_id:id,p_action:action});await load()}
window.markNotice=markNotice;

function openConnection(key){
 if(key==='chatgpt'){
  const base='https://viajmvbwpmkiqxjtgshv.supabase.co/functions/v1/sales-os-mcp/mcp';
  const mcp=base+'?access_code='+encodeURIComponent(token);
  modal('Connect ChatGPT',`<div class="ai-box"><h3>Sales OS is ready to connect now</h3><p>Use the private MCP URL below in ChatGPT. It carries your current Sales OS team access code, so no extra OAuth setup is required for this private build.</p></div>
  <div style="margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:13px">
    <div class="title">1 · Copy the private MCP URL</div>
    <div class="meta" style="font-size:11px;line-height:1.7">Treat this URL like a password. Share it only with the Sales OS team.</div>
    <input id="mcpUrlCopy" class="input" readonly value="${esc(mcp)}" style="margin-top:7px">
    <button id="copyMcpBtn" class="btn primary" style="margin-top:8px">Copy MCP URL</button>
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
  $('#copyMcpBtn').onclick=async()=>{await navigator.clipboard.writeText(mcp);toast('Private MCP URL copied')};
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

$$('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));$$('[data-mobile-page]').forEach(b=>b.onclick=()=>go(b.dataset.mobilePage));$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
$('#loginBtn').onclick=login;$('#accessCode').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('#lockBtn').onclick=()=>{localStorage.removeItem('salesOsToken');location.reload()};
$('#notificationBtn').onclick=()=>$('#noticeMenu').classList.toggle('hidden');$('#globalSearch').oninput=()=>{renderProspects();if($('#globalSearch').value)go('prospects')};
['prospectSearch','prospectCategory','prospectStage','prospectOwner'].forEach(id=>$('#'+id).addEventListener(id==='prospectSearch'?'input':'change',renderProspects));
$('#quickProspectBtn').onclick=openProspectForm;$('#addProspectBtn').onclick=openProspectForm;$('#quickNoteBtn').onclick=()=>openNoteForm();$('#newNoteBtn').onclick=()=>openNoteForm();$('#newReminderBtn').onclick=()=>openReminderForm();$('#dashReminderBtn').onclick=()=>openReminderForm();$('#browserNotifyBtn').onclick=requestBrowserNotifications;
$('#newAssetBtn').onclick=()=>openAssetForm();$('#newEmailBtn').onclick=()=>openNewDraft();$('#categoryManagerBtn').onclick=openCategoryManager;$('#openImportBtn').onclick=openImporter;$('#categoryImportBtn').onclick=openImporter;$('#dashImportBtn').onclick=openImporter;$('#prospectImportBtn').onclick=openImporter;
$('#saveProspect').onclick=saveProspect;$('#pdNewAsset').onclick=()=>openAssetForm(selectedProspect?.id);$('#pdNewNote').onclick=()=>openNoteForm(selectedProspect?.id);$('#pdNewReminder').onclick=()=>openReminderForm(selectedProspect?.id);
$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).classList.add('hidden'));$('#genericModal').addEventListener('click',e=>{if(e.target.id==='genericModal')closeModal()});$('#prospectDrawer').addEventListener('click',e=>{if(e.target.id==='prospectDrawer')$('#prospectDrawer').classList.add('hidden')});
const saved=localStorage.getItem('salesOsToken');if(saved){$('#accessCode').value=saved;login()}
