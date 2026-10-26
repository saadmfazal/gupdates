// deno-lint-ignore-file no-unversioned-import
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { processMemberLogin } from "../_shared/sales-auth-core.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")!;
const ALLOWED_ORIGIN="https://george.morpheuspd.io";

const headers={
  "access-control-allow-origin":ALLOWED_ORIGIN,
  "access-control-allow-headers":"content-type, authorization, apikey",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(req.method!=="POST")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers});
  try{
    const body=await req.json().catch(()=>({}));
    const service=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
    const mail=createClient(SUPABASE_URL,ANON_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
    const result=await processMemberLogin({
      body,
      headers:req.headers,
      rateCheck:async({email,emailHash,ipHash})=>{
        const {data,error}=await service.rpc("sales_os_allow_member_login",{
          p_email:email,p_email_hash:emailHash,p_ip_hash:ipHash
        });
        if(error)throw error;
        return data===true;
      },
      sendMagicLink:async({email,returnUrl})=>{
        const {error}=await mail.auth.signInWithOtp({
          email,
          options:{shouldCreateUser:false,emailRedirectTo:returnUrl}
        });
        if(error)throw error;
      }
    });
    return new Response(JSON.stringify(result.body),{status:result.status,headers});
  }catch{
    return new Response(JSON.stringify({ok:true,message:"If this is an active Sales OS profile, a secure sign-in link will arrive shortly."}),{status:202,headers});
  }
});
