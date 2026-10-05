import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE=SUPABASE_URL+"/functions/v1/sales-os-zoho-oauth";
const RETURN="https://george.morpheuspd.io/sales-os-v4/";
const SCOPES=[
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.messages.CREATE"
];
const ACCOUNTS_DOMAINS=new Set([
  "https://accounts.zoho.com",
  "https://accounts.zoho.eu",
  "https://accounts.zoho.in",
  "https://accounts.zoho.com.au",
  "https://accounts.zoho.jp",
  "https://accounts.zohocloud.ca",
  "https://accounts.zoho.sa"
]);
const cors={
  "access-control-allow-origin":"https://george.morpheuspd.io",
  "access-control-allow-headers":"authorization,content-type,apikey",
  "access-control-allow-methods":"POST,GET,OPTIONS"
};

function json(value:any,status=200){
  return new Response(JSON.stringify(value),{status,headers:{...cors,"content-type":"application/json"}});
}
function redirect(status:string,detail=""){
  const url=new URL(RETURN);
  url.searchParams.set("zoho",status);
  if(detail)url.searchParams.set("detail",detail.slice(0,180));
  return Response.redirect(url.toString(),302);
}
function allowedAccountsDomain(value:string){
  try{
    const origin=new URL(value).origin;
    return ACCOUNTS_DOMAINS.has(origin)?origin:"";
  }catch{return ""}
}
function mailDomainForAccounts(accountsDomain:string){
  const host=new URL(accountsDomain).hostname.replace(/^accounts\./,"mail.");
  return "https://"+host;
}
function allowedMailDomain(value:string){
  try{
    const url=new URL(value);
    return /^mail\.(zoho\.(com|eu|in|com\.au|jp|sa)|zohocloud\.ca)$/.test(url.hostname)?url.origin:"";
  }catch{return ""}
}
function randomState(){
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function member(req:Request,sb:any){
  const auth=req.headers.get("authorization")||"";
  if(!auth.toLowerCase().startsWith("bearer "))return null;
  const token=auth.slice(7).trim();
  const response=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:{apikey:ANON,authorization:"Bearer "+token}});
  if(!response.ok)return null;
  const user=await response.json();
  const email=String(user.email||"").toLowerCase();
  if(!email)return null;
  const {data}=await sb.from("sales_os_members").select("email,display_name,role,active").eq("email",email).eq("active",true).maybeSingle();
  return data||null;
}
async function serverSecret(sb:any,name:string){
  const {data,error}=await sb.rpc("sales_os_server_secret",{p_name:name});
  if(error)throw new Error("Could not read provider configuration");
  return String(data||"");
}
async function zohoRequest(url:string,accessToken:string){
  const response=await fetch(url,{headers:{accept:"application/json",authorization:"Zoho-oauthtoken "+accessToken}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||Number(data?.status?.code||200)>=400){
    throw new Error(data?.status?.description||data?.data?.errorCode||("Zoho HTTP "+response.status));
  }
  return data;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const sb=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  const url=new URL(req.url);

  if(req.method==="POST"){
    const activeMember=await member(req,sb);
    if(!activeMember)return json({error:"member_sign_in_required"},401);
    const body=await req.json().catch(()=>({}));
    const accountsDomain=allowedAccountsDomain(String(body.accounts_domain||""))||"https://accounts.zoho.com";
    const [clientId,clientSecret]=await Promise.all([
      serverSecret(sb,"sales_os_zoho_client_id"),
      serverSecret(sb,"sales_os_zoho_client_secret")
    ]);
    if(!clientId||!clientSecret)return json({error:"zoho_oauth_not_configured",redirect_uri:BASE},503);

    const state=randomState();
    await sb.from("sales_os_zoho_oauth_states").delete().eq("member_email",activeMember.email);
    const {error}=await sb.from("sales_os_zoho_oauth_states").insert({
      state,
      member_email:activeMember.email,
      accounts_domain:accountsDomain,
      expires_at:new Date(Date.now()+10*60*1000).toISOString()
    });
    if(error)return json({error:"state_create_failed",detail:error.message},500);

    const authUrl=new URL(accountsDomain+"/oauth/v2/auth");
    authUrl.searchParams.set("client_id",clientId);
    authUrl.searchParams.set("response_type","code");
    authUrl.searchParams.set("redirect_uri",BASE);
    authUrl.searchParams.set("scope",SCOPES.join(","));
    authUrl.searchParams.set("access_type","offline");
    authUrl.searchParams.set("prompt","consent");
    authUrl.searchParams.set("state",state);
    return json({authorization_url:authUrl.toString(),redirect_uri:BASE});
  }

  if(req.method==="GET"&&url.searchParams.get("state")){
    const state=url.searchParams.get("state")!;
    const {data:oauthState}=await sb.from("sales_os_zoho_oauth_states").select("*").eq("state",state).maybeSingle();
    if(!oauthState||new Date(oauthState.expires_at)<new Date())return redirect("error","oauth_state_expired");
    await sb.from("sales_os_zoho_oauth_states").delete().eq("state",state);

    const oauthError=url.searchParams.get("error");
    if(oauthError)return redirect("error",oauthError);
    const code=url.searchParams.get("code");
    if(!code)return redirect("error","authorization_code_missing");

    const callbackDomain=allowedAccountsDomain(url.searchParams.get("accounts-server")||"");
    const accountsDomain=callbackDomain||allowedAccountsDomain(oauthState.accounts_domain)||"https://accounts.zoho.com";
    const [clientId,clientSecret]=await Promise.all([
      serverSecret(sb,"sales_os_zoho_client_id"),
      serverSecret(sb,"sales_os_zoho_client_secret")
    ]);
    if(!clientId||!clientSecret)return redirect("error","zoho_oauth_not_configured");

    const tokenResponse=await fetch(accountsDomain+"/oauth/v2/token",{
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({
        code,
        grant_type:"authorization_code",
        client_id:clientId,
        client_secret:clientSecret,
        redirect_uri:BASE
      })
    });
    const tokenData=await tokenResponse.json().catch(()=>({}));
    if(!tokenResponse.ok||!tokenData.access_token){
      return redirect("error",tokenData.error_description||tokenData.error||"token_exchange_failed");
    }

    let mailApiDomain=mailDomainForAccounts(accountsDomain);
    const accounts=await zohoRequest(mailApiDomain+"/api/accounts",String(tokenData.access_token));
    const account=(accounts.data||[]).find((item:any)=>item.enabled!==false&&item.mailboxStatus!=="disabled")||(accounts.data||[])[0];
    if(!account?.accountId)return redirect("error","zoho_mail_account_not_found");
    const uriOrigin=allowedMailDomain(String(account.URI||""));
    if(uriOrigin)mailApiDomain=uriOrigin;
    const zohoEmail=String(account.primaryEmailAddress||account.mailboxAddress||account.incomingUserName||"").toLowerCase();
    if(!zohoEmail)return redirect("error","zoho_mail_address_not_found");

    let secretName="";
    if(tokenData.refresh_token){
      const stored=await sb.rpc("sales_os_store_zoho_secret",{
        p_member_email:oauthState.member_email,
        p_refresh_token:String(tokenData.refresh_token)
      });
      if(stored.error)return redirect("error","could_not_store_zoho_token");
      secretName=String(stored.data||"");
    }else{
      const existing=await sb.from("sales_os_zoho_connections").select("secret_name").eq("member_email",oauthState.member_email).maybeSingle();
      secretName=String(existing.data?.secret_name||"");
      if(!secretName)return redirect("error","No refresh token returned. Reconnect and approve offline access.");
    }

    const scopes=String(tokenData.scope||SCOPES.join(",")).split(/[,\s]+/).filter(Boolean);
    const connectedAt=new Date().toISOString();
    const {error:connectionError}=await sb.from("sales_os_zoho_connections").upsert({
      member_email:oauthState.member_email,
      zoho_email:zohoEmail,
      account_id:String(account.accountId),
      accounts_domain:accountsDomain,
      mail_api_domain:mailApiDomain,
      secret_name:secretName,
      scopes,
      active:true,
      connected_at:connectedAt,
      updated_at:connectedAt,
      last_sync_status:"connected",
      last_sync_detail:"Zoho Mail authorized",
      metadata:{location:url.searchParams.get("location")||null,api_domain:tokenData.api_domain||null}
    },{onConflict:"member_email"});
    if(connectionError)return redirect("error","could_not_save_zoho_connection");

    await sb.from("sales_os_connections").update({
      status:"connected",
      account_label:zohoEmail,
      updated_at:connectedAt
    }).eq("key","zoho_mail");
    await sb.from("sales_os_audit_log").insert({
      actor_email:oauthState.member_email,
      actor_name:oauthState.member_email,
      actor_role:"member",
      action:"connect_provider",
      entity_type:"sales_os_zoho_connections",
      entity_id:oauthState.member_email,
      summary:"Connected Zoho Mail to Sales OS",
      after_data:{zoho_email:zohoEmail,account_id:String(account.accountId),accounts_domain:accountsDomain},
      source:"zoho_oauth"
    });
    return redirect("connected");
  }

  return json({error:"not_found"},404);
});
