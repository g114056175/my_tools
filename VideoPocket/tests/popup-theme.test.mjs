import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPopupTheme} from '../extension/popup-theme.js';

function setup({dark=false,get=async()=>({}),set=async()=>{}}={}){
 const root={dataset:{}},clicks=new Set(),changes=new Set();
 const button={attributes:{},setAttribute(name,value){this.attributes[name]=value;},addEventListener(type,fn){assert.equal(type,'click');clicks.add(fn);},removeEventListener(type,fn){clicks.delete(fn);},click:async()=>{for(const fn of clicks)await fn();}};
 const system={matches:dark,addEventListener(type,fn){assert.equal(type,'change');changes.add(fn);},removeEventListener(type,fn){changes.delete(fn);},change(value){this.matches=value;for(const fn of changes)fn();}};
 const ui=bindPopupTheme(button,{root,storage:{get,set},system});return {root,button,system,ui,changes,clicks};
}

test('default appearance follows the system without persisting an implicit preference',async()=>{
 let writes=0;const s=setup({dark:true,set:async()=>writes++});await s.ui.ready;
 assert.equal(s.root.dataset.theme,'dark');assert.equal(s.button.attributes['aria-pressed'],'true');assert.equal(s.button.title,'Switch to light theme');
 s.system.change(false);assert.equal(s.root.dataset.theme,'light');assert.equal(s.button.attributes['aria-label'],'Switch to dark theme');assert.equal(writes,0);
});

test('saved appearance wins over the system and clicking persists the opposite appearance',async()=>{
 const writes=[],s=setup({dark:false,get:async()=>({popupTheme:'dark'}),set:async value=>writes.push(value)});await s.ui.ready;
 assert.equal(s.root.dataset.theme,'dark');s.system.change(false);assert.equal(s.root.dataset.theme,'dark');
 await s.button.click();assert.equal(s.root.dataset.theme,'light');assert.deepEqual(writes,[{popupTheme:'light'}]);s.system.change(true);assert.equal(s.root.dataset.theme,'light');
});

test('a delayed stored preference cannot overwrite a user choice made while it was loading',async()=>{
 let finish;const s=setup({get:()=>new Promise(resolve=>finish=resolve)});await Promise.resolve();await s.button.click();
 assert.equal(s.root.dataset.theme,'dark');finish({popupTheme:'light'});await s.ui.ready;assert.equal(s.root.dataset.theme,'dark');
});

test('rapid toggles preserve write order and the final user choice',async()=>{
 let unblock;const stored=[],s=setup({set:async value=>{if(!stored.length)await new Promise(resolve=>unblock=resolve);stored.push(value.popupTheme);}});await s.ui.ready;
 const one=s.button.click(),two=s.button.click(),three=s.button.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.root.dataset.theme,'dark');unblock();await Promise.all([one,two,three]);assert.deepEqual(stored,['dark','light','dark']);
});

test('unavailable storage keeps theme controls usable',async()=>{
 const s=setup({dark:true,get:async()=>{throw Error('storage unavailable');},set:async()=>{throw Error('storage unavailable');}});await s.ui.ready;
 assert.equal(s.root.dataset.theme,'dark');await s.button.click();assert.equal(s.root.dataset.theme,'light');
});

test('disposed popup ignores late preference results and removes its listeners',async()=>{
 let finish;const s=setup({get:()=>new Promise(resolve=>finish=resolve)});await Promise.resolve();s.ui.dispose();finish({popupTheme:'dark'});await s.ui.ready;
 assert.equal(s.root.dataset.theme,'light');assert.equal(s.clicks.size,0);assert.equal(s.changes.size,0);
});
