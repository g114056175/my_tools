const clamp=value=>Math.max(0,Math.min(1,value));
export function intersectRect(a,b){
 const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top),right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);
 return {left,top,right:Math.max(left,right),bottom:Math.max(top,bottom),width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
export function mediaGeometry(rect,view,{painted=true,intersection=null,waitForIntersection=false}={}){
 const viewport={left:0,top:0,right:view.innerWidth,bottom:view.innerHeight},area=Math.max(0,rect.width*rect.height);
 let clipped=intersectRect(rect,viewport);
 if(intersection){
  const original=intersection.boundingClientRect;
  const unchanged=original&&['left','top','right','bottom'].every(key=>Math.abs(original[key]-rect[key])<1);
  if(unchanged||waitForIntersection)clipped=intersectRect(clipped,intersection.intersectionRect);
 }
 const visibleArea=painted&&(!waitForIntersection||intersection)?clipped.width*clipped.height:0;
 const centerX=(clipped.left+clipped.right)/2,centerY=(clipped.top+clipped.bottom)/2;
 const dx=(centerX-view.innerWidth/2)/Math.max(1,view.innerWidth/2),dy=(centerY-view.innerHeight/2)/Math.max(1,view.innerHeight/2);
 return {visible:visibleArea>0,area,visibleArea,visibleRatio:area?clamp(visibleArea/area):0,viewportArea:view.innerWidth*view.innerHeight,centrality:clamp(1-Math.hypot(dx,dy)/Math.SQRT2),bounds:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}};
}
// Synchronous verification is limited to the few leading, already-known media.
// Ordinary scrolling uses IntersectionObserver; no document search is needed.
export function verifyMediaGeometry(video,view,geometry,cache=new WeakMap()){
 if(!geometry.visible)return geometry;
 let clipped=intersectRect(geometry.bounds,{left:0,top:0,right:view.innerWidth,bottom:view.innerHeight});
 for(let node=video.parentElement||video.getRootNode?.()?.host,depth=0;node&&depth++<16;node=node.parentElement||node.getRootNode?.()?.host){
  if(!node.getBoundingClientRect)continue;
  let value=cache.get(node);if(!value){value={style:view.getComputedStyle(node),rect:null};cache.set(node,value);}
  if(value.style.display==='none'||value.style.visibility==='hidden'||value.style.opacity==='0'){clipped={left:0,top:0,right:0,bottom:0,width:0,height:0};break;}
  const x=/(hidden|clip|auto|scroll)/.test(value.style.overflowX||''),y=/(hidden|clip|auto|scroll)/.test(value.style.overflowY||'');
  if(!x&&!y)continue;
  value.rect??=node.getBoundingClientRect();
  clipped=intersectRect(clipped,{left:x?value.rect.left:clipped.left,right:x?value.rect.right:clipped.right,top:y?value.rect.top:clipped.top,bottom:y?value.rect.bottom:clipped.bottom});
 }
 const visibleArea=Math.min(geometry.visibleArea,clipped.width*clipped.height);
 return {...geometry,visible:visibleArea>0,visibleArea,visibleRatio:geometry.area?visibleArea/geometry.area:0};
}
