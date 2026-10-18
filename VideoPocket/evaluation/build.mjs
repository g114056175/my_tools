import {build} from 'esbuild';
await build({entryPoints:[new URL('./entry.js',import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,'')],outfile:new URL('../extension/vendor/mediabunny.js',import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,''),bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true,legalComments:'eof'});
