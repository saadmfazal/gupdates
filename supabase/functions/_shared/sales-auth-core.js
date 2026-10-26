export const GENERIC_LOGIN_MESSAGE="If this is an active Sales OS profile, a secure sign-in link will arrive shortly.";

const ALLOWED_LOGIN_PATHS=[
  "/sales-os-v2/",
  "/sales-os-v3/",
  "/sales-os-v4/",
  "/sales-os-oauth/"
];

export function normalizeMemberEmail(value){
  return String(value||"").trim().toLowerCase();
}

export function requestIp(headers){
  const direct=String(headers?.get?.("cf-connecting-ip")||"").trim();
  if(direct)return direct;
  return String(headers?.get?.("x-forwarded-for")||"").split(",")[0].trim()||"unknown";
}

export function allowedLoginReturn(value){
  try{
    const url=new URL(String(value||""));
    if(url.origin!=="https://george.morpheuspd.io"||url.username||url.password||url.hash)return null;
    if(!ALLOWED_LOGIN_PATHS.some(path=>url.pathname.startsWith(path)))return null;
    return url.toString();
  }catch{return null}
}

export async function sha256Hex(value,subtle=globalThis.crypto?.subtle){
  if(!subtle)throw new Error("SHA-256 unavailable");
  const bytes=new TextEncoder().encode(String(value));
  const digest=new Uint8Array(await subtle.digest("SHA-256",bytes));
  return [...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function processMemberLogin({body,headers,rateCheck,sendMagicLink}){
  let dispatched=false;
  try{
    const email=normalizeMemberEmail(body?.email);
    const returnUrl=allowedLoginReturn(body?.return_url);
    if(!email||!returnUrl)return {dispatched,status:202,body:{ok:true,message:GENERIC_LOGIN_MESSAGE}};

    const emailHash=await sha256Hex("email:"+email);
    const ipHash=await sha256Hex("ip:"+requestIp(headers));
    const allowed=await rateCheck({email,emailHash,ipHash});
    if(allowed){
      await sendMagicLink({email,returnUrl});
      dispatched=true;
    }
  }catch{
    // Membership, throttling, and provider failures intentionally share the
    // same public response so this endpoint cannot enumerate team members.
  }
  return {dispatched,status:202,body:{ok:true,message:GENERIC_LOGIN_MESSAGE}};
}
