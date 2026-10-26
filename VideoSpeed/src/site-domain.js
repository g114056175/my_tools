import {getDomain} from 'tldts';
export function siteDomain(value){try{const url=new URL(value);if(!/^https?:$/.test(url.protocol))return '';return getDomain(url.hostname,{allowPrivateDomains:true})||url.hostname;}catch{return '';}}
