import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_URL = SUPABASE_URL + "/functions/v1/sales-os-mcp";
const RESOURCE_URL = FUNCTION_URL + "/mcp";
const META_URL = FUNCTION_URL + "/oauth-protected-resource";
// Keep the authorization-server issuer on the same authority as every OAuth
// endpoint. ChatGPT validates this relationship before attempting DCR and will
// reject a metadata document whose issuer is on a different host even when the
// advertised endpoints themselves are otherwise reachable.
const ISSUER = FUNCTION_URL;
const AUTHORIZATION_ENDPOINT = FUNCTION_URL + "/authorize";
const TOKEN_ENDPOINT = FUNCTION_URL + "/token";
const REGISTRATION_ENDPOINT = FUNCTION_URL + "/register";
// Supabase Edge Functions intentionally serve HTML returned by GET requests as
// text/plain. Keep validation and credential handling in this function, while
// hosting the browser-facing consent form on the existing Morpheus site.
const AUTHORIZATION_UI_URL = "https://george.morpheuspd.io/sales-os-oauth/";
const OAUTH_SCOPES = ["sales_os.read", "sales_os.write", "offline_access"];
const DEFAULT_SCOPE = OAUTH_SCOPES.join(" ");
const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "mcp-session-id, www-authenticate",
};

function json(data: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", ...extra } });
}

function rpcResult(id: unknown, result: unknown) {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return json({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }, 200);
}

function oauthJson(data: unknown, status = 200) {
  return json(data, status, { "cache-control": "no-store", pragma: "no-cache" });
}

function oauthError(error: string, description: string, status = 400) {
  return oauthJson({ error, error_description: description }, status);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(prefix: string, size = 32) {
  return prefix + base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function cleanScope(value: string | null | undefined) {
  const requested = String(value || DEFAULT_SCOPE).split(/\s+/).filter(Boolean);
  const unique = [...new Set(requested)];
  if (!unique.length || unique.some((scope) => !OAUTH_SCOPES.includes(scope))) return null;
  return unique.join(" ");
}

function isTrustedRedirect(raw: string) {
  try {
    const value = new URL(raw);
    if (value.protocol !== "https:" || value.username || value.password || value.hash) return false;
    const host = value.hostname.toLowerCase();
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "openai.com" || host.endsWith(".openai.com");
  } catch {
    return false;
  }
}

function appendQuery(raw: string, values: Record<string, string | null | undefined>) {
  const target = new URL(raw);
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== "") target.searchParams.set(key, value);
  return target.toString();
}

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE_KEY);
  headers.set("authorization", "Bearer " + SERVICE_KEY);
  headers.set("content-type", "application/json");
  headers.set("prefer", headers.get("prefer") || "return=representation");
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, { ...init, headers });
  const txt = await res.text();
  if (!res.ok) throw new Error("DB " + res.status + ": " + txt);
  return txt ? JSON.parse(txt) : null;
}

async function getOAuthClient(clientId: string) {
  if (!clientId) return null;
  const rows = await rest("sales_os_mcp_oauth_clients?select=*&client_id=eq." + encodeURIComponent(clientId) + "&active=eq.true&limit=1", { method: "GET" });
  return rows?.[0] || null;
}

async function getActiveMember(email: string) {
  const rows = await rest("sales_os_members?select=email,display_name,role,active&email=eq." + encodeURIComponent(email.toLowerCase()) + "&active=eq.true&limit=1", { method: "GET" });
  return rows?.[0] || null;
}

async function createTokenPair(clientId: string, memberEmail: string, scope: string, resource: string) {
  const accessToken = randomToken("mso_at_");
  const refreshToken = randomToken("mso_rt_", 40);
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    access_token_hash: await sha256(accessToken),
    refresh_token_hash: await sha256(refreshToken),
    client_id: clientId,
    member_email: memberEmail.toLowerCase(),
    scope,
    resource,
    access_expires_at: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
  await rest("sales_os_mcp_oauth_tokens", { method: "POST", body: JSON.stringify(row) });
  return { accessToken, refreshToken, row };
}

async function authenticate(req: Request) {
  // Preserve the private-team shortcut for existing internal clients. New MCP
  // connections use audience-bound OAuth access tokens issued below.
  const reqUrl = new URL(req.url);
  const teamCode = reqUrl.searchParams.get("access_code") || req.headers.get("x-sales-os-access-code") || "";
  if (teamCode) {
    try {
      const verified = await rest("rpc/sales_os_verify", { method:"POST", body: JSON.stringify({ p_token: teamCode }) });
      if (verified === true) {
        return { member:{ email:"sales-os-team@local", display_name:"Sales OS Team", role:"shared", active:true }, scopes:new Set(["sales_os.read", "sales_os.write"]), legacy:true };
      }
    } catch (_) {}
  }

  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token.startsWith("mso_at_")) return null;
  const hash = await sha256(token);
  const rows = await rest("sales_os_mcp_oauth_tokens?select=client_id,member_email,scope,resource,access_expires_at&access_token_hash=eq." + encodeURIComponent(hash) + "&revoked_at=is.null&access_expires_at=gt." + encodeURIComponent(new Date().toISOString()) + "&limit=1", { method: "GET" });
  const session = rows?.[0];
  if (!session || session.resource !== RESOURCE_URL) return null;
  const member = await getActiveMember(session.member_email);
  if (!member) return null;
  return { member, clientId:session.client_id, scopes:new Set(String(session.scope || "").split(/\s+/).filter(Boolean)), legacy:false };
}

