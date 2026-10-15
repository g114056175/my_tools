// Decode only a bounded ciphertext prefix for container/codec inspection.
// WebCrypto requires PKCS#7 at the end of AES-CBC input. Append a synthetic
// encrypted padding block using the last original cipher block as its IV;
// this preserves every original prefix block and avoids reading a whole TS.
export async function decryptHlsSample(bytes,keyBytes,iv){
 if(keyBytes.byteLength!==16)throw new Error('HLS AES-128 金鑰長度錯誤');
 const length=bytes.byteLength-bytes.byteLength%16;if(length<16)throw new Error('HLS 加密片段不完整');
 const prefix=bytes.subarray(0,length),key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-CBC'},false,['encrypt','decrypt']);
 const padding=await crypto.subtle.encrypt({name:'AES-CBC',iv:prefix.subarray(length-16)},key,new Uint8Array());
 const ciphertext=new Uint8Array(length+16);ciphertext.set(prefix);ciphertext.set(new Uint8Array(padding),length);
 return new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv},key,ciphertext));
}

export function hlsIv(key,sequence){
 const iv=new Uint8Array(16),view=new DataView(iv.buffer);
 if(key?.iv)for(let j=0;j<4;j++)view.setUint32(j*4,key.iv[j]);else view.setUint32(12,sequence);
 return iv;
}
