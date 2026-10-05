import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors={
  "access-control-allow-origin":"https://george.morpheuspd.io",
  "access-control-allow-headers":"authorization,content-type,apikey,x-cron-secret",
  "access-control-allow-methods":"POST,OPTIONS"
};

function json(value:any,status=200){
  return new Response(JSON.stringify(value),{status,headers:{...cors,"content-type":"application/json"}});
}
async function authMember(req:Request,sb:any){
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
async function cronAllowed(req:Request,sb:any){
  const supplied=req.headers.get("x-cron-secret")||"";
  if(!supplied)return false;
  const {data}=await sb.rpc("sales_os_server_secret",{p_name:"sales_os_zoho_cron_secret"});
  return !!data&&supplied===String(data);
}
async function serverSecret(sb:any,name:string){
  const {data,error}=await sb.rpc("sales_os_server_secret",{p_name:name});
  if(error)throw new Error("Could not read Zoho provider configuration");
  return String(data||"");
}
async function refreshAccess(sb:any,connection:any,refreshToken:string){
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
async function zohoGet(connection:any,accessToken:string,path:string){
  const response=await fetch(String(connection.mail_api_domain)+path,{
    headers:{accept:"application/json",authorization:"Zoho-oauthtoken "+accessToken}
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
function plainText(value:any){
  return String(value||"")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/\s+/g," ")
    .trim();
}
function messageTime(message:any){
  const raw=Number(message.receivedTime||message.sentDateInGMT||message.sentDate||0);
  if(Number.isFinite(raw)&&raw>0){
    const date=new Date(raw<100000000000?raw*1000:raw);
    if(!Number.isNaN(date.getTime()))return date.toISOString();
  }
  return new Date().toISOString();
}
function classify(direction:string,subject:string,body:string,from:string){
  if(direction==="outbound")return {classification:"sent",requires_action:false};
  const text=(subject+"\n"+body+"\n"+from).toLowerCase();
  if(/mailer-daemon|delivery status|undeliver|delivery failed|address not found/.test(text))return {classification:"delivery_problem",requires_action:true};
  if(/out of office|automatic reply|auto.?reply|vacation/.test(text))return {classification:"out_of_office",requires_action:false};
  if(/not interested|no thanks|do not contact|remove me|unsubscribe/.test(text))return {classification:"declined",requires_action:true};
  if(/\bmoq\b|minimum order|minimum quantity/.test(text))return {classification:"moq_question",requires_action:true};
  if(/price|pricing|quote|cost|how much/.test(text))return {classification:"pricing_request",requires_action:true};
  if(/meeting|zoom|call me|schedule|calendar|available.*(am|pm)/.test(text))return {classification:"meeting_request",requires_action:true};
  if(/interested|sounds good|tell me more|learn more|let's discuss|lets discuss/.test(text))return {classification:"interested",requires_action:true};
  return {classification:"general_reply",requires_action:true};
}

async function syncOne(sb:any,connection:any){
  const {data:refresh,error:refreshError}=await sb.rpc("sales_os_get_zoho_secret",{p_member_email:connection.member_email});
  if(refreshError||!refresh)throw new Error("Missing Zoho refresh token");
  const accessToken=await refreshAccess(sb,connection,String(refresh));
  const account=String(connection.zoho_email||"").toLowerCase();
  if(!account||!connection.account_id)throw new Error("Zoho mailbox identity is incomplete");

  const {data:prospects}=await sb.from("sales_os_prospects").select("id,company,contact_email,owner_assigned,stage,next_action,next_action_date").not("contact_email","is",null);
  const prospectByEmail=new Map<string,any>();
  for(const prospect of prospects||[]){
    const email=String(prospect.contact_email||"").trim().toLowerCase();
    if(email)prospectByEmail.set(email,prospect);
  }
  if(!prospectByEmail.size)return {account,matched:0,imported:0,inbound:0,outbound:0,skipped:0};

  const foldersResponse=await zohoGet(connection,accessToken,"/api/accounts/"+encodeURIComponent(connection.account_id)+"/folders");
  const folders=(foldersResponse.data||[]).filter((folder:any)=>["inbox","sent"].includes(String(folder.folderType||folder.folderName||"").toLowerCase()));
  if(!folders.length)throw new Error("Zoho Inbox and Sent folders were not found");

  const since=connection.last_sync_at
    ?new Date(new Date(connection.last_sync_at).getTime()-2*86400000)
    :new Date(Date.now()-45*86400000);
  const candidates:any[]=[];
  for(const folder of folders){
    const query=new URLSearchParams({
      folderId:String(folder.folderId),
      start:"1",
      limit:"200",
      status:"all",
      sortBy:"date",
      sortorder:"false",
      includeto:"true"
    });
    const listed=await zohoGet(connection,accessToken,"/api/accounts/"+encodeURIComponent(connection.account_id)+"/messages/view?"+query.toString());
    for(const message of listed.data||[]){
      if(new Date(messageTime(message))>=since)candidates.push({...message,_folderType:String(folder.folderType||folder.folderName||"")});
    }
  }

  let imported=0,inbound=0,outbound=0,skipped=0,matched=0;
  const seen=new Set<string>();
  for(const message of candidates.sort((a,b)=>new Date(messageTime(b)).getTime()-new Date(messageTime(a)).getTime()).slice(0,400)){
    const providerMessageId=String(message.messageId||"");
    if(!providerMessageId||seen.has(providerMessageId)){skipped++;continue}
    seen.add(providerMessageId);
    try{
      const fromList=emails(String(message.fromAddress||""));
      const toList=emails(String(message.toAddress||""));
      const ccList=emails(String(message.ccAddress||""));
      const direction=fromList.includes(account)?"outbound":"inbound";
      const counterpart=[...fromList,...toList,...ccList].find(email=>email!==account&&prospectByEmail.has(email));
      if(!counterpart){skipped++;continue}
      matched++;
      const prospect=prospectByEmail.get(counterpart);
      const folderId=String(message.folderId||"");
      let body="";
      if(folderId){
        const content=await zohoGet(connection,accessToken,
          "/api/accounts/"+encodeURIComponent(connection.account_id)+
          "/folders/"+encodeURIComponent(folderId)+
          "/messages/"+encodeURIComponent(providerMessageId)+"/content"
        );
        body=plainText(content?.data?.content||content?.data?.blockContent||content?.data?.messageContent||"");
      }
      const subject=String(message.subject||"");
      const snippet=plainText(message.summary||body).slice(0,1000);
      const sentAt=messageTime(message);
      const classification=classify(direction,subject,body,fromList[0]||"");
      const threadId=String(message.threadId||providerMessageId);
      const row={
        prospect_id:prospect.id,
        provider:"zoho_mail",
        provider_message_id:providerMessageId,
        provider_thread_id:threadId,
        direction,
        from_email:fromList[0]||"",
        to_emails:toList,
        cc_emails:ccList,
        subject,
        snippet,
        body:String(body||"").slice(0,20000),
        sent_at:sentAt,
        labels:[String(message._folderType||"").toUpperCase()].filter(Boolean),
        has_attachment:String(message.hasAttachment||"0")==="1"||message.hasAttachment===true,
        classification:classification.classification,
        requires_action:classification.requires_action,
        metadata:{synced_by:"native_zoho_mail",zoho_account:account,folder_id:folderId}
      };
      await sb.from("sales_os_email_messages").upsert(row,{onConflict:"provider,provider_message_id"});
      await sb.from("sales_os_inbox_thread_state").upsert({
        provider:"zoho_mail",
        provider_thread_id:threadId,
        prospect_id:prospect.id,
        status:direction==="inbound"?"open":"waiting",
        classification:classification.classification,
        summary:snippet||subject,
        assigned_to:prospect.owner_assigned||connection.member_email,
        next_action:direction==="inbound"&&classification.requires_action?"Review reply and respond":prospect.next_action,
        next_action_date:direction==="inbound"&&classification.requires_action?new Date().toISOString().slice(0,10):prospect.next_action_date,
        last_message_at:sentAt,
        last_direction:direction,
        unread_count:direction==="inbound"?1:0,
        last_synced_at:new Date().toISOString()
      },{onConflict:"provider,provider_thread_id"});

      const activityLookup=await sb.from("sales_os_activities").select("id").eq("external_ref",providerMessageId).eq("source","Zoho Mail sync").maybeSingle();
      if(!activityLookup.data){
        await sb.from("sales_os_activities").insert({
          prospect_id:prospect.id,
          activity_type:direction==="inbound"?"Reply":"Sent",
          channel:"Email",
          direction:direction==="inbound"?"Inbound":"Outbound",
          subject,
          message:snippet||row.body,
          actor_email:direction==="inbound"?(fromList[0]||""):account,
          recipient:direction==="inbound"?account:(toList[0]||""),
          occurred_at:sentAt,
          outcome:classification.classification,
          source:"Zoho Mail sync",
          external_ref:providerMessageId
        });
      }

      if(direction==="inbound"){
        inbound++;
        if(classification.classification!=="out_of_office"){
          await sb.from("sales_os_prospects").update({
            stage:prospect.stage==="Lost"||prospect.stage==="Won"?prospect.stage:"Replied",
            next_action:classification.requires_action?"Review reply and respond":prospect.next_action,
            next_action_date:classification.requires_action?new Date().toISOString().slice(0,10):prospect.next_action_date
          }).eq("id",prospect.id);
        }
        if(classification.requires_action){
          const existingRecommendation=await sb.from("sales_os_recommendations").select("id").eq("source_provider","zoho_mail").eq("source_ref",providerMessageId).eq("status","open").maybeSingle();
          if(!existingRecommendation.data){
            await sb.from("sales_os_recommendations").insert({
              prospect_id:prospect.id,
              recommendation_type:"reply_followup",
              title:"Review reply from "+prospect.company,
              rationale:"A new prospect email was synchronized from Zoho Mail.",
              suggested_action:"Review the thread and prepare an appropriate response.",
              priority:classification.classification==="delivery_problem"?"high":"normal",
              status:"open",
              source_provider:"zoho_mail",
              source_ref:providerMessageId,
              due_at:new Date().toISOString(),
              created_by:"Native Zoho Mail sync"
            });
          }
        }
      }else outbound++;
      imported++;
    }catch(_){skipped++}
  }

  const now=new Date().toISOString();
  await sb.from("sales_os_zoho_connections").update({
    last_sync_at:now,
    last_sync_status:"success",
    last_sync_detail:imported+" matched messages · "+inbound+" inbound · "+outbound+" outbound",
    updated_at:now
  }).eq("member_email",connection.member_email);
  return {account,matched,imported,inbound,outbound,skipped};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const sb=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  const [activeMember,cron]=await Promise.all([authMember(req,sb),cronAllowed(req,sb)]);
  if(!activeMember&&!cron)return json({error:"unauthorized"},401);

  let query=sb.from("sales_os_zoho_connections").select("*").eq("active",true);
  if(activeMember)query=query.eq("member_email",activeMember.email);
  const {data:connections,error}=await query;
  if(error)return json({error:error.message},500);
  const results:any[]=[];
  for(const connection of connections||[]){
    try{
      results.push({member_email:connection.member_email,ok:true,...await syncOne(sb,connection)});
    }catch(error){
      const now=new Date().toISOString();
      await sb.from("sales_os_zoho_connections").update({
        last_sync_at:now,
        last_sync_status:"error",
        last_sync_detail:String((error as any)?.message||error).slice(0,500),
        updated_at:now
      }).eq("member_email",connection.member_email);
      results.push({member_email:connection.member_email,ok:false,error:String((error as any)?.message||error)});
    }
  }
  return json({ok:results.every(result=>result.ok),connections:results});
});
