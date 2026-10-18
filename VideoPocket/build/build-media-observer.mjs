import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('./media-observer-entry.js',import.meta.url))],outfile:fileURLToPath(new URL('../extension/media-observer.js',import.meta.url)),bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true,legalComments:'eof'});
