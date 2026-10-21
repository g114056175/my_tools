// Use the site's normal player API. The browser handles its HttpOnly,
// path-scoped cookies; no cookie values are read, copied, or persisted by us.
const API='https://v.anime1.me/api';
function pageUrl(raw){try{const u=new URL(raw);return u.protocol==='https:'&&/(^|\.)anime1\.me$/.test(u.hostname)?u:null;}catch{return null;}}
export function anime1MediaUrl(raw){try{const u=new URL(raw,'https://v.anime1.me');return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)v\.anime1\.me$/.test(u.hostname)?u:null;}catch{return null;}}
export async function resolveAnime1(descriptor,request){
 if(!pageUrl(descriptor.referer))throw new Error('Anime1 來源頁無效');
 const token=descriptor.platform?.apiRequest;
 if(typeof token!=='string'||!token||token.length>16384||/[&=#\r\n]/.test(token))throw new Error('Anime1 來源設定缺失，請重新整理影片頁');
 let identity;try{identity=JSON.parse(decodeURIComponent(token));}catch{throw new Error('Anime1 來源設定無效，請重新整理影片頁');}
 const category=String(identity.c??''),episode=String(identity.e??'');
 if(!/^[\w-]{1,80}$/.test(category)||!/^[\w.-]{1,80}$/.test(episode))throw new Error('Anime1 影片識別無效');
 // data-apireq is ALREADY form-encoded by the page. Encoding it again would
 // send %257B instead of %7B and the API rejects the request with HTTP 403.
 const response=await request(API,descriptor.referer,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'d='+token,signal:AbortSignal.timeout(8000)});
 let data;try{data=await response.json();}catch{throw new Error('Anime1 來源 API 回應無效');}
 const expected=`/${category}/${episode}.mp4`;
 for(const entry of Array.isArray(data?.s)?data.s:[]){
  const url=anime1MediaUrl(entry.src);
  if(url&&url.pathname===expected)return {...descriptor,url:url.href};
 }
 throw new Error('Anime1 未提供目前影片的可用來源，請重新整理影片頁');
}
