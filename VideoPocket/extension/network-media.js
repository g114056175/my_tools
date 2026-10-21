// Protocol hints shared by passive network capture and source binding.
export function networkMediaKind({url = '', mime = ''} = {}) {
  let parsed;try{parsed=new URL(url);}catch{return '';}
  if(!/^https?:$/.test(parsed.protocol)||parsed.username||parsed.password)return '';
  const type=String(mime).split(';')[0].trim().toLowerCase();
  if(/(?:json|html|javascript)/.test(type))return '';
  if(/mpegurl/.test(type)||/\.m3u8$/i.test(parsed.pathname))return 'hls';
  if(type==='application/dash+xml'||/\.mpd$/i.test(parsed.pathname))return 'dash';
  // Individual fragments and audio are useful to players, but cannot be offered
  // as a complete video merely because the latest request came from this frame.
  if(/\.(?:m4s|ts|aac|m4a|mp3|ogg|opus)$/i.test(parsed.pathname)||/^audio\//.test(type))return 'audio';
  if(/^video\/(?:mp4|webm|quicktime|x-matroska)$/.test(type)||/\.(?:mp4|webm|mov|m4v|mkv)$/i.test(parsed.pathname))return 'progressive';
  return '';
}

export function networkHttpUrl(raw) {
  try{const u=new URL(raw);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
