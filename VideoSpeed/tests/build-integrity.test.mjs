import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'extension/manifest.json'),'utf8'));

function manifestReferences(){
 const references=[manifest.background?.service_worker,manifest.action?.default_popup];
 for(const iconMap of [manifest.icons,manifest.action?.default_icon]){
  if(typeof iconMap==='string')references.push(iconMap);
  else if(iconMap&&typeof iconMap==='object')references.push(...Object.values(iconMap));
 }
 for(const script of manifest.content_scripts||[])references.push(...(script.js||[]),...(script.css||[]));
 references.push(manifest.options_page,manifest.devtools_page,manifest.options_ui?.page,manifest.side_panel?.default_path);
 references.push(...Object.values(manifest.chrome_url_overrides||{}));
 return references.filter(Boolean);
}

test('all manifest-referenced runtime files exist in the extension package',async()=>{
 const references=manifestReferences();
 const missing=[];
 for(const relative of references){
  try{if(!(await stat(path.join(root,'extension',relative))).isFile())missing.push(relative);}
  catch{missing.push(relative);}
 }
 assert.deepEqual(missing,[],'missing files referenced by manifest');
});

test('the background worker is a bundled classic script with no module imports',async()=>{
 assert.equal(manifest.background?.type,undefined,'background.type must use the classic-script default');
 const worker=await readFile(path.join(root,'extension',manifest.background.service_worker),'utf8');
 assert.doesNotMatch(worker,/^\s*(?:import\b|export\b)|\bimport\s*\(/m);
});
