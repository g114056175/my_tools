import {createRangeVersionGuard} from './transfers.js';

// Scoped to one input/download. Different HLS files have independent versions;
// offsets into one SIDX/MP4 resource share a single version, including its index.
export function createMediaRangeVersions(){
 const resources=new Map();
 return {
  headers(resource){return resources.get(resource)?.headers() || {};},
  verify(resource,url,response){
   let guard=resources.get(resource);
   if(!guard){
    if(response.status!==206)return;
    const match=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
    guard=createRangeVersionGuard({sourceUrl:url,total:match?Number(match[3]):undefined,etag:response.headers.get('etag')});
    resources.set(resource,guard);
   }
   return guard.verify(url,response);
  }
 };
}
