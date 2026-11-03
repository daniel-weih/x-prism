import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionConfigurator, CONTEXT_SELECTION, CONTEXT_PAGE } from '../shared/extension-setup.js';

function mockChrome() {
 const menus=new Map(); const calls={creates:0,updates:0,defaults:0}; const errors=[]; const unchecked=[];
 let lastError,read=false;
 const callback=(fn,error)=>{lastError=error?{message:error}:undefined;read=false;if(error)errors.push(error);fn?.();if(error&&!read)unchecked.push(error);lastError=undefined;};
 const runtime={get lastError(){read=true;return lastError;}};
 const api={runtime,tabs:{async query(){return[];}},sidePanel:{async setOptions(){},async setPanelBehavior(){}},contextMenus:{
  async removeAll(){menus.clear();},
  create(properties,fn){calls.creates++;queueMicrotask(()=>{if(menus.has(properties.id))return callback(fn,`Cannot create item with duplicate id ${properties.id}`);menus.set(properties.id,properties);callback(fn);});return properties.id;},
  update(id,properties,fn){calls.updates++;queueMicrotask(()=>{if(!menus.has(id))return callback(fn,`Cannot find menu item with id ${id}`);menus.set(id,{id,...properties});callback(fn);});}
 }};
 return {api,menus,calls,errors,unchecked,defaults:async()=>{calls.defaults++;}};
}

test('regression: overlapping old removeAll/create paths reproduce the reported duplicate ID',async()=>{
 const m=mockChrome();
 const old=async()=>{await m.api.contextMenus.removeAll();m.api.contextMenus.create({id:CONTEXT_SELECTION});m.api.contextMenus.create({id:CONTEXT_PAGE});};
 await Promise.all([old(),old()]);
 assert.ok(m.unchecked.some(error=>error.includes(`duplicate id ${CONTEXT_SELECTION}`)));
});

test('startup/install overlap shares initialization; repeats update persistent menus',async()=>{
 const m=mockChrome();const configure=createExtensionConfigurator(m.api,m.defaults);
 await Promise.all(Array.from({length:20},()=>configure()));
 assert.equal(m.calls.defaults,1);assert.equal(m.calls.creates,4);assert.equal(m.menus.size,4);assert.deepEqual(m.unchecked,[]);
 await configure();assert.equal(m.calls.creates,4);assert.equal(m.calls.defaults,2);assert.equal(m.menus.size,4);
});

test('separate lifecycle instances converge when both observe a missing menu',async()=>{
 const m=mockChrome();
 await Promise.all([createExtensionConfigurator(m.api,m.defaults)(),createExtensionConfigurator(m.api,m.defaults)()]);
 assert.equal(m.menus.size,4);assert.deepEqual(m.unchecked,[]);
 assert.equal(m.menus.get(CONTEXT_SELECTION).title,'Translate selection');
});

test('unexpected failures remain visible and a later event can retry',async()=>{
 const m=mockChrome();let fail=true;
 const configure=createExtensionConfigurator(m.api,async()=>{if(fail)throw new Error('storage unavailable');});
 await assert.rejects(configure(),/storage unavailable/);fail=false;await configure();assert.equal(m.menus.size,4);
});

test('menus follow the saved interface language and auto follows Chrome without duplicate IDs',async()=>{
 const m=mockChrome();let uiLanguage='zh';m.api.i18n={getUILanguage:()=> 'zh-TW'};
 const configure=createExtensionConfigurator(m.api,m.defaults,async()=>({uiLanguage}));
 await configure();
 assert.equal(m.menus.get('prism-read-selection').title,'朗读选中段落');
 assert.equal(m.menus.get(CONTEXT_SELECTION).title,'翻译选中文本');
 uiLanguage='en';await configure.refreshMenus();
 assert.equal(m.menus.get('prism-read-page').title,'Read article');
 assert.equal(m.menus.get(CONTEXT_PAGE).title,'Translate page');
 uiLanguage='auto';await configure.refreshMenus();
 assert.equal(m.menus.get(CONTEXT_PAGE).title,'翻译当前网页');
 assert.equal(m.calls.creates,4);assert.deepEqual(m.unchecked,[]);
});
