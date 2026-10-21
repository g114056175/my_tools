import {anime1MediaUrl} from './anime1.js';

const TIKTOK_MEDIA_DOMAINS=[
  'tiktok.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokcdn-in.com',
  'tiktokv.com',
  'byteoversea.com',
  'ibytedtos.com',
  'ibyteimg.com',
  'muscdn.com',
];

function secureUrl(raw){
  try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url:null;}catch{return null;}
}

function isTikTokHost(host){return host==='tiktok.com'||host.endsWith('.tiktok.com');}
function isTikTokMediaHost(host){return TIKTOK_MEDIA_DOMAINS.some(domain=>host===domain||host.endsWith('.'+domain));}

export function isTikTokMediaRequest(rawUrl,rawReferer){
  const url=secureUrl(rawUrl),page=secureUrl(rawReferer);
  return !!(url&&page&&isTikTokHost(page.hostname)&&isTikTokMediaHost(url.hostname));
}

// Send browser cookies only when the page and media URL both belong to a
// narrowly allow-listed service. Never forward page credentials to arbitrary
// media hosts discovered in a document.
export function mediaCredentials(rawUrl,rawReferer){
  const url=secureUrl(rawUrl),page=secureUrl(rawReferer);
  if(!url||!page)return 'omit';
  if(/(^|\.)anime1\.me$/.test(page.hostname)&&anime1MediaUrl(url.href))return 'include';
  if(isTikTokHost(page.hostname)&&isTikTokMediaHost(url.hostname))return 'include';
  if(/(^|\.)dailymotion\.com$/.test(page.hostname)&&/(^|\.)(?:dailymotion\.com|dmcdn\.net)$/.test(url.hostname))return 'include';
  if(/(^|\.)facebook\.com$/.test(page.hostname)&&url.origin===page.origin)return 'include';
  if(/(^|\.)facebook\.com$/.test(page.hostname)&&/(^|\.)(?:fbcdn\.net|fbsbx\.com)$/.test(url.hostname))return 'include';
  return 'omit';
}
