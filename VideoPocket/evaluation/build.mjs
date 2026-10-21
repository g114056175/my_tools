import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {patchMediabunnyDuration} from '../build/patch-mediabunny-duration.mjs';
const require=createRequire(import.meta.url);
const packageEntry=require.resolve('mediabunny');
let packageRoot=path.dirname(packageEntry),packageJson;
while(path.dirname(packageRoot)!==packageRoot){
 try{
  packageJson=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
  if(packageJson.name==='mediabunny')break;
 }catch{}
 packageRoot=path.dirname(packageRoot);
}
if(!packageJson||packageJson.name!=='mediabunny')throw new Error('Could not locate Mediabunny package root');
await patchMediabunnyDuration(packageRoot);
const outputArg=process.argv.indexOf('--output');
if(outputArg!==-1&&!process.argv[outputArg+1])throw new Error('Usage: node evaluation/build.mjs [--output <file>]');
const outfile=outputArg===-1
 ? fileURLToPath(new URL('../extension/vendor/mediabunny.js',import.meta.url))
 : path.resolve(process.argv[outputArg+1]);
await build({entryPoints:[fileURLToPath(new URL('./entry.js',import.meta.url))],outfile,bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true,legalComments:'eof'});
