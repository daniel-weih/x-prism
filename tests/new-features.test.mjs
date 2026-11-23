import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeEnglishWord, lookupPronunciation } from '../shared/pronunciation.js';

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
