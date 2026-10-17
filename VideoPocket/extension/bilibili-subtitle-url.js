// Current web-player URL transform. Protocol constants from the documented
// player helpers F/U in dsh-bilibili-summary (MIT; see
// licenses/dsh-bilibili-summary.txt). Unknown transforms must fail closed.
const pairs=[
 ['nP](wOFRvU.+<fjS{jn-!$D|Dz&",zT`','=CFxYRn{.y|uVyO$uh&sikph?N.ilF/`'],
 ['Bn"q~|albg@]Go~ACgyDvKnd+)_D}^&J?',"Cu~L!xs~f^&r@'vh=q]q{eeng*sEg^kp#J"]
];
export function decodeBilibiliSubtitleUrl(raw){
 const input=String(raw||''),match=input.match(/^(?:https:)?\/\/subtitle\.bilibili\.com\/([^?]*)(\?.*)?$/);
 if(!match)return input;
 let path;try{path=decodeURIComponent(match[1]);}catch{throw Object.assign(new Error('BILI_SOURCE_REJECTED'),{code:'BILI_SOURCE_REJECTED',subtitleStage:'list'});}
 if(path.startsWith('bfs/'))return input;
 for(const [prefix,key] of pairs){
  const full=key+'bilibili',decoded=Array.from(path,(char,i)=>String.fromCharCode(char.charCodeAt(0)^full.charCodeAt(i%full.length))).join('');
  if(decoded.startsWith(prefix)){
   const suffix=decoded.slice(prefix.length);
   if(!suffix.startsWith('/bfs/')||/[\x00-\x20\x7f]/.test(suffix))break;
   return 'https://aisubtitle.hdslb.com'+suffix+(match[2]||'');
  }
 }
 throw Object.assign(new Error('BILI_SOURCE_REJECTED'),{code:'BILI_SOURCE_REJECTED',subtitleStage:'list'});
}