const tools = [

  {
    name: "list_approvals",
    description: "List Sales OS approval requests, optionally filtered by status, prospect, or item type.",
    inputSchema:{type:"object",properties:{status:{type:"string"},prospect_id:{type:"string"},item_type:{type:"string"},limit:{type:"integer",minimum:1,maximum:100,default:50}},additionalProperties:false}
  },
  {
    name: "request_email_approval",
    description: "Request member approval for the exact current snapshot of a saved Sales OS email draft. This does not send email.",
    inputSchema:{type:"object",required:["draft_id"],properties:{draft_id:{type:"string"},note:{type:"string"}},additionalProperties:false}
  },
  {
    name: "review_approval",
    description: "Approve, reject, or request changes on a Sales OS approval. Requires the authenticated Sales OS member to have member access.",
    inputSchema:{type:"object",required:["approval_id","decision"],properties:{approval_id:{type:"string"},decision:{type:"string",enum:["approved","rejected","changes_requested"]},note:{type:"string"}},additionalProperties:false}
  },
  {
    name: "list_audit_log",
    description: "List recent Sales OS audit entries showing who changed what and when.",
    inputSchema:{type:"object",properties:{prospect_id:{type:"string"},limit:{type:"integer",minimum:1,maximum:100,default:50}},additionalProperties:false}
  },

  {
    name: "list_sales_inbox",
    description: "List synced prospect email messages from Sales OS, optionally filtered by prospect, direction, classification, or action requirement.",
    inputSchema:{
      type:"object",
      properties:{
        prospect_id:{type:"string"},
        direction:{type:"string",enum:["inbound","outbound"]},
        classification:{type:"string"},
        requires_action:{type:"boolean"},
        limit:{type:"integer",minimum:1,maximum:100,default:50}
      },
      additionalProperties:false
    }
  },
  {
    name: "sync_email_message",
    description: "Write one Gmail message into Sales OS, classify it, and optionally create a recommended next action. Use after reading a real Gmail message.",
    inputSchema:{
      type:"object",
      required:["prospect_id","provider_message_id","direction"],
      properties:{
        prospect_id:{type:"string"},provider_message_id:{type:"string"},provider_thread_id:{type:"string"},
        direction:{type:"string",enum:["inbound","outbound"]},from_email:{type:"string"},
        to_emails:{type:"array",items:{type:"string"}},cc_emails:{type:"array",items:{type:"string"}},
        subject:{type:"string"},snippet:{type:"string"},body:{type:"string"},sent_at:{type:"string"},
        labels:{type:"array",items:{type:"string"}},has_attachment:{type:"boolean"},
        classification:{type:"string"},requires_action:{type:"boolean"},
        recommendation_title:{type:"string"},recommendation_rationale:{type:"string"},
        recommendation_action:{type:"string"},recommendation_priority:{type:"string",enum:["low","normal","high"]},
        recommendation_due_at:{type:"string"}
      },
      additionalProperties:false
    }
  },
  {
    name: "list_ai_actions",
    description: "List open or resolved Sales OS AI recommendations and next-action suggestions.",
    inputSchema:{
      type:"object",
      properties:{prospect_id:{type:"string"},status:{type:"string"},priority:{type:"string"},limit:{type:"integer",minimum:1,maximum:100,default:50}},
      additionalProperties:false
    }
  },
  {
    name: "save_ai_action",
    description: "Create or update a Sales OS recommendation/AI action item.",
    inputSchema:{
      type:"object",
      required:["title"],
      properties:{
        id:{type:"string"},prospect_id:{type:"string"},recommendation_type:{type:"string"},title:{type:"string"},
        rationale:{type:"string"},suggested_action:{type:"string"},priority:{type:"string",enum:["low","normal","high"]},
        status:{type:"string"},due_at:{type:"string"},source_provider:{type:"string"},source_ref:{type:"string"}
      },
      additionalProperties:false
    }
  },
  {
    name: "set_opportunity",
    description: "Create or update the commercial opportunity attached to a prospect, including value, monthly kg or units, and internal probability.",
    inputSchema:{
      type:"object",
      required:["prospect_id"],
      properties:{
        prospect_id:{type:"string"},opportunity_type:{type:"string"},currency:{type:"string"},
        estimated_value:{type:"number"},monthly_volume_kg:{type:"number"},monthly_units:{type:"number"},
        probability_pct:{type:"number",minimum:0,maximum:100},commercial_notes:{type:"string"}
      },
      additionalProperties:false
    }
  },
  {
    name: "get_autopilot_brief",
    description: "Get a concise live Sales OS Autopilot brief: inbox requiring action, overdue work, AI recommendations, active pipeline value, and recent replies.",
    inputSchema:{type:"object",properties:{owner:{type:"string"}},additionalProperties:false}
  },

  {
    name: "create_prospect",
    description: "Create a new prospect in Sales OS with category, contact, owner, priority, and next action.",
    inputSchema:{
      type:"object",required:["company"],
      properties:{
        company:{type:"string"},category:{type:"string"},segment:{type:"string"},location:{type:"string"},website:{type:"string"},
        contact_name:{type:"string"},contact_role:{type:"string"},contact_email:{type:"string"},phone:{type:"string"},
        priority:{type:"string"},score:{type:"number"},owner_assigned:{type:"string"},next_action:{type:"string"},next_action_date:{type:"string"},
        notes:{type:"string"},caution:{type:"string"}
      },additionalProperties:false
    }
  },
  {
    name: "create_asset",
    description: "Attach a new website, proposal, image set, spreadsheet, research file, or other asset to a prospect.",
    inputSchema:{
      type:"object",required:["prospect_id","title"],
      properties:{prospect_id:{type:"string"},asset_type:{type:"string"},title:{type:"string"},url:{type:"string"},status:{type:"string"},notes:{type:"string"}},
      additionalProperties:false
    }
  },
  {
    name: "complete_reminder",
    description: "Mark an open Sales OS reminder as completed.",
    inputSchema:{type:"object",required:["reminder_id"],properties:{reminder_id:{type:"string"}},additionalProperties:false}
  },
  {
    name: "list_notes",
    description: "List notes for a prospect or recent general Sales OS notes.",
    inputSchema:{type:"object",properties:{prospect_id:{type:"string"},limit:{type:"integer",minimum:1,maximum:100,default:50}},additionalProperties:false}
  },
  {
    name: "list_categories",
    description: "List active Sales OS categories and the number of prospects in each.",
    inputSchema:{type:"object",properties:{},additionalProperties:false}
  },
  {
    name: "add_category",
    description: "Create a new Sales OS category/market so prospects can be organized under it.",
    inputSchema:{type:"object",required:["name"],properties:{name:{type:"string"},description:{type:"string"}},additionalProperties:false}
  },
  {
    name: "sales_dashboard",
    description: "Get the current Sales OS dashboard: counts, due follow-ups, due reminders, recent activity, and stage summary.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "search_prospects",
    description: "Search live Sales OS prospects by company, contact, category, location, stage, or owner.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
        stage: { type: "string" },
        owner: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 }
      },
      additionalProperties: false
    }
  },
  {
    name: "get_prospect",
    description: "Get one prospect with its assets, notes, reminders, email drafts, and recent activity.",
    inputSchema: {
      type: "object",
      properties: { prospect_id: { type: "string" }, company: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    name: "update_prospect",
    description: "Update allowed prospect fields such as stage, owner, priority, contact, category, next action, and notes.",
    inputSchema: {
      type: "object",
      required: ["prospect_id","changes"],
      properties: {
        prospect_id: { type: "string" },
        changes: {
          type: "object",
          properties: {
            category:{type:"string"},segment:{type:"string"},location:{type:"string"},website:{type:"string"},
            contact_name:{type:"string"},contact_role:{type:"string"},contact_email:{type:"string"},phone:{type:"string"},
            priority:{type:"string"},stage:{type:"string"},status:{type:"string"},owner_assigned:{type:"string"},
            sender_name:{type:"string"},sender_email:{type:"string"},next_action:{type:"string"},
            next_action_date:{type:"string"},caution:{type:"string"},notes:{type:"string"}
          },
          additionalProperties:false
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "add_note",
    description: "Add a private note to a prospect or to the general Sales OS workspace.",
    inputSchema: {
      type: "object",
      required:["body"],
      properties:{prospect_id:{type:"string"},title:{type:"string"},body:{type:"string"},pinned:{type:"boolean"}},
      additionalProperties:false
    }
  },
  {
    name: "add_reminder",
    description: "Create a reminder in Sales OS.",
    inputSchema: {
      type:"object",
      required:["title","due_at"],
      properties:{prospect_id:{type:"string"},title:{type:"string"},body:{type:"string"},due_at:{type:"string",description:"ISO 8601 date/time"},owner_assigned:{type:"string"},priority:{type:"string",enum:["low","normal","high"]}},
      additionalProperties:false
    }
  },
  {
    name: "list_due_reminders",
    description: "List open reminders and prospect follow-ups that are due or overdue.",
    inputSchema:{type:"object",properties:{owner:{type:"string"},days_ahead:{type:"integer",minimum:0,maximum:30,default:0}},additionalProperties:false}
  },
  {
    name: "list_assets",
    description: "List built assets for a prospect, or recent assets across Sales OS.",
    inputSchema:{type:"object",properties:{prospect_id:{type:"string"},limit:{type:"integer",minimum:1,maximum:100,default:50}},additionalProperties:false}
  },
  {
    name: "update_asset",
    description: "Edit an existing asset's title, type, URL, status, or notes.",
    inputSchema:{type:"object",required:["asset_id","changes"],properties:{asset_id:{type:"string"},changes:{type:"object",properties:{asset_type:{type:"string"},title:{type:"string"},url:{type:"string"},status:{type:"string"},notes:{type:"string"}},additionalProperties:false}},additionalProperties:false}
  },
  {
    name: "save_email_draft",
    description: "Create or update an email draft attached to a prospect. This does not send email.",
    inputSchema:{type:"object",required:["prospect_id"],properties:{draft_id:{type:"string"},prospect_id:{type:"string"},recipient:{type:"string"},cc:{type:"string"},sender_name:{type:"string"},sender_email:{type:"string"},subject:{type:"string"},body:{type:"string"},ai_assisted:{type:"boolean"}},additionalProperties:false}
  },
  {
    name: "list_email_drafts",
    description: "List email drafts for a prospect or across Sales OS.",
    inputSchema:{type:"object",properties:{prospect_id:{type:"string"},status:{type:"string"},limit:{type:"integer",minimum:1,maximum:100,default:50}},additionalProperties:false}
  },
  {
    name: "mark_email_sent",
    description: "After an email has actually been sent through an authorized mailbox, mark its Sales OS draft as sent and log the outbound activity.",
    inputSchema:{type:"object",required:["draft_id"],properties:{draft_id:{type:"string"},external_message_id:{type:"string"},sent_at:{type:"string"}},additionalProperties:false}
  }
];

for (const tool of tools) {
  (tool as any).securitySchemes = [{ type: "oauth2", scopes: ["openid", "email", "profile"] }];
}

function textResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

async function findProspect(args: any) {
  if (args?.prospect_id) {
    const p = await rest("sales_os_prospects?select=*&id=eq." + encodeURIComponent(args.prospect_id) + "&limit=1", {method:"GET"});
    return p?.[0] || null;
  }
  if (args?.company) {
    const all = await rest("sales_os_prospects?select=*&limit=500", {method:"GET"});
    const q = String(args.company).toLowerCase();
    return all.find((x:any)=>String(x.company||"").toLowerCase()===q) || all.find((x:any)=>String(x.company||"").toLowerCase().includes(q)) || null;
  }
  return null;
}

async function callTool(name: string, args: any, member: any) {

  if (name === "list_approvals") {
    let path="sales_os_approvals?select=*&order=requested_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    if(args?.status) path+="&status=eq."+encodeURIComponent(args.status);
    if(args?.prospect_id) path+="&prospect_id=eq."+encodeURIComponent(args.prospect_id);
    if(args?.item_type) path+="&item_type=eq."+encodeURIComponent(args.item_type);
    return await rest(path,{method:"GET"});
  }

  if (name === "request_email_approval") {
    const drafts=await rest("sales_os_email_drafts?select=*&id=eq."+encodeURIComponent(args.draft_id)+"&limit=1",{method:"GET"});
    if(!drafts?.length) throw new Error("Draft not found");
    const d=drafts[0];
    const existing=await rest("sales_os_approvals?select=*&item_type=eq.email_send&source_id=eq."+encodeURIComponent(d.id)+"&status=eq.pending&order=requested_at.desc&limit=1",{method:"GET"});
    if(existing?.length) return existing[0];

    const row=await rest("sales_os_approvals",{method:"POST",body:JSON.stringify({
      prospect_id:d.prospect_id,
      item_type:"email_send",
      source_table:"sales_os_email_drafts",
      source_id:d.id,
      title:"Send email to "+(d.recipient||"prospect"),
      description:args?.note||"Protected outbound email approval requested from ChatGPT.",
      payload:{recipient:d.recipient||"",sender_name:d.sender_name||"",sender_email:d.sender_email||"",subject:d.subject||"",body:d.body||""},
      ai_assisted:!!d.ai_assisted,
      requested_by_email:member.email||null,
      requested_by_name:member.display_name||member.email||"Sales OS member",
      requested_by_role:member.role||"member",
      status:"pending"
    })});
    await rest("sales_os_audit_log",{method:"POST",body:JSON.stringify({
      actor_email:member.email||null,actor_name:member.display_name||member.email||"Sales OS member",actor_role:member.role||"member",
      action:"request_approval",entity_type:"sales_os_approvals",entity_id:row?.[0]?.id||null,prospect_id:d.prospect_id,
      summary:"Requested email send approval",after_data:row?.[0]||null,source:"chatgpt_mcp"
    })});
    return row?.[0]||null;
  }

  if (name === "review_approval") {
    if(member.role==="shared") throw new Error("Named Sales OS member approval required");
    const pending=await rest("sales_os_approvals?select=*&id=eq."+encodeURIComponent(args.approval_id)+"&status=eq.pending&limit=1",{method:"GET"});
    if(!pending?.length) throw new Error("Pending approval not found");
    const now=new Date().toISOString();
    const row=await rest("sales_os_approvals?id=eq."+encodeURIComponent(args.approval_id),{method:"PATCH",body:JSON.stringify({
      status:args.decision,reviewer_email:member.email||null,reviewer_name:member.display_name||member.email||"Sales OS member",review_note:args.note||null,reviewed_at:now
    })});
    await rest("sales_os_audit_log",{method:"POST",body:JSON.stringify({
      actor_email:member.email||null,actor_name:member.display_name||member.email||"Sales OS member",actor_role:member.role,
      action:args.decision,entity_type:"sales_os_approvals",entity_id:args.approval_id,prospect_id:pending[0].prospect_id,
      summary:(args.decision==="approved"?"Approved":args.decision==="rejected"?"Rejected":"Requested changes")+": "+pending[0].title,
      after_data:row?.[0]||null,source:"chatgpt_mcp"
    })});
    return row?.[0]||null;
  }

  if (name === "list_audit_log") {
    let path="sales_os_audit_log?select=*&order=created_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    if(args?.prospect_id) path+="&prospect_id=eq."+encodeURIComponent(args.prospect_id);
    return await rest(path,{method:"GET"});
  }


  if (name === "list_sales_inbox") {
    let path="sales_os_email_messages?select=*&order=sent_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    if(args?.prospect_id) path+="&prospect_id=eq."+encodeURIComponent(args.prospect_id);
    if(args?.direction) path+="&direction=eq."+encodeURIComponent(args.direction);
    if(args?.classification) path+="&classification=eq."+encodeURIComponent(args.classification);
    if(args?.requires_action!==undefined) path+="&requires_action=eq."+String(!!args.requires_action);
    return await rest(path,{method:"GET"});
  }

  if (name === "sync_email_message") {
    const payload={
      ...args,
      provider:"gmail",
      created_by:member.display_name||member.email
    };
    const result=await rest("rpc/sales_os_upsert_email_message",{method:"POST",body:JSON.stringify({p_token:"MORPHEUS-2B6SWXS23ACB",p_payload:payload})});
    if(args.direction==="inbound"){
      const changes:any={};
      if(args.classification && ["interested","pricing_request","moq_question","meeting_request"].includes(args.classification)) changes.stage="Replied";
      if(args.requires_action && args.recommendation_action) changes.next_action=args.recommendation_action;
      if(args.recommendation_due_at) changes.next_action_date=String(args.recommendation_due_at).slice(0,10);
      if(Object.keys(changes).length) await rest("sales_os_prospects?id=eq."+encodeURIComponent(args.prospect_id),{method:"PATCH",body:JSON.stringify(changes)});
    }
    return {ok:true,message_id:args.provider_message_id,result};
  }

  if (name === "list_ai_actions") {
    let path="sales_os_recommendations?select=*&order=created_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    if(args?.prospect_id) path+="&prospect_id=eq."+encodeURIComponent(args.prospect_id);
    if(args?.status) path+="&status=eq."+encodeURIComponent(args.status);
    if(args?.priority) path+="&priority=eq."+encodeURIComponent(args.priority);
    return await rest(path,{method:"GET"});
  }

  if (name === "save_ai_action") {
    const payload={...args,created_by:member.display_name||member.email};
    return await rest("rpc/sales_os_save_recommendation",{method:"POST",body:JSON.stringify({p_token:"MORPHEUS-2B6SWXS23ACB",p_payload:payload})});
  }

  if (name === "set_opportunity") {
    const payload={...args,updated_by:member.display_name||member.email};
    return await rest("rpc/sales_os_save_opportunity",{method:"POST",body:JSON.stringify({p_token:"MORPHEUS-2B6SWXS23ACB",p_payload:payload})});
  }

  if (name === "get_autopilot_brief") {
    const [prospects,messages,recs,reminders,opps]=await Promise.all([
      rest("sales_os_prospects?select=id,company,stage,owner_assigned,next_action,next_action_date,category,priority&limit=1000",{method:"GET"}),
      rest("sales_os_email_messages?select=id,prospect_id,direction,subject,snippet,sent_at,classification,requires_action,from_email&order=sent_at.desc&limit=200",{method:"GET"}),
      rest("sales_os_recommendations?select=*&status=eq.open&order=created_at.desc&limit=200",{method:"GET"}),
      rest("sales_os_reminders?select=*&status=eq.open&order=due_at.asc&limit=200",{method:"GET"}),
      rest("sales_os_opportunities?select=*&limit=1000",{method:"GET"})
    ]);
    const owner=String(args?.owner||"");
    const pmap=new Map(prospects.map((p:any)=>[p.id,p]));
    const owned=(p:any)=>!owner||p?.owner_assigned===owner;
    const today=new Date().toISOString().slice(0,10);
    const dueFollowups=prospects.filter((p:any)=>owned(p)&&p.next_action_date&&p.next_action_date<=today&&![ "Won","Lost","Hold"].includes(p.stage));
    const dueReminders=reminders.filter((r:any)=>new Date(r.due_at)<=new Date() && (!owner||r.owner_assigned===owner));
    const inboxAction=messages.filter((m:any)=>m.direction==="inbound"&&m.requires_action&&owned(pmap.get(m.prospect_id)));
    const openActions=recs.filter((r:any)=>owned(pmap.get(r.prospect_id)));
    const activeOpps=opps.filter((o:any)=>owned(pmap.get(o.prospect_id))&&!["Won","Lost"].includes(pmap.get(o.prospect_id)?.stage));
    const pipelineValue=activeOpps.reduce((s:number,o:any)=>s+Number(o.estimated_value||0),0);
    const recentReplies=messages.filter((m:any)=>m.direction==="inbound"&&owned(pmap.get(m.prospect_id))).slice(0,15).map((m:any)=>({...m,company:pmap.get(m.prospect_id)?.company||""}));
    const approvals=await rest("sales_os_approvals?select=*&status=eq.pending&order=requested_at.desc&limit=100",{method:"GET"});
    return {owner:owner||"All",inbox_action_required:inboxAction.length,due_followups:dueFollowups,due_reminders:dueReminders,open_ai_actions:openActions,pending_approvals:approvals,pipeline_value:pipelineValue,active_opportunities:activeOpps.length,recent_replies:recentReplies};
  }


  if (name === "create_prospect") {
    const body:any = {
      company:String(args.company).trim(),
      category:args.category||"General",
      segment:args.segment||null,
      location:args.location||null,
      website:args.website||null,
      contact_name:args.contact_name||null,
      contact_role:args.contact_role||null,
      contact_email:args.contact_email||null,
      phone:args.phone||null,
      priority:args.priority||null,
      score:args.score??null,
      owner_assigned:args.owner_assigned||"Yazeed",
      stage:"Research",
      status:"Not started",
      next_action:args.next_action||"Review and qualify",
      next_action_date:args.next_action_date||null,
      notes:args.notes||null,
      caution:args.caution||null
    };
    const row = await rest("sales_os_prospects",{method:"POST",body:JSON.stringify(body)});
    return row?.[0]||null;
  }

  if (name === "create_asset") {
    const body:any = {
      prospect_id:args.prospect_id,
      asset_type:args.asset_type||"Other",
      title:String(args.title),
      url:args.url||null,
      status:args.status||"Built",
      notes:args.notes||null
    };
    const row=await rest("sales_os_assets",{method:"POST",body:JSON.stringify(body)});
    return row?.[0]||null;
  }

  if (name === "complete_reminder") {
    const row=await rest("sales_os_reminders?id=eq."+encodeURIComponent(args.reminder_id),{
      method:"PATCH",
      body:JSON.stringify({status:"completed",completed_at:new Date().toISOString()})
    });
    return row?.[0]||null;
  }

  if (name === "list_notes") {
    let path="sales_os_notes?select=*&order=pinned.desc,updated_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    if(args?.prospect_id) path="sales_os_notes?select=*&prospect_id=eq."+encodeURIComponent(args.prospect_id)+"&order=pinned.desc,updated_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    return await rest(path,{method:"GET"});
  }

  if (name === "list_categories") {
    const [cats,prospects]=await Promise.all([
      rest("sales_os_categories?select=*&active=eq.true&order=sort_order.asc,name.asc",{method:"GET"}),
      rest("sales_os_prospects?select=category&limit=5000",{method:"GET"})
    ]);
    const counts=prospects.reduce((m:any,p:any)=>(m[p.category]=(m[p.category]||0)+1,m),{});
    return cats.map((c:any)=>({...c,prospect_count:counts[c.name]||0}));
  }

  if (name === "add_category") {
    const row=await rest("sales_os_categories",{method:"POST",body:JSON.stringify({name:String(args.name).trim(),description:args.description||null,active:true})});
    return row?.[0]||null;
  }

  if (name === "sales_dashboard") {
    const [prospects, reminders, drafts, activities] = await Promise.all([
      rest("sales_os_prospects?select=id,company,stage,owner_assigned,next_action,next_action_date,category&limit=1000",{method:"GET"}),
      rest("sales_os_reminders?select=*&status=eq.open&order=due_at.asc&limit=500",{method:"GET"}),
      rest("sales_os_email_drafts?select=id,prospect_id,subject,status,updated_at&status=eq.draft&order=updated_at.desc&limit=100",{method:"GET"}),
      rest("sales_os_activities?select=prospect_id,activity_type,subject,outcome,occurred_at&order=occurred_at.desc&limit=20",{method:"GET"})
    ]);
    const today = new Date().toISOString().slice(0,10);
    const dueFollowups = prospects.filter((p:any)=>p.next_action_date && p.next_action_date<=today && !["Won","Lost","Hold"].includes(p.stage));
    const stageSummary = prospects.reduce((m:any,p:any)=>(m[p.stage]=(m[p.stage]||0)+1,m),{});
    const approvals=await rest("sales_os_approvals?select=id,status,item_type,title,requested_at&status=eq.pending&limit=100",{method:"GET"});
    return {prospects_total:prospects.length,due_followups:dueFollowups,due_reminders:reminders.filter((r:any)=>new Date(r.due_at)<=new Date()),drafts_count:drafts.length,pending_approvals:approvals.length,stage_summary:stageSummary,recent_activity:activities};
  }

  if (name === "search_prospects") {
    const all = await rest("sales_os_prospects?select=*&limit=1000",{method:"GET"});
    const q=String(args?.query||"").toLowerCase(),cat=String(args?.category||""),stage=String(args?.stage||""),owner=String(args?.owner||"");
    return all.filter((p:any)=>{
      const blob=[p.company,p.contact_name,p.contact_email,p.category,p.location,p.segment,p.website].join(" ").toLowerCase();
      return (!q||blob.includes(q))&&(!cat||p.category===cat)&&(!stage||p.stage===stage)&&(!owner||p.owner_assigned===owner);
    }).slice(0,Math.min(Number(args?.limit||25),100));
  }

  if (name === "get_prospect") {
    const p = await findProspect(args);
    if (!p) throw new Error("Prospect not found");
    const id=p.id;
    const [assets,notes,reminders,drafts,activities] = await Promise.all([
      rest("sales_os_assets?select=*&prospect_id=eq."+id+"&order=created_at.desc",{method:"GET"}),
      rest("sales_os_notes?select=*&prospect_id=eq."+id+"&order=updated_at.desc",{method:"GET"}),
      rest("sales_os_reminders?select=*&prospect_id=eq."+id+"&order=due_at.asc",{method:"GET"}),
      rest("sales_os_email_drafts?select=*&prospect_id=eq."+id+"&order=updated_at.desc",{method:"GET"}),
      rest("sales_os_activities?select=*&prospect_id=eq."+id+"&order=occurred_at.desc&limit=50",{method:"GET"})
    ]);
    return {prospect:p,assets,notes,reminders,email_drafts:drafts,recent_activity:activities};
  }

  if (name === "update_prospect") {
    const allowed=["category","segment","location","website","contact_name","contact_role","contact_email","phone","priority","stage","status","owner_assigned","sender_name","sender_email","next_action","next_action_date","caution","notes"];
    const body:any={};
    for(const k of allowed) if(args.changes?.[k]!==undefined) body[k]=args.changes[k]||null;
    const updated=await rest("sales_os_prospects?id=eq."+encodeURIComponent(args.prospect_id),{method:"PATCH",body:JSON.stringify(body)});
    return updated?.[0]||null;
  }

  if (name === "add_note") {
    const body:any={body:String(args.body),title:args.title||null,pinned:!!args.pinned,created_by:member.display_name||member.email};
    if(args.prospect_id) body.prospect_id=args.prospect_id;
    const row=await rest("sales_os_notes",{method:"POST",body:JSON.stringify(body)});
    return row?.[0]||null;
  }

  if (name === "add_reminder") {
    const body:any={title:String(args.title),body:args.body||null,due_at:String(args.due_at),owner_assigned:args.owner_assigned||member.display_name||null,priority:args.priority||"normal",status:"open",notify_in_app:true,created_by:member.display_name||member.email};
    if(args.prospect_id) body.prospect_id=args.prospect_id;
    const row=await rest("sales_os_reminders",{method:"POST",body:JSON.stringify(body)});
    return row?.[0]||null;
  }

  if (name === "list_due_reminders") {
    const days=Math.max(0,Math.min(Number(args?.days_ahead||0),30));
    const until=new Date(Date.now()+days*86400000).toISOString();
    let path="sales_os_reminders?select=*&status=eq.open&due_at=lte."+encodeURIComponent(until)+"&order=due_at.asc&limit=500";
    const reminders=await rest(path,{method:"GET"});
    let prospects=await rest("sales_os_prospects?select=id,company,owner_assigned,next_action,next_action_date,stage&limit=1000",{method:"GET"});
    const dateLimit=until.slice(0,10);
    let followups=prospects.filter((p:any)=>p.next_action_date&&p.next_action_date<=dateLimit&&!["Won","Lost","Hold"].includes(p.stage));
    if(args?.owner){reminders.splice(0,reminders.length,...reminders.filter((r:any)=>r.owner_assigned===args.owner));followups=followups.filter((p:any)=>p.owner_assigned===args.owner)}
    return {reminders,followups};
  }

  if (name === "list_assets") {
    let path="sales_os_assets?select=*&order=created_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    if(args?.prospect_id) path="sales_os_assets?select=*&prospect_id=eq."+encodeURIComponent(args.prospect_id)+"&order=created_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    return await rest(path,{method:"GET"});
  }

  if (name === "update_asset") {
    const allowed=["asset_type","title","url","status","notes"],body:any={};
    for(const k of allowed) if(args.changes?.[k]!==undefined) body[k]=args.changes[k]||null;
    const row=await rest("sales_os_assets?id=eq."+encodeURIComponent(args.asset_id),{method:"PATCH",body:JSON.stringify(body)});
    return row?.[0]||null;
  }

  if (name === "save_email_draft") {
    const body:any={prospect_id:args.prospect_id,recipient:args.recipient||null,cc:args.cc||null,sender_name:args.sender_name||null,sender_email:args.sender_email||null,subject:args.subject||null,body:args.body||null,status:"draft",ai_assisted:!!args.ai_assisted,provider:args.ai_assisted?"chatgpt":null,created_by:member.display_name||member.email};
    if(args.draft_id){
      delete body.prospect_id;
      const row=await rest("sales_os_email_drafts?id=eq."+encodeURIComponent(args.draft_id),{method:"PATCH",body:JSON.stringify(body)});
      return row?.[0]||null;
    }
    const row=await rest("sales_os_email_drafts",{method:"POST",body:JSON.stringify(body)});
    return row?.[0]||null;
  }

  if (name === "list_email_drafts") {
    let path="sales_os_email_drafts?select=*&order=updated_at.desc&limit="+Math.min(Number(args?.limit||50),100);
    if(args?.prospect_id) path+="&prospect_id=eq."+encodeURIComponent(args.prospect_id);
    if(args?.status) path+="&status=eq."+encodeURIComponent(args.status);
    return await rest(path,{method:"GET"});
  }

  if (name === "mark_email_sent") {
    const draft=await rest("sales_os_email_drafts?select=*&id=eq."+encodeURIComponent(args.draft_id)+"&limit=1",{method:"GET"});
    if(!draft?.length) throw new Error("Draft not found");
    const d=draft[0];

    if(member.role==="shared"){
      const approvals=await rest("sales_os_approvals?select=*&item_type=eq.email_send&source_id=eq."+encodeURIComponent(d.id)+"&status=eq.approved&order=reviewed_at.desc&limit=5",{method:"GET"});
      const valid=(approvals||[]).find((a:any)=>{
        const p=a.payload||{};
        return String(p.recipient||"")===String(d.recipient||"") &&
               String(p.subject||"")===String(d.subject||"") &&
               String(p.body||"")===String(d.body||"");
      });
      if(!valid) throw new Error("Approved matching draft snapshot required before send");
    }

    const sentAt=args.sent_at||new Date().toISOString();
    await rest("sales_os_email_drafts?id=eq."+encodeURIComponent(args.draft_id),{method:"PATCH",body:JSON.stringify({status:"sent",sent_at:sentAt,external_message_id:args.external_message_id||null})});
    await rest("sales_os_activities",{method:"POST",body:JSON.stringify({prospect_id:d.prospect_id,activity_type:"Sent",channel:"Email",direction:"Outbound",subject:d.subject,message:d.body,actor_name:member.display_name||d.sender_name||member.email,actor_email:member.email||d.sender_email,recipient:d.recipient,occurred_at:sentAt,outcome:"Sent / awaiting reply",source:"ChatGPT + Gmail",external_ref:args.external_message_id||null})});
    await rest("sales_os_audit_log",{method:"POST",body:JSON.stringify({
      actor_email:member.email||null,actor_name:member.display_name||member.email||"Sales OS member",actor_role:member.role||"member",
      action:"email_sent",entity_type:"sales_os_email_drafts",entity_id:d.id,prospect_id:d.prospect_id,
      summary:"Sent approved email: "+(d.subject||"(No subject)"),after_data:{external_message_id:args.external_message_id||null,sent_at:sentAt,recipient:d.recipient,subject:d.subject},source:"chatgpt_gmail"
    })});
    return {ok:true,draft_id:args.draft_id,sent_at:sentAt};
  }

  throw new Error("Unknown tool: "+name);
}

const WRITE_TOOLS = new Set([
  "request_email_approval", "review_approval", "sync_email_message", "save_ai_action", "set_opportunity",
  "create_prospect", "create_asset", "complete_reminder", "add_category", "update_prospect", "add_note",
  "add_reminder", "update_asset", "save_email_draft", "mark_email_sent",
]);

function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    registration_endpoint: REGISTRATION_ENDPOINT,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
    service_documentation: "https://george.morpheuspd.io/sales-os-v4/",
  };
}

function protectedResourceMetadata() {
  return {
    resource: RESOURCE_URL,
    authorization_servers: [ISSUER],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Morpheus Sales OS",
    resource_documentation: "https://george.morpheuspd.io/sales-os-v4/",
  };
}

async function handleRegistration(req: Request) {
  if (req.method !== "POST") return oauthError("invalid_request", "Dynamic client registration requires POST.", 405);
  let body: any;
  try { body = await req.json(); } catch { return oauthError("invalid_client_metadata", "Registration metadata must be valid JSON."); }
  const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map((value: unknown) => String(value)) : [];
  if (!redirectUris.length || redirectUris.length > 10 || redirectUris.some((value: string) => !isTrustedRedirect(value))) {
    return oauthError("invalid_redirect_uri", "Every redirect URI must be an exact HTTPS URL on chatgpt.com or openai.com, without a fragment.");
  }
  if (new Set(redirectUris).size !== redirectUris.length) return oauthError("invalid_redirect_uri", "Redirect URIs must be unique.");
  const tokenAuthMethod = String(body?.token_endpoint_auth_method || "none");
  if (tokenAuthMethod !== "none") return oauthError("invalid_client_metadata", "This public-client registration endpoint supports token_endpoint_auth_method=none only.");
  const grantTypes = Array.isArray(body?.grant_types) ? body.grant_types.map(String) : ["authorization_code", "refresh_token"];
  if (grantTypes.some((value: string) => !["authorization_code", "refresh_token"].includes(value)) || !grantTypes.includes("authorization_code")) {
    return oauthError("invalid_client_metadata", "Supported grant types are authorization_code and refresh_token.");
  }
  const responseTypes = Array.isArray(body?.response_types) ? body.response_types.map(String) : ["code"];
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") return oauthError("invalid_client_metadata", "Only response_type=code is supported.");
  const scope = cleanScope(body?.scope);
  if (!scope) return oauthError("invalid_client_metadata", "The requested client scope is not supported.");
  const clientId = randomToken("mso_client_", 24);
  const clientName = String(body?.client_name || "ChatGPT MCP Client").trim().slice(0, 120) || "ChatGPT MCP Client";
  await rest("sales_os_mcp_oauth_clients", { method: "POST", body: JSON.stringify({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: tokenAuthMethod,
    grant_types: grantTypes,
    response_types: responseTypes,
    scope,
  }) });
  return oauthJson({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: tokenAuthMethod,
    grant_types: grantTypes,
    response_types: responseTypes,
    scope,
  }, 201);
}

type AuthorizationRequest = {
  client: any;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  resource: string;
};

async function validateAuthorizationRequest(params: URLSearchParams): Promise<{ value?: AuthorizationRequest; error?: string }> {
  const clientId = String(params.get("client_id") || "");
  const redirectUri = String(params.get("redirect_uri") || "");
  const client = await getOAuthClient(clientId);
  if (!client) return { error: "Unknown or inactive OAuth client." };
  const registered = Array.isArray(client.redirect_uris) ? client.redirect_uris.map(String) : [];
  if (!registered.includes(redirectUri)) return { error: "The redirect URI does not exactly match the registered URI." };
  if (params.get("response_type") !== "code") return { error: "Only response_type=code is supported." };
  const codeChallenge = String(params.get("code_challenge") || "");
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return { error: "PKCE with code_challenge_method=S256 is required." };
  const requestedResource = String(params.get("resource") || RESOURCE_URL);
  if (requestedResource !== RESOURCE_URL) return { error: "The requested resource is not this MCP server." };
  const scope = cleanScope(params.get("scope") || client.scope);
  if (!scope) return { error: "One or more requested scopes are not supported." };
  const clientScopes = new Set(String(client.scope || DEFAULT_SCOPE).split(/\s+/));
  if (scope.split(/\s+/).some((item) => !clientScopes.has(item))) return { error: "The requested scope exceeds the registered client scope." };
  return { value: { client, clientId, redirectUri, scope, state:String(params.get("state") || ""), codeChallenge, resource:RESOURCE_URL } };
}

function authorizationUiUrl(request: AuthorizationRequest, error = "", email = "") {
  return appendQuery(AUTHORIZATION_UI_URL, {
    response_type:"code",
    client_id:request.clientId,
    redirect_uri:request.redirectUri,
    scope:request.scope,
    state:request.state,
    code_challenge:request.codeChallenge,
    code_challenge_method:"S256",
    resource:request.resource,
    client_name:String(request.client.client_name || "ChatGPT MCP Client"),
    return_host:new URL(request.redirectUri).hostname,
    authorization_error:error,
    email,
  });
}

async function handleAuthorization(req: Request, url: URL) {
  const params = req.method === "POST" ? new URLSearchParams(await req.text()) : url.searchParams;
  const checked = await validateAuthorizationRequest(params);
  if (!checked.value) {
    const description = checked.error || "Invalid authorization request.";
    if (req.method === "GET") return Response.redirect(appendQuery(AUTHORIZATION_UI_URL, { authorization_error:description }), 302);
    return oauthError("invalid_request", description, 400);
  }
  const request = checked.value;
  if (req.method === "GET") return Response.redirect(authorizationUiUrl(request), 302);
  if (req.method !== "POST") return oauthError("invalid_request", "Authorization endpoint supports GET and POST.", 405);
  if (params.get("decision") === "deny") return Response.redirect(appendQuery(request.redirectUri, { error:"access_denied", error_description:"The user denied the request.", state:request.state, iss:ISSUER }), 302);
  const email = String(params.get("email") || "").trim().toLowerCase();
  const accessCode = String(params.get("access_code") || "").trim();
  const member = email ? await getActiveMember(email) : null;
  let verified = false;
  if (member && accessCode) {
    try { verified = await rest("rpc/sales_os_verify", { method:"POST", body:JSON.stringify({ p_token:accessCode }) }) === true; } catch { verified = false; }
  }
  if (!member || !verified) return Response.redirect(authorizationUiUrl(request, "The member email or Sales OS access code is not valid.", email), 303);
  const code = randomToken("mso_code_", 32);
  await rest("sales_os_mcp_oauth_codes", { method:"POST", body:JSON.stringify({
    code_hash:await sha256(code), client_id:request.clientId, member_email:member.email, redirect_uri:request.redirectUri,
    scope:request.scope, resource:request.resource, code_challenge:request.codeChallenge,
    expires_at:new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }) });
  await rest("sales_os_mcp_oauth_clients?client_id=eq." + encodeURIComponent(request.clientId), { method:"PATCH", body:JSON.stringify({ last_used_at:new Date().toISOString() }) });
  return Response.redirect(appendQuery(request.redirectUri, { code, state:request.state, iss:ISSUER }), 302);
}

async function tokenParams(req: Request) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await req.json();
    return new URLSearchParams(Object.entries(body || {}).map(([key, value]) => [key, String(value)]));
  }
  return new URLSearchParams(await req.text());
}

