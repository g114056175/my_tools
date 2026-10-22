export function decodeEntities(text) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&nbsp;':' '}[x])).replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
    const value = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return value <= 0x10ffff ? String.fromCodePoint(value) : '';
  });
}
export function seconds(value) {
  return String(value).replace(',', '.').split(':').reduce((n, v) => n * 60 + Number(v), 0);
}
export function clock(value, srt = false) {
  const ms = Math.max(0, Math.round(Number(value || 0) * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}${srt ? ',' : '.'}${String(ms % 1000).padStart(3,'0')}`;
}
export function normalizeCues(cues) {
  const seen = new Set();
  return (cues || []).map(c => ({start: Number(c.start), end: Number(c.end), text: String(c.text || '').trim()}))
    .filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end >= c.start && c.text)
    .sort((a,b) => a.start-b.start).filter(c => {
      const key = `${c.start}|${c.end}|${c.text}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
}
export function parseSubtitles(raw) {
  const text = String(raw).replace(/^\uFEFF/, '');
  if (text.trimStart().startsWith('{')) {
    const obj = JSON.parse(text);
    if (Array.isArray(obj.events)) return normalizeCues(obj.events.filter(e => e.segs).map(e => ({start: e.tStartMs/1000, end:(e.tStartMs+(e.dDurationMs || 0))/1000, text:decodeEntities(e.segs.map(s=>s.utf8||'').join(''))})));
    const body=obj.body || obj.data?.body;if (Array.isArray(body)) return normalizeCues(body.map(c=>({start:c.from, end:c.to, text:decodeEntities(c.content)})));
  }
  const cues = [];
  if(text.trimStart().startsWith('<')){
    for(const match of text.matchAll(/<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi)){
      const attr=name=>match[2].match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1];
      const milliseconds=match[1].toLowerCase()==='p',start=Number(attr(milliseconds?'t':'start')),duration=Number(attr(milliseconds?'d':'dur'));
      if(Number.isFinite(start)&&Number.isFinite(duration)&&duration>0)cues.push({start:start/(milliseconds?1000:1),end:(start+duration)/(milliseconds?1000:1),text:decodeEntities(match[3].replace(/<br\s*\/?\s*>/gi,'\n'))});
    }
    return normalizeCues(cues);
  }
  const rows = text.replace(/\r/g,'').split('\n');
  for (let i=0; i<rows.length; i++) {
    const match = rows[i].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/);
    if (!match) continue;
    const lines=[];
    while (++i<rows.length && rows[i].trim()) lines.push(rows[i]);
    cues.push({start:seconds(match[1]), end:seconds(match[2]), text:decodeEntities(lines.join('\n'))});
  }
  return normalizeCues(cues);
}
export function toSrt(cues) {
  return normalizeCues(cues).map((c,i)=>`${i+1}\n${clock(c.start,true)} --> ${clock(c.end,true)}\n${c.text}\n`).join('\n');
}
export function toVtt(cues) {
  return 'WEBVTT\n\n'+normalizeCues(cues).map(c=>`${clock(c.start)} --> ${clock(c.end)}\n${c.text}\n`).join('\n');
}
export function toText(cues) {
  return normalizeCues(cues).map(c=>`[${clock(c.start).slice(0,-4)}] ${c.text}`).join('\n');
}
export function toPlainText(cues){return normalizeCues(cues).map(c=>c.text).join('\n');}
export function exportSubtitle(subtitle,format){
  if(!['txt','srt','vtt','plain'].includes(format))throw new Error('不支援此字幕格式');
  return {format:format==='plain'?'txt':format,content:format==='srt'?toSrt(subtitle.cues):format==='vtt'?toVtt(subtitle.cues):format==='plain'?toPlainText(subtitle.cues):toText(subtitle.cues)};
}
export function safeName(value) {
  // The download API rejects invisible format characters (including the ZWJ
  // inside some emoji) even when the native file picker accepts them.
  const text=String(value || 'video').replace(/\p{Cf}/gu,'').replace(/[\p{Cc}\uD800-\uDFFF<>:"/\\|?*]/gu,'_');
  return [...text].slice(0,100).join('').replace(/[. ]+$/g,'') || 'video';
}
