import {createRequire} from 'node:module';
import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=require('esbuild');
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(root+'extension/manifest.json','utf8'));
const packageInfo=JSON.parse(await readFile(root+'package.json','utf8'));
if(packageInfo.version!==manifest.version)throw Error('package.json 與 manifest.json 版本不一致');
for(const path of ['src/content.js','src/page-bridge.js','extension/background.js']){
 const source=await readFile(root+path,'utf8'),version=source.match(/\b(?:VERSION|version)=['"]([\d.]+)['"]/u)?.[1];
 if(version!==manifest.version)throw Error(path+' 版本與 manifest.json 不一致');
}
await import('./icons.mjs');
await mkdir(root+'extension',{recursive:true});
await build({absWorkingDir:root,tsconfigRaw:{},entryPoints:['./src/content.js','./src/page-bridge.js'],outdir:'extension',bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true,legalComments:'eof'});
await copyFile(root+'src/settings.js',root+'extension/settings.js');
await copyFile(root+'src/rate-memory.js',root+'extension/rate-memory.js');
await copyFile(root+'src/quality-options.js',root+'extension/quality-options.js');
await copyFile(root+'src/site-rules.js',root+'extension/site-rules.js');
await build({absWorkingDir:root,entryPoints:['./src/site-domain.js'],outdir:'extension',bundle:true,format:'esm',platform:'browser',target:'chrome120',minify:true,legalComments:'eof'});
await copyFile(root+'node_modules/tldts/LICENSE',root+'extension/THIRD_PARTY_LICENSES.txt');
await copyFile(root+'LICENSE',root+'extension/LICENSE');
console.log('Built VideoSpeed '+manifest.version);
