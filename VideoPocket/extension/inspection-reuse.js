// Reuse only a successful inspection of the same freshly discovered source.
// This is not a page/DOM cache; discovery and ownership checks still run.
export async function inspectionReuseKey(descriptor={}){
 if(!descriptor||typeof descriptor!=='object')return '';
 if(!Number.isInteger(descriptor.tabId)||descriptor.tabId<0||typeof descriptor.documentId!=='string'||!descriptor.documentId||descriptor.drm===true)return '';
 const frameId=descriptor.frameId??0,key=descriptor.mediaKey;
 if(!Number.isInteger(frameId)||frameId<0||!['number','string'].includes(typeof key)||String(key)==='')return '';
 if(descriptor.duration!=null&&!Number.isFinite(Number(descriptor.duration)))return '';
 if(!descriptor.url&&!descriptor.platform&&!descriptor.linkedMedia)return '';
 // Keep complete source/platform inputs. Download locks deliberately omit
 // these fields and therefore cannot authorize inspection reuse.
 try{
  const {downloadKey,mediaIndex,localMediaIndex,...value}=descriptor;
  value.frameId=frameId;
  const text=JSON.stringify(value);if(text.length>512*1024)return '';
  const bytes=new TextEncoder().encode(text);if(bytes.length>512*1024)return '';
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 }catch{return '';}
}

export function inspectionReusable(source,key){
 // Retention owns the idle deadline. Age since inspection must not expire a
 // source while its popup or download is still using it.
 return !!key&&source?.inspectionKey===key&&!source.dropOnRelease&&Number.isFinite(source.duration)&&source.duration>0;
}
