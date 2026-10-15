// MD5 is required by Bilibili's public WBI request protocol, not used for
// passwords or security decisions. This implementation only uses local JS.
export function md5(value){
 const bytes=new TextEncoder().encode(value),size=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(size),view=new DataView(data.buffer);
 data.set(bytes);data[bytes.length]=128;view.setUint32(size-8,bytes.length*8>>>0,true);view.setUint32(size-4,Math.floor(bytes.length/0x20000000),true);
 let state=[0x67452301,0xefcdab89,0x98badcfe,0x10325476];
 const shifts=[[7,12,17,22],[5,9,14,20],[4,11,16,23],[6,10,15,21]];
 for(let offset=0;offset<size;offset+=64){
  let [a,b,c,d]=state;
  for(let i=0;i<64;i++){
   const round=i>>4,g=round===0?i:round===1?(5*i+1)%16:round===2?(3*i+5)%16:(7*i)%16;
   const f=round===0?(b&c)|(~b&d):round===1?(d&b)|(~d&c):round===2?b^c^d:c^(b|~d);
   const sum=(a+f+Math.floor(Math.abs(Math.sin(i+1))*0x100000000)+view.getUint32(offset+g*4,true))|0,shift=shifts[round][i%4];
   const next=(b+((sum<<shift)|(sum>>>(32-shift))))|0;a=d;d=c;c=b;b=next;
  }
  state=state.map((value,i)=>(value+[a,b,c,d][i])|0);
 }
 return state.map(value=>[0,8,16,24].map(shift=>((value>>>shift)&255).toString(16).padStart(2,'0')).join('')).join('');
}

export function wbiQuery(parameters,imgKey,subKey,time=Math.floor(Date.now()/1000)){
 if(!/^[0-9a-f]{32}$/i.test(imgKey)||!/^[0-9a-f]{32}$/i.test(subKey))throw new Error('invalid WBI keys');
 const order=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13],raw=imgKey+subKey,key=order.map(i=>raw[i]).join('');
 const params={...parameters,wts:time};delete params.w_rid;
 const query=Object.keys(params).sort().map(name=>encodeURIComponent(name)+'='+encodeURIComponent(String(params[name]).replace(/[!'()*]/g,''))).join('&');
 return query+'&w_rid='+md5(query+key);
}
