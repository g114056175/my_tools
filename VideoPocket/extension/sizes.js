export function formatBytes(bytes){
  if(!Number.isFinite(bytes)||bytes<=0)return null;
  const units=['KB','MB','GB'];let value=bytes/1024,index=0;
  while(index<units.length-1&&Math.round(value*10)/10>=1024){value/=1024;index++;}
  return `${value.toFixed(1)} ${units[index]}`;
}
export function formatSize(size){const text=formatBytes(size?.bytes);return text?`${size.approximate?'約 ':''}${text}`:'大小未知';}
