// SABR ranges retain full-file WebM seek offsets. Replace those tables with
// equal-size Void elements and bound the Segment to this finite local file.
// Packet bytes and timestamps stay intact; Blob slices avoid a whole-file copy.
const EBML=0x1a45dfa3,SEGMENT=0x18538067,CLUSTER=0x1f43b675;
const SEEK_HEAD=0x114d9b74,CUES=0x1c53bb6b,INFO=0x1549a966,DURATION=0x4489;
const invalid=()=>Object.assign(new Error('YouTube WebM range initialization is incomplete'),{code:'YOUTUBE_RANGE_INCOMPLETE'});
function width(first,max){
 for(let length=1;length<=max;length++)if(first&(1<<(8-length)))return length;
 throw invalid();
}
async function header(file,offset,limit=file.size){
 if(!Number.isSafeInteger(offset)||offset<0||offset>=limit)throw invalid();
 const bytes=new Uint8Array(await file.slice(offset,Math.min(offset+12,limit)).arrayBuffer());
 if(!bytes.length)throw invalid();
 const idLength=width(bytes[0],4);if(bytes.length<=idLength)throw invalid();
 let id=0;for(let i=0;i<idLength;i++)id=id*256+bytes[i];
 const sizeLength=width(bytes[idLength],8),sizeOffset=offset+idLength;
 if(bytes.length<idLength+sizeLength)throw invalid();
 let size=BigInt(bytes[idLength]&((1<<(8-sizeLength))-1));
 for(let i=1;i<sizeLength;i++)size=size*256n+BigInt(bytes[idLength+i]);
 const unknown=size===(1n<<BigInt(7*sizeLength))-1n;
 if(!unknown&&size>BigInt(Number.MAX_SAFE_INTEGER))throw invalid();
 const dataStart=sizeOffset+sizeLength;
 return {id,offset,sizeOffset,sizeLength,dataStart,end:unknown?null:dataStart+Number(size)};
}
function encodeSize(size,length){
 let value=BigInt(size);if(value<0n||value>=(1n<<BigInt(length*7))-1n)throw invalid();
 const bytes=new Uint8Array(length);
 for(let i=length-1;i>=0;i--){bytes[i]=Number(value&255n);value>>=8n;}
 bytes[0]|=1<<(8-length);return bytes;
}
function voidHeader(length){
 for(let sizeLength=1;sizeLength<=8;sizeLength++){
  const payload=length-1-sizeLength;
  if(payload>=0&&BigInt(payload)<(1n<<BigInt(7*sizeLength))-1n){
   const bytes=new Uint8Array(1+sizeLength);bytes[0]=0xec;bytes.set(encodeSize(payload,sizeLength),1);return bytes;
  }
 }
 throw invalid();
}
export async function prepareWebmFragment(file){
 if(!file||!Number.isSafeInteger(file.size)||file.size<=0)throw invalid();
 const ebml=await header(file,0);
 if(ebml.id!==EBML||ebml.end===null||ebml.end>=file.size)throw invalid();
 const segment=await header(file,ebml.end);if(segment.id!==SEGMENT)throw invalid();
 const patches=[{offset:segment.sizeOffset,bytes:encodeSize(file.size-segment.dataStart,segment.sizeLength)}];
 let position=segment.dataStart,foundCluster=false,count=0;
 while(position<file.size){
  if(++count>4096)throw invalid();const element=await header(file,position);
  if(element.id===CLUSTER){foundCluster=true;break;}
  if(element.end===null||element.end<=position||element.end>file.size)throw invalid();
  if(element.id===SEEK_HEAD||element.id===CUES)patches.push({offset:position,bytes:voidHeader(element.end-position)});
  else if(element.id===INFO){
   let childPosition=element.dataStart;
   while(childPosition<element.end){
    if(++count>4096)throw invalid();const child=await header(file,childPosition,element.end);
    if(child.end===null||child.end<=childPosition||child.end>element.end)throw invalid();
    if(child.id===DURATION)patches.push({offset:childPosition,bytes:voidHeader(child.end-childPosition)});
    childPosition=child.end;
   }
  }
  position=element.end;
 }
 if(!foundCluster)throw invalid();patches.sort((a,b)=>a.offset-b.offset);
 const parts=[];let cursor=0;
 for(const patch of patches){parts.push(file.slice(cursor,patch.offset),patch.bytes);cursor=patch.offset+patch.bytes.length;}
 parts.push(file.slice(cursor));return new Blob(parts,{type:file.type||'video/webm'});
}
