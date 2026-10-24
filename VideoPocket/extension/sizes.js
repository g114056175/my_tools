export function formatBytes(bytes){
  if(!Number.isFinite(bytes)||bytes<=0)return null;
  const units=['KB','MB','GB'];let value=bytes/1024,index=0;
  while(index<units.length-1&&Math.round(value*10)/10>=1024){value/=1024;index++;}
  return `${value.toFixed(1)} ${units[index]}`;
}
// Even a known byte count is rounded for display; keep its provenance in the
// data while using the same concise approximation marker throughout the UI.
export function formatSize(size){const text=formatBytes(size?.bytes);return text?`約 ${text}`:'大小未知';}
