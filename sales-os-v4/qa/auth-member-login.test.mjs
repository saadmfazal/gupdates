import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GENERIC_LOGIN_MESSAGE,
  allowedLoginReturn,
  normalizeMemberEmail,
  processMemberLogin,
  requestIp,
  sha256Hex
} from '../../supabase/functions/_shared/sales-auth-core.js';

const source=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const headers=new Headers({'cf-connecting-ip':'203.0.113.9'});
const request={email:' Member@Example.com ',return_url:'https://george.morpheuspd.io/sales-os-v4/?next=1'};
const publicResult={status:202,body:{ok:true,message:GENERIC_LOGIN_MESSAGE}};

test('normalizes member email and extracts a single proxy address',()=>{
  assert.equal(normalizeMemberEmail(' Member@Example.com '),'member@example.com');
  assert.equal(requestIp(new Headers({'x-forwarded-for':'203.0.113.10, 10.0.0.2'})),'203.0.113.10');
});

test('allows only HTTPS Sales OS return paths on the production origin',()=>{
  for(const path of ['/sales-os-v2/','/sales-os-v3/','/sales-os-v4/','/sales-os-oauth/']){
    assert.equal(allowedLoginReturn(`https://george.morpheuspd.io${path}`),`https://george.morpheuspd.io${path}`);
  }
  for(const value of [
    'http://george.morpheuspd.io/sales-os-v4/',
    'https://attacker.example/sales-os-v4/',
    'https://george.morpheuspd.io/portal/',
    'https://george.morpheuspd.io/sales-os-v4/#token'
  ])assert.equal(allowedLoginReturn(value),null);
});

test('approved member request dispatches one provider magic link with no account creation',async()=>{
  const calls=[];
  const result=await processMemberLogin({
    body:request,headers,
    rateCheck:async input=>{calls.push(['rate',input]);return true},
    sendMagicLink:async input=>calls.push(['send',input])
  });
  assert.deepEqual({status:result.status,body:result.body},publicResult);
  assert.equal(result.dispatched,true);
  assert.equal(calls.length,2);
  assert.equal(calls[0][1].email,'member@example.com');
  assert.match(calls[0][1].emailHash,/^[a-f0-9]{64}$/);
  assert.match(calls[0][1].ipHash,/^[a-f0-9]{64}$/);
  assert.equal(calls[1][1].returnUrl,'https://george.morpheuspd.io/sales-os-v4/?next=1');
});

test('invalid, nonmember, throttled, and provider-error paths are non-enumerating',async()=>{
  const cases=[
    processMemberLogin({body:{email:'',return_url:request.return_url},headers,rateCheck:async()=>true,sendMagicLink:async()=>assert.fail()}),
    processMemberLogin({body:request,headers,rateCheck:async()=>false,sendMagicLink:async()=>assert.fail()}),
    processMemberLogin({body:request,headers,rateCheck:async()=>{throw new Error('membership lookup failed')},sendMagicLink:async()=>assert.fail()}),
    processMemberLogin({body:request,headers,rateCheck:async()=>true,sendMagicLink:async()=>{throw new Error('provider detail must stay private')}})
  ];
  for(const result of await Promise.all(cases)){
    assert.deepEqual({status:result.status,body:result.body},publicResult);
    assert.equal(result.dispatched,false);
  }
});

test('hashing is deterministic and does not expose its input',async()=>{
  const first=await sha256Hex('email:member@example.com');
  assert.equal(first,await sha256Hex('email:member@example.com'));
  assert.equal(first.length,64);
  assert.doesNotMatch(first,/member|example/i);
});

test('bootstrap uses member-only OTP without returning action links',()=>{
  const code=source('../../supabase/functions/sales-os-auth-bootstrap/index.ts');
  assert.match(code,/sales_os_allow_member_login/);
  assert.match(code,/shouldCreateUser:false/);
  assert.doesNotMatch(code,/action_link|generateLink|access_code/);
});
