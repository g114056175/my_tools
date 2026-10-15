// ZIP Store (no compression). Files stay local; no third-party service/library.
const table = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes) {let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function makeZip(files) {
  const enc=new TextEncoder(), parts=[], central=[];let offset=0;
  for(const file of files) {
    const name=enc.encode(file.name), data=typeof file.data==='string'?enc.encode(file.data):file.data;
    const crc=crc32(data), head=new Uint8Array(30+name.length), h=new DataView(head.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);
    h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);head.set(name,30);
    parts.push(head,data);
    const dir=new Uint8Array(46+name.length), d=new DataView(dir.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);
    d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);central.push(dir);
    offset+=head.length+data.length;
  }
  const size=central.reduce((n,b)=>n+b.length,0), end=new Uint8Array(22), e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
