import { createClient } from "../sales-os-v4/vendor/supabase-auth.js?v=56";

const SUPABASE_URL="https://viajmvbwpmkiqxjtgshv.supabase.co";
const PUBLISHABLE_KEY="sb_publishable_gGFZftPonWKNZCdvUSM3yQ_gZvyI6_H";
const BOOTSTRAP=SUPABASE_URL+"/functions/v1/sales-os-auth-bootstrap";
const AUTHORIZE=SUPABASE_URL+"/functions/v1/sales-os-mcp/authorize";
const supabase=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
const params=new URLSearchParams(location.search);
const allowedFields=["response_type","client_id","redirect_uri","scope","state","code_challenge","code_challenge_method","resource"];
const requiredFields=["response_type","client_id","redirect_uri","code_challenge","code_challenge_method","resource"];
const $=id=>document.getElementById(id);

function show(id){
  ["signin","authorization","requestError"].forEach(name=>$(name).classList.toggle("hidden",name!==id));
}

function requestError(message){
  $("requestErrorText").textContent=message;
  show("requestError");
}

async function activeMember(session){
  const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/sales_os_whoami",{
    method:"POST",
    headers:{"content-type":"application/json",apikey:PUBLISHABLE_KEY,authorization:"Bearer "+session.access_token},
    body:JSON.stringify({p_token:null})
  });
  if(!response.ok)return null;
  return await response.json();
}

function renderRequest(member){
  $("clientName").textContent=params.get("client_name")||"ChatGPT MCP Client";
  $("returnHost").textContent="Returns securely to "+(params.get("return_host")||"chatgpt.com");
  $("memberIdentity").textContent="Signed in as "+(member?.display_name||member?.email||"Sales OS member");
  const labels={
    "sales_os.read":"Read Sales OS prospects, pipeline, research, assets and activity",
    "sales_os.write":"Create and update approved Sales OS work",
    "offline_access":"Stay connected securely using rotating refresh tokens"
  };
  $("scopes").replaceChildren();
  for(const scope of (params.get("scope")||"").split(/\s+/).filter(Boolean)){
    const item=document.createElement("div");item.className="scope";item.textContent=labels[scope]||scope;$("scopes").appendChild(item);
  }
  show("authorization");
}

async function begin(){
  const requestFailure=params.get("authorization_error")||"";
  if(!requiredFields.every(name=>params.get(name))){requestError(requestFailure||"The OAuth authorization request is missing or no longer valid.");return}
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){show("signin");return}
  const member=await activeMember(session);
  if(!member){await supabase.auth.signOut({scope:"local"}).catch(()=>{});show("signin");return}
  renderRequest(member);
}

async function requestLogin(){
  const email=$("signinEmail").value.trim();
  $("signinBtn").disabled=true;$("signinBtn").textContent="Requesting link.";
  try{
    const response=await fetch(BOOTSTRAP,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,return_url:location.href})});
    const result=await response.json().catch(()=>({}));
    $("signinStatus").textContent=result.message||"If this is an active Sales OS profile, a secure sign-in link will arrive shortly.";
  }catch{$("signinStatus").textContent="If this is an active Sales OS profile, a secure sign-in link will arrive shortly."}
  finally{$("signinBtn").disabled=false;$("signinBtn").textContent="Email secure sign-in link"}
}

async function decide(decision){
  document.querySelectorAll("button").forEach(button=>button.disabled=true);
  try{
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){show("signin");return}
    const body=new URLSearchParams();
    for(const name of allowedFields)body.set(name,params.get(name)||"");
    body.set("decision",decision);
    const response=await fetch(AUTHORIZE,{method:"POST",headers:{accept:"application/json","content-type":"application/x-www-form-urlencoded",authorization:"Bearer "+session.access_token},body});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.redirect_to)throw new Error("Authorization could not continue.");
    location.assign(result.redirect_to);
  }catch(error){
    $("authError").textContent=String(error?.message||error);$("authError").classList.remove("hidden");
    document.querySelectorAll("button").forEach(button=>button.disabled=false);
  }
}

$("signinBtn").addEventListener("click",requestLogin);
$("approveBtn").addEventListener("click",()=>decide("approve"));
$("denyBtn").addEventListener("click",()=>decide("deny"));
begin().catch(()=>requestError("Connection could not continue. Start the connection again from ChatGPT."));

