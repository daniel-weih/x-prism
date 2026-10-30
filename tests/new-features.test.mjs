import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeEnglishWord, lookupPronunciation } from '../shared/pronunciation.js';
import { requestCodex } from '../shared/codex.js';
import { validateTranslationRequest, parseTranslations } from '../native/codex-client.mjs';

test('offline pronunciation: case, curly apostrophe, multiple readings, misses and single shared load', async()=>{
 const dictionary=JSON.parse(await readFile(new URL('../assets/dictionaries/en-US.json',import.meta.url),'utf8'));
 const original=globalThis.fetch; let loads=0;
 globalThis.chrome={runtime:{getURL:path=>path}};
 globalThis.fetch=async(url)=>{assert.equal(url,'assets/dictionaries/en-US.json');loads++;return{ok:true,json:async()=>dictionary};};
 try {
  assert.equal(normalizeEnglishWord(' Don’t '),"don't");
  assert.equal(await lookupPronunciation('hello world'),null);
  assert.equal(await lookupPronunciation('你好'),null);
  const [a,b,read,miss,prototype]=await Promise.all(['hello','HELLO','read','zzzzprismunknown','__proto__'].map(lookupPronunciation));
  assert.equal(a.ipa,b.ipa);assert.ok(a.ipa.includes('ˈ'));assert.ok(read.ipa.includes(','));assert.equal(miss,null);assert.equal(prototype,null);assert.equal(loads,1);
 } finally {globalThis.fetch=original;delete globalThis.chrome;}
});

test('reject malformed and oversized native requests and incomplete model results',()=>{
 const request={texts:['hello'],sourceLanguage:'en',targetLanguage:'zh'};
 validateTranslationRequest(request);
 for(const patch of [{texts:[]},{texts:[null]},{texts:['']},{texts:['a'.repeat(12001)]},{texts:Array(601).fill('hello')},{targetLanguage:'zh; shell'}])assert.throws(()=>validateTranslationRequest({...request,...patch}));
 assert.deepEqual(parseTranslations('{"translations":["你好"]}',1),['你好']);
 assert.throws(()=>parseTranslations('{"translations":[]}',1));
 assert.throws(()=>parseTranslations('{"translations":[42]}',1));
 assert.throws(()=>parseTranslations('{"translations":[""]}',1));
});

function mockRuntime(send) {
 let onMessage,onDisconnect,closed=false;
 const runtime={lastError:undefined,connectNative(name){assert.equal(name,'com.prism_translate.codex');return{
  onMessage:{addListener(fn){onMessage=fn;}},onDisconnect:{addListener(fn){onDisconnect=fn;}},
  postMessage(payload){queueMicrotask(()=>send({payload,reply:msg=>onMessage(msg),fail:error=>{runtime.lastError={message:error};onDisconnect();runtime.lastError=undefined;}}));},
  disconnect(){closed=true;}
 };}};
 return {runtime,isClosed:()=>closed};
}

test('native port closes on success, server error, disconnect and timeout',async()=>{
 const ok=mockRuntime(({reply})=>reply({ok:true,result:{models:[{model:'example'}]}}));
 assert.deepEqual(await requestCodex({action:'models'},ok.runtime,50),{models:[{model:'example'}]});assert.ok(ok.isClosed());
 const bad=mockRuntime(({reply})=>reply({ok:false,error:'Model unavailable'}));
 await assert.rejects(requestCodex({},bad.runtime,50),/Model unavailable/);assert.ok(bad.isClosed());
 const absent=mockRuntime(({fail})=>fail('host missing'));
 await assert.rejects(requestCodex({},absent.runtime,50),/host missing/);assert.ok(absent.isClosed());
 const stalled=mockRuntime(()=>{});
 await assert.rejects(requestCodex({},stalled.runtime,10),/超时/);assert.ok(stalled.isClosed());
});

test('missing Codex executable fails and cleans up without hanging', async()=>{
 const {CodexClient}=await import('../native/codex-client.mjs');
 const client=new CodexClient('/missing/prism-codex-binary');
 try{await assert.rejects(client.start(),/Cannot start Codex/);}finally{await client.close();}
});
