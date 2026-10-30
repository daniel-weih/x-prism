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
 assert.equal(m.calls.defaults,1);assert.equal(m.calls.creates,2);assert.equal(m.menus.size,2);assert.deepEqual(m.unchecked,[]);
 await configure();assert.equal(m.calls.creates,2);assert.equal(m.calls.defaults,2);assert.equal(m.menus.size,2);
});

test('separate lifecycle instances converge when both observe a missing menu',async()=>{
 const m=mockChrome();
 await Promise.all([createExtensionConfigurator(m.api,m.defaults)(),createExtensionConfigurator(m.api,m.defaults)()]);
 assert.equal(m.menus.size,2);assert.deepEqual(m.unchecked,[]);
 assert.equal(m.menus.get(CONTEXT_SELECTION).title,'Translate selection with Prism');
});

test('unexpected failures remain visible and a later event can retry',async()=>{
 const m=mockChrome();let fail=true;
 const configure=createExtensionConfigurator(m.api,async()=>{if(fail)throw new Error('storage unavailable');});
 await assert.rejects(configure(),/storage unavailable/);fail=false;await configure();assert.equal(m.menus.size,2);
});
