import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),sharp=require('sharp');
const root=fileURLToPath(new URL('../',import.meta.url)),svg=await readFile(root+'build/videospeed.svg');
for(const size of [16,32,48,128]){
 await sharp(svg).resize(size,size).png({compressionLevel:9}).toFile(root+'extension/icons/'+size+'.png');
 await sharp(Buffer.from(svg.toString().replace('#00A1D6','#9BA5AE'))).resize(size,size).png({compressionLevel:9}).toFile(root+'extension/icons/off-'+size+'.png');
}