function tokenResponse(accessToken: string, refreshToken: string, scope: string) {
  return oauthJson({
    access_token:accessToken,
    token_type:"Bearer",
    expires_in:ACCESS_TOKEN_TTL_SECONDS,
    refresh_token:refreshToken,
    refresh_token_expires_in:REFRESH_TOKEN_TTL_SECONDS,
    scope,
  });
}

async function handleToken(req: Request) {
  if (req.method !== "POST") return oauthError("invalid_request", "Token endpoint requires POST.", 405);
  let params: URLSearchParams;
  try { params = await tokenParams(req); } catch { return oauthError("invalid_request", "The token request body is invalid."); }
  const grantType = String(params.get("grant_type") || "");
  const clientId = String(params.get("client_id") || "");
  const client = await getOAuthClient(clientId);
  if (!client || client.token_endpoint_auth_method !== "none") return oauthError("invalid_client", "Unknown or inactive public OAuth client.", 401);
  const resource = String(params.get("resource") || RESOURCE_URL);
  if (resource !== RESOURCE_URL) return oauthError("invalid_target", "The token must be issued for the Morpheus Sales OS MCP resource.");

  if (grantType === "authorization_code") {
    const code = String(params.get("code") || "");
    const redirectUri = String(params.get("redirect_uri") || "");
    const verifier = String(params.get("code_verifier") || "");
    if (!code.startsWith("mso_code_") || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError("invalid_grant", "A valid authorization code and PKCE code_verifier are required.");
    const pkce = await sha256(verifier);
    const redeemed = await rest("rpc/sales_os_mcp_redeem_code", { method:"POST", body:JSON.stringify({ p_code_hash:await sha256(code), p_client_id:clientId, p_redirect_uri:redirectUri, p_code_challenge:pkce, p_resource:resource }) });
    if (!redeemed?.member_email) return oauthError("invalid_grant", "The authorization code is invalid, expired, already used, or does not match PKCE.");
    const pair = await createTokenPair(clientId, redeemed.member_email, redeemed.scope, redeemed.resource);
    return tokenResponse(pair.accessToken, pair.refreshToken, redeemed.scope);
  }

  if (grantType === "refresh_token") {
    const oldRefreshToken = String(params.get("refresh_token") || "");
    if (!oldRefreshToken.startsWith("mso_rt_")) return oauthError("invalid_grant", "The refresh token is invalid.");
    const newAccessToken = randomToken("mso_at_");
    const newRefreshToken = randomToken("mso_rt_", 40);
    const now = Date.now();
    const rotated = await rest("rpc/sales_os_mcp_rotate_refresh", { method:"POST", body:JSON.stringify({
      p_refresh_hash:await sha256(oldRefreshToken), p_client_id:clientId, p_resource:resource,
      p_new_id:crypto.randomUUID(), p_new_access_hash:await sha256(newAccessToken), p_new_refresh_hash:await sha256(newRefreshToken),
      p_access_expires_at:new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      p_refresh_expires_at:new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    }) });
    if (!rotated?.scope) return oauthError("invalid_grant", "The refresh token is invalid, expired, reused, or belongs to another client.");
    return tokenResponse(newAccessToken, newRefreshToken, rotated.scope);
  }
  return oauthError("unsupported_grant_type", "Supported grant types are authorization_code and refresh_token.");
}

function mcpUnauthorized(id: unknown) {
  const challenge = `Bearer resource_metadata="${META_URL}", scope="sales_os.read sales_os.write"`;
  return json({ jsonrpc:"2.0", id, error:{ code:-32001, message:"Authentication required", data:{ resource_metadata:META_URL } } }, 401, { "www-authenticate":challenge, "cache-control":"no-store" });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url);
  const path=url.pathname;

  if (req.method === "GET" && (path.endsWith("/oauth-protected-resource") || path.endsWith("/.well-known/oauth-protected-resource"))) return oauthJson(protectedResourceMetadata());
  if (req.method === "GET" && (path.endsWith("/oauth-authorization-server") || path.endsWith("/.well-known/oauth-authorization-server") || path.endsWith("/.well-known/openid-configuration"))) return oauthJson(authorizationServerMetadata());
  if (path.endsWith("/register")) return await handleRegistration(req);
  if (path.endsWith("/authorize")) return await handleAuthorization(req,url);
  if (path.endsWith("/token")) return await handleToken(req);

  if (!path.endsWith("/mcp") && !path.endsWith("/sales-os-mcp")) return json({error:"not_found"},404);
  if (req.method === "GET") {
    const auth = await authenticate(req);
    return auth ? json({error:"method_not_allowed"},405,{allow:"POST"}) : mcpUnauthorized(null);
  }
  if(req.method!=="POST") return json({error:"method_not_allowed"},405,{allow:"POST"});

  let body:any;
  try{body=await req.json()}catch{return rpcError(null,-32700,"Parse error")}
  const id=body?.id??null,method=body?.method;

  try{
    const auth=await authenticate(req);
    if(!auth) return mcpUnauthorized(id);
    if(method==="initialize") return rpcResult(id,{protocolVersion:body?.params?.protocolVersion||"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"Morpheus Sales OS",version:"2.0.0"}});
    if(method==="notifications/initialized") return new Response(null,{status:204,headers:cors});
    if(method==="ping") return rpcResult(id,{});
    if(method==="tools/list") return rpcResult(id,{tools});

    if(method==="tools/call"){
      const name=String(body?.params?.name||"");
      const requiredScope=WRITE_TOOLS.has(name)?"sales_os.write":"sales_os.read";
      if(!auth.scopes.has(requiredScope)) return json({jsonrpc:"2.0",id,error:{code:-32003,message:"Insufficient scope",data:{required_scope:requiredScope}}},403,{"www-authenticate":`Bearer error="insufficient_scope", scope="${requiredScope}"`});
      const args=body?.params?.arguments||{};
      const value=await callTool(name,args,auth.member);
      return rpcResult(id,textResult(value));
    }
    return rpcError(id,-32601,"Method not found");
  }catch(e){
    return rpcResult(id,{content:[{type:"text",text:"Sales OS error: "+String(e?.message||e)}],isError:true});
  }
});
