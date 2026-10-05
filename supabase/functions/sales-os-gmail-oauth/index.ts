import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID=Deno.env.get("GOOGLE_CLIENT_ID")||"";
const GOOGLE_CLIENT_SECRET=Deno.env.get("GOOGLE_CLIENT_SECRET")||"";
const BASE=SUPABASE_URL+"/functions/v1/sales-os-gmail-oauth";
const RETURN="https://george.morpheuspd.io/sales-os-v4/?v=54#/settings";
const SCOPES=["openid","email","https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send"];
const cors={"access-control-allow-origin":"https://george.morpheuspd.io","access-control-allow-headers":"authorization,content-type,apikey","access-control-allow-methods":"POST,GET,OPTIONS"};
function json(x:any,status=200){return new Response(JSON.stringify(x),{status,headers:{...cors,"content-type":"application/json"}})}
function redirect(status:string,detail=""){const u=new URL(RETURN);u.searchParams.set("gmail",status);if(detail)u.searchParams.set("detail",detail.slice(0,180));return Response.redirect(u.toString(),302)}
async function member(req:Request,sb:any){
 const auth=req.headers.get("authorization")||"";
 if(!auth.toLowerCase().startsWith("bearer "))return null;
 const tok=auth.slice(7).trim();
 const u=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:{apikey:ANON,authorization:"Bearer "+tok}});
 if(!u.ok)return null;
 const user=await u.json();const email=String(user.email||"").toLowerCase();
 if(!email)return null;
 const {data:m}=await sb.from("sales_os_members").select("email,display_name,role,active").eq("email",email).eq("active",true).maybeSingle();
 return m||null;
}
function randomState(){const a=new Uint8Array(32);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 const sb=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
 const url=new URL(req.url);

 if(req.method==="POST"){
   const m=await member(req,sb);if(!m)return json({error:"member_sign_in_required"},401);
   if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET)return json({error:"google_oauth_not_configured"},503);
   const state=randomState();
   await sb.from("sales_os_google_oauth_states").delete().eq("member_email",m.email);
   const {error}=await sb.from("sales_os_google_oauth_states").insert({state,member_email:m.email,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
   if(error)return json({error:"state_create_failed",detail:error.message},500);
   const authUrl=new URL("https://accounts.google.com/o/oauth2/v2/auth");
   authUrl.searchParams.set("client_id",GOOGLE_CLIENT_ID);
   authUrl.searchParams.set("redirect_uri",BASE);
   authUrl.searchParams.set("response_type","code");
   authUrl.searchParams.set("scope",SCOPES.join(" "));
   authUrl.searchParams.set("access_type","offline");
   authUrl.searchParams.set("prompt","consent");
   authUrl.searchParams.set("include_granted_scopes","true");
   authUrl.searchParams.set("state",state);
   authUrl.searchParams.set("login_hint",m.email);
   return json({authorization_url:authUrl.toString(),redirect_uri:BASE});
 }

 if(req.method==="GET"&&url.searchParams.get("code")&&url.searchParams.get("state")){
   const state=url.searchParams.get("state")!,oauthError=url.searchParams.get("error");
   if(oauthError)return redirect("error",oauthError);
   const {data:st}=await sb.from("sales_os_google_oauth_states").select("*").eq("state",state).maybeSingle();
   if(!st||new Date(st.expires_at)<new Date())return redirect("error","oauth_state_expired");
   await sb.from("sales_os_google_oauth_states").delete().eq("state",state);

   const code=url.searchParams.get("code")!;
   const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({
     code,client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,redirect_uri:BASE,grant_type:"authorization_code"
   })});
   const td=await tr.json().catch(()=>({}));
   if(!tr.ok||!td.access_token)return redirect("error",td.error_description||td.error||"token_exchange_failed");
   if(!td.refresh_token)return redirect("error","No refresh token returned. Reconnect and approve offline access.");

   const pr=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile",{headers:{authorization:"Bearer "+td.access_token}});
   const pd=await pr.json().catch(()=>({}));
   if(!pr.ok||!pd.emailAddress)return redirect("error","gmail_profile_failed");
   const googleEmail=String(pd.emailAddress).toLowerCase();
   if(googleEmail!==String(st.member_email).toLowerCase())return redirect("error","Connect the same Gmail address as your Sales OS member account.");

   const {data:secretName,error:secretErr}=await sb.rpc("sales_os_store_gmail_secret",{p_member_email:st.member_email,p_refresh_token:td.refresh_token});
   if(secretErr)return redirect("error","Could not store Gmail token");
   await sb.from("sales_os_gmail_connections").upsert({
     member_email:st.member_email,google_email:googleEmail,secret_name:secretName,
     scopes:String(td.scope||SCOPES.join(" ")).split(" ").filter(Boolean),
     active:true,connected_at:new Date().toISOString(),updated_at:new Date().toISOString(),
     last_sync_status:"connected",last_sync_detail:"Gmail authorized"
   },{onConflict:"member_email"});
   await sb.from("sales_os_connections").update({status:"connected",account_label:googleEmail,updated_at:new Date().toISOString()}).eq("key","gmail");
   await sb.from("sales_os_audit_log").insert({
     actor_email:st.member_email,actor_name:st.member_email,actor_role:"member",action:"connect_provider",
     entity_type:"sales_os_gmail_connections",entity_id:st.member_email,summary:"Connected Gmail to Sales OS",source:"gmail_oauth"
   });
   return redirect("connected");
 }
 return json({error:"not_found"},404);
});
