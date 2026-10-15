const PACKET_SIZE=188,MAX_SECTION=4096;
const EMPTY={videoCodec:'',audioCodec:''};

function sectionLength(buffer){
  if(buffer.length<3)return null;
  const length=((buffer[1]&0x0f)<<8)|buffer[2];
  if(length<5||length>MAX_SECTION)return -1;
  return length+3;
}

function parseSections(state,bytes,onSection){
  if(bytes.length)state.push(...bytes);
  while(state.length>=3){
    while(state[0]===0xff)state.shift();
    if(state.length<3)return true;
    const total=sectionLength(state);
    if(total===null)return true;
    if(total<0)return false;
    if(state.length<total)return true;
    onSection(Uint8Array.from(state.splice(0,total)));
  }
  return true;
}

function streamCodecs(section){
  const sectionLength=((section[1]&0x0f)<<8)|section[2],end=3+sectionLength-4;
  if(end<12||end>section.length)return null;
  const programInfoLength=((section[10]&0x0f)<<8)|section[11];
  let at=12+programInfoLength;if(at>end)return null;
  let videoCodec='',audioCodec='';
  while(at<end){
    if(at+5>end)return null;
    const type=section[at],esInfoLength=((section[at+3]&0x0f)<<8)|section[at+4];
    if(at+5+esInfoLength>end)return null;
    if(type===0x1b)videoCodec ||= 'h264';
    else if(type===0x24)videoCodec ||= 'hevc';
    else if(type===0x0f||type===0x11)audioCodec ||= 'aac';
    at+=5+esInfoLength;
  }
  return {videoCodec,audioCodec};
}

export function parseTransportStreamCodecs(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input || 0);
  if(bytes.length<PACKET_SIZE)return {...EMPTY};
  let start=0;if(bytes[0]!==0x47){for(let i=1;i<Math.min(PACKET_SIZE,bytes.length);i++)if(bytes[i]===0x47&&(i+PACKET_SIZE>=bytes.length||bytes[i+PACKET_SIZE]===0x47)){start=i;break;}if(bytes[start]!==0x47)return {...EMPTY};}
  const states=new Map();let pmtPid=null,failed=false,result={...EMPTY};
  const emit=(pid,section)=>{
    const table=section[0];if(table===0x00&&pid===0){
      const length=((section[1]&0x0f)<<8)|section[2],end=3+length-4;
      if(end<8||end>section.length)return failed=true;
      for(let at=8;at+4<=end;at+=4){const program=(section[at]<<8)|section[at+1],mapPid=((section[at+2]&0x1f)<<8)|section[at+3];if(program){pmtPid=mapPid;states.set(pmtPid,[]);break;}}
    }else if(table===0x02&&(pmtPid===null||pid===pmtPid)){
      if(pmtPid===null)return;
      const codecs=streamCodecs(section);if(!codecs)failed=true;else result={...result,...codecs};
    }
  };
  for(let offset=start;offset+PACKET_SIZE<=bytes.length&&!failed;offset+=PACKET_SIZE){
    if(bytes[offset]!==0x47){failed=true;break;}
    const b1=bytes[offset+1],b2=bytes[offset+2],b3=bytes[offset+3],pid=((b1&0x1f)<<8)|b2;
    if((b3&0xc0)!==0){failed=true;break;}
    const payloadUnitStart=!!(b1&0x40),adaptation=(b3>>4)&3;
    if(adaptation===0){failed=true;break;}
    let at=offset+4;
    if(adaptation===2)continue;
    if(adaptation===3){const adaptationLength=bytes[at];if(at+1+adaptationLength>offset+PACKET_SIZE){failed=true;break;}at+=1+adaptationLength;}
    const payload=bytes.subarray(at,offset+PACKET_SIZE);if(!payload.length)continue;
    if(pid!==0&&pid!==pmtPid)continue;
    let state=states.get(pid);if(!state){state=[];states.set(pid,state);}
    if(payloadUnitStart){
      const pointer=payload[0];if(pointer>payload.length-1){failed=true;break;}
      if(pointer&&!parseSections(state,payload.subarray(1,1+pointer),section=>emit(pid,section))){failed=true;break;}
      if(state.length&&pointer===0)state.length=0;
      if(!parseSections(state,payload.subarray(1+pointer),section=>emit(pid,section))){failed=true;break;}
    }else if(!parseSections(state,payload,section=>emit(pid,section))){failed=true;break;}
  }
  return failed?{...EMPTY}:result;
}
