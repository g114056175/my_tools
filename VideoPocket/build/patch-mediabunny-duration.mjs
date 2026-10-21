import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Mediabunny 1.61.6: preserve video packet durations across Matroska clusters.
export async function patchMediabunnyDuration(root){
 const packageJson=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 if(packageJson.version!=='1.61.6')throw new Error(`Expected Mediabunny 1.61.6, got ${packageJson.version||'unknown'}`);
 const before="const needsBlockGroup = !!chunk.additions || trackData.type === 'subtitle';";
 const after="const needsBlockGroup = !!chunk.additions || trackData.type === 'subtitle' || (trackData.type === 'video' && msDuration > 0);";
 for(const name of ['src/matroska/matroska-muxer.ts','dist/modules/src/matroska/matroska-muxer.js']){
  const file=path.join(root,name),source=await fs.readFile(file,'utf8');
  if(source.includes(after))continue;
  if(!source.includes(before))throw new Error('Unrecognized Matroska muxer source: '+name);
  await fs.writeFile(file,source.replace(before,after));
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 const root=process.argv[2];
 if(!root)throw new Error('Usage: node build/patch-mediabunny-duration.mjs <mediabunny-package-directory>');
 await patchMediabunnyDuration(root);
}
