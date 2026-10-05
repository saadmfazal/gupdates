import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors={
  "access-control-allow-origin":"https://george.morpheuspd.io",
  "access-control-allow-headers":"authorization,content-type,apikey",
  "access-control-allow-methods":"POST,OPTIONS"
};

function json(value:any,status=200){
  return new Response(JSON.stringify(value),{status,headers:{...cors,"content-type":"application/json"}});
}
async function member(req:Request,sb:any){
  const auth=req.headers.get("authorization")||"";
  if(!auth.toLowerCase().startsWith("bearer "))return null;
  const response=await fetch(SUPABASE_URL+"/auth/v1/user",{
    headers:{apikey:ANON,authorization:"Bearer "+auth.slice(7).trim()}
  });
  if(!response.ok)return null;
  const user=await response.json();
  const email=String(user.email||"").toLowerCase();
  if(!email)return null;
  const {data}=await sb.from("sales_os_members").select("email,display_name,role,active").eq("email",email).eq("active",true).maybeSingle();
  return data||null;
}
async function serverSecret(sb:any,name:string){
  const {data,error}=await sb.rpc("sales_os_server_secret",{p_name:name});
  if(error)throw new Error("Could not read Zoho provider configuration");
  return String(data||"");
}
async function accessToken(sb:any,connection:any,refreshToken:string){
  const [clientId,clientSecret]=await Promise.all([
    serverSecret(sb,"sales_os_zoho_client_id"),
    serverSecret(sb,"sales_os_zoho_client_secret")
  ]);
  if(!clientId||!clientSecret)throw new Error("Zoho OAuth credentials are not configured");
  const response=await fetch(String(connection.accounts_domain)+"/oauth/v2/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      refresh_token:refreshToken,
      grant_type:"refresh_token",
      client_id:clientId,
      client_secret:clientSecret
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)throw new Error(data.error_description||data.error||"Zoho token refresh failed");
  return String(data.access_token);
}
async function sendZoho(connection:any,accessToken:string,path:string,payload:any){
  const response=await fetch(String(connection.mail_api_domain)+path,{
    method:"POST",
    headers:{
      accept:"application/json",
      "content-type":"application/json",
      authorization:"Zoho-oauthtoken "+accessToken
    },
    body:JSON.stringify(payload)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||Number(data?.status?.code||200)>=400){
    throw new Error(data?.status?.description||data?.data?.errorCode||("Zoho HTTP "+response.status));
  }
  return data;
}
function emails(value:string){
  const found:string[]=[];
  const pattern=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let match;
  while((match=pattern.exec(value||"")))found.push(match[0].toLowerCase());
  return [...new Set(found)];
}

function senderIdentities(connection:any){
  const configured=Array.isArray(connection?.metadata?.sender_identities)?connection.metadata.sender_identities:[];
  const source=configured.length?configured:[{email:connection?.zoho_email,display_name:""}];
  const seen=new Set<string>();
  return source.map((item:any)=>({
    email:String(item?.email||"").trim().toLowerCase(),
    display_name:String(item?.display_name||"").trim()
  })).filter((item:any)=>item.email&&item.email.includes("@")&&!seen.has(item.email)&&!!seen.add(item.email));
}
async function availableZohoSenders(connection:any,accessToken:string){
  const response=await fetch(String(connection.mail_api_domain)+"/api/accounts",{
    headers:{accept:"application/json",authorization:"Zoho-oauthtoken "+accessToken}
  });
  if(!response.ok)return[];
  const data=await response.json().catch(()=>({}));
  const account=(data?.data||[]).find((item:any)=>String(item?.accountId||"")===String(connection.account_id||""));
  const details=Array.isArray(account?.sendMailDetails)?account.sendMailDetails:[];
  return [...new Set(details.map((item:any)=>String(item?.fromAddress||"").trim().toLowerCase()).filter(Boolean))];
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const sb=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  const activeMember=await member(req,sb);
  if(!activeMember)return json({error:"member_sign_in_required"},401);

  const body=await req.json().catch(()=>({}));
  const draftId=String(body.draft_id||"");
  if(!draftId)return json({error:"draft_id_required"},400);
  const {data:draft}=await sb.from("sales_os_email_drafts").select("*").eq("id",draftId).maybeSingle();
  if(!draft)return json({error:"draft_not_found"},404);
  if(draft.status==="sent")return json({error:"draft_already_sent"},409);
  if(!String(draft.recipient||"").trim()||!String(draft.subject||"").trim()||!String(draft.body||"").trim()){
    return json({error:"draft_incomplete"},400);
  }

  const {data:connection}=await sb.from("sales_os_zoho_connections").select("*").eq("member_email",activeMember.email).eq("active",true).maybeSingle();
  if(!connection)return json({error:"zoho_mail_not_connected"},409);
  const {data:refresh}=await sb.rpc("sales_os_get_zoho_secret",{p_member_email:activeMember.email});
  if(!refresh)return json({error:"zoho_refresh_token_missing"},409);
  const account=String(connection.zoho_email||"").toLowerCase();
  if(!account||!connection.account_id)return json({error:"zoho_mailbox_identity_incomplete"},409);

  const identities=senderIdentities(connection);
  const requestedSender=String(draft.sender_email||connection?.metadata?.default_sender_email||account).trim().toLowerCase();
  const sender=identities.find((item:any)=>item.email===requestedSender);
  if(!sender)return json({error:"zoho_sender_not_allowed",detail:"Choose an approved From address for this mailbox."},409);

  const access=await accessToken(sb,connection,String(refresh));
  const providerSenders=await availableZohoSenders(connection,access);
  if(providerSenders.length&&!providerSenders.includes(sender.email)){
    return json({error:"zoho_sender_not_available",detail:"This From address is not enabled in Zoho Mail."},409);
  }

  const payload:any={
    fromAddress:sender.email,
    toAddress:String(draft.recipient||""),
    ccAddress:String(draft.cc||""),
    subject:String(draft.subject||""),
    content:String(draft.body||""),
    mailFormat:"plaintext",
    encoding:"UTF-8",
    askReceipt:"no"
  };
  const canReply=draft.provider==="zoho_mail"&&!!draft.reply_to_message_id;
  if(canReply)payload.action="reply";
  const path="/api/accounts/"+encodeURIComponent(connection.account_id)+"/messages"+
    (canReply?"/"+encodeURIComponent(String(draft.reply_to_message_id)):"");
  const sent=await sendZoho(connection,access,path,payload);
  const returnedId=sent?.data?.messageId||sent?.data?.mailId||sent?.data?.id||sent?.messageId||"";
  const providerMessageId=String(returnedId||("salesos:"+crypto.randomUUID()));
  const awaitingProviderId=!returnedId;
  const threadId=String(sent?.data?.threadId||draft.provider_thread_id||providerMessageId);
  const sentAt=new Date().toISOString();

  await sb.from("sales_os_email_drafts").update({
    status:"sent",
    sent_at:sentAt,
    external_message_id:providerMessageId,
    provider:"zoho_mail",
    provider_thread_id:threadId,
    sender_email:sender.email,
    sender_name:sender.display_name||draft.sender_name
  }).eq("id",draft.id);
  await sb.from("sales_os_email_messages").upsert({
    prospect_id:draft.prospect_id,
    provider:"zoho_mail",
    provider_message_id:providerMessageId,
    provider_thread_id:threadId,
    direction:"outbound",
    from_email:sender.email,
    to_emails:emails(String(draft.recipient||"")),
    cc_emails:emails(String(draft.cc||"")),
    subject:draft.subject,
    body:draft.body,
    snippet:String(draft.body||"").slice(0,1000),
    sent_at:sentAt,
    labels:["SENT"],
    has_attachment:false,
    classification:"sent",
    requires_action:false,
    metadata:{
      sent_by:"native_sales_os",
      member_email:activeMember.email,
      zoho_account:account,
      from_address:sender.email,
      awaiting_provider_id:awaitingProviderId
    }
  },{onConflict:"provider,provider_message_id"});
  await sb.from("sales_os_inbox_thread_state").upsert({
    provider:"zoho_mail",
    provider_thread_id:threadId,
    prospect_id:draft.prospect_id,
    status:"waiting",
    classification:"sent",
    summary:String(draft.body||"").slice(0,1000),
    assigned_to:activeMember.display_name||activeMember.email,
    last_message_at:sentAt,
    last_direction:"outbound",
    unread_count:0,
    last_synced_at:sentAt
  },{onConflict:"provider,provider_thread_id"});
  await sb.from("sales_os_activities").insert({
    prospect_id:draft.prospect_id,
    activity_type:"Sent",
    channel:"Email",
    direction:"Outbound",
    subject:draft.subject,
    message:draft.body,
    actor_name:activeMember.display_name||activeMember.email,
    actor_email:activeMember.email,
    recipient:draft.recipient,
    occurred_at:sentAt,
    outcome:"Sent / awaiting reply",
    source:"Sales OS Zoho Mail",
    external_ref:providerMessageId
  });
  await sb.from("sales_os_audit_log").insert({
    actor_email:activeMember.email,
    actor_name:activeMember.display_name||activeMember.email,
    actor_role:activeMember.role,
    action:"email_sent",
    entity_type:"sales_os_email_drafts",
    entity_id:draft.id,
    prospect_id:draft.prospect_id,
    summary:"Sent approved email via Zoho Mail: "+(draft.subject||"(No subject)"),
    after_data:{
      provider_message_id:providerMessageId,
      thread_id:threadId,
      recipient:draft.recipient,
      provider:"zoho_mail",
      from_address:sender.email,
      awaiting_provider_id:awaitingProviderId
    },
    source:"native_zoho_mail"
  });
  return json({ok:true,message_id:providerMessageId,thread_id:threadId,sent_at:sentAt,from_address:sender.email,awaiting_provider_id:awaitingProviderId});
});
