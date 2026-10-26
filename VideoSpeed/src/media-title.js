const PLATFORM = /^(?:youtube|twitch|bilibili|facebook|instagram|tiktok|twitter|x|哔哩哔哩|嗶哩嗶哩)$/iu;
const GENERIC = /^(?:(?:youtube|twitch|bilibili|facebook|instagram|tiktok)\s*[-|·:]?\s*)?(?:(?:html5|embedded)\s*)?(?:video|media|影片|视频|視頻|嵌入(?:式)?影片|嵌入(?:式)?視頻)(?:\s*(?:player|播放器))?$/iu;
const CONTROL = /^(?:播放器|播放|暫停|暂停|播放影片|播放视频|全螢幕|全屏|首頁|首页|home|play|pause|fullscreen|影片\s*\d+)$/iu;

export function cleanMediaTitle(value){
  if(value==null)return '';
  const title=String(value).replace(/\s+/gu,' ').trim();
  return title&&!PLATFORM.test(title)&&!GENERIC.test(title)&&!CONTROL.test(title)?title:'';
}
function elementTitle(node){
  if(!node)return '';
  for(const attribute of ['data-video-title','data-title','post-title','content','title']){
    const value=cleanMediaTitle(node.getAttribute?.(attribute));if(value)return value;
  }
  return cleanMediaTitle(node.textContent);
}
function first(root,selectors){
  for(const selector of selectors){const value=elementTitle(root?.querySelector?.(selector));if(value)return value;}
  return '';
}
function broadcastCardTitle(video,root){
  const broadcastId=href=>String(href||'').match(/(?:^|\/)i\/broadcasts\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i)?.[1]||'';
  for(let node=video?.parentElement,depth=0;node&&depth++<24;node=node.parentElement){
    const videos=[...(node.querySelectorAll?.('video')||[])];
    if((node.tagName==='ARTICLE'||node.tagName==='SHREDDIT-POST')&&(videos.length!==1||videos[0]!==video))break;
    if(videos.length!==1||videos[0]!==video)continue;
    const matches=[...(node.querySelectorAll?.('a[href][aria-label]')||[])].map(anchor=>{
      const id=broadcastId(anchor.getAttribute?.('href')),match=String(anchor.getAttribute?.('aria-label')||'').match(/^open broadcast\s*:\s*(.+)$/i);
      return id&&match?{id,title:cleanMediaTitle(match[1])}:null;
    }).filter(Boolean);
    if(!matches.length)continue;
    return new Set(matches.map(item=>item.id)).size===1?matches[0].title:'';
  }
  return '';
}
function uniqueMediaScope(video,root){
  let best=null;
  for(let node=video?.parentElement,depth=0;node&&depth++<24;node=node.parentElement){
    if(/^(BODY|HTML|MAIN)$/.test(node.tagName||''))break;
    const videos=[...(node.querySelectorAll?.('video')||[])];
    if(videos.length===1&&videos[0]===video){best=node;if(node===root)break;continue;}
    if(videos.length>1||node===root||node.tagName==='ARTICLE'||node.tagName==='SHREDDIT-POST')break;
  }
  return best||video;
}
function routeId(document){
  try{const url=new URL(document.location.href);return /(^|\.)youtube\.com$/i.test(url.hostname)?url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]||'':'';}catch{return '';}
}
function boundTitle(video,document){
  const value=cleanMediaTitle(video.getAttribute?.('data-video-control-title'));if(!value)return '';
  const identity=video.getAttribute?.('data-video-control-title-id');
  if(!identity)return '';
  const current=video.getAttribute?.('data-video-control-content-id');
  const route=routeId(document);
  return identity===current&&(!route||identity==='yt:'+route||video.getAttribute?.('data-video-control-preview-id')===identity)?value:'';
}
function pageTitle(document){
  try{if(/(^|\.)(?:x|twitter|tiktok|instagram|facebook|reddit)\.com$/i.test(new URL(document.location.href).hostname))return '';}catch{}
  const selectors=['meta[property="og:title"]','meta[name="twitter:title"]','meta[name="title"]'];
  const values=selectors.map(selector=>document?.querySelector?.(selector)?.getAttribute?.('content'));
  values.push(document?.title);
  for(const value of values){
    const title=cleanMediaTitle(String(value||'').replace(/\s*[-|｜/]\s*(?:YouTube|Twitch|Facebook|Instagram|X)\s*$/iu,'').replace(/[_\s]*哔哩哔哩[_\s]*bilibili\s*$/iu,''));
    if(title)return title;
  }
  return '';
}

/** Resolve at snapshot time. A page title is never shared across unrelated media. */
export function mediaTitle(video,{document=video?.ownerDocument,index=0,total=1}={}){
  const bound=boundTitle(video,document);if(bound)return bound;
  const explicit=elementTitle({getAttribute:name=>['data-video-title','data-title','title'].includes(name)?video.getAttribute?.(name):null});
  if(explicit)return explicit;
  const article=video.closest?.('shreddit-post,article,[role="article"],figure,[data-testid="tweet"],ytd-reel-video-renderer,ytd-rich-item-renderer');
  // Post body/caption/replies and translated text are not media titles. Read
  // only an explicit post title or a title slot belonging to the media card.
  const redditPost=article?.tagName==='SHREDDIT-POST';
  const articleTitle=redditPost&&(cleanMediaTitle(article?.getAttribute?.('post-title'))||first(article,['[data-testid="post-title"]']));
  const cardScope=uniqueMediaScope(video,article);
  const cardTitle=cleanMediaTitle(cardScope?.getAttribute?.('data-video-title'))||first(cardScope,['[data-e2e="video-title"]','[data-e2e="browse-video-card-title"]','[data-video-title]','.video-title','#video-title','[itemprop="name"]']);
  const broadcastTitle=broadcastCardTitle(video,cardScope);if(broadcastTitle)return broadcastTitle;
  if(articleTitle||cardTitle)return articleTitle||cardTitle;
  const player=video.closest?.('#movie_player,.html5-video-player,.bpx-player-container,#bilibili-player,[data-player]');
  // Generic data-title on a control button is a tooltip, not the clip title.
  const playerTitle=cleanMediaTitle(player?.getAttribute?.('data-video-title'))||cleanMediaTitle(player?.getAttribute?.('data-title'))||
    first(player,['.ytp-title-link','h1.video-title','.video-title','[data-video-title]']);
  if(playerTitle)return playerTitle;
  const label=cleanMediaTitle(video.getAttribute?.('aria-label'));if(label)return label;
  const main=video.closest?.('#movie_player,.bpx-player-container,#bilibili-player');
  // Known main-player headings may sit outside the player; feed article media
  // cannot inherit these or the full-page title merely because it is visible.
  if(main&&!article){
    const heading=first(document,['ytd-watch-metadata h1 yt-formatted-string','ytd-watch-metadata h1','#title h1','h1.video-title','.video-info-title']);
    if(heading)return heading;
    const name=pageTitle(document);if(name)return name;
  }
  if(total===1&&!article){const name=pageTitle(document);if(name)return name;}
  return `影片 ${index+1}`;
}

export {GENERIC as GENERIC_MEDIA_TITLE};
