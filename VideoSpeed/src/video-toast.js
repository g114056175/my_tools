export class VideoToast{
 constructor(document){this.document=document;this.view=document.defaultView;this.paint=this.paint.bind(this);}
 show(video,text){
  if(this.persistent&&this.video===video){this.paint();return;}
  this.mount(video,text,false);this.timer=setTimeout(()=>this.clear(),1100);
 }
 hold(video){
  if(!video?.isConnected){this.clear();return;}
  if(this.persistent&&this.video===video){this.renew();this.paint();return;}
  this.mount(video,'',true);this.renew();
 }
 renew(){if(this.persistent){clearTimeout(this.lease);this.lease=setTimeout(()=>this.clear(),8000);}}
 release(){if(this.persistent)this.clear();}
 root(video){const fullscreen=this.document.fullscreenElement;return fullscreen?.contains(video)?fullscreen:this.document.documentElement;}
 mount(video,text,persistent){
  this.clear();this.video=video;this.persistent=persistent;
  const host=this.document.createElement('div');this.host=host;host.id='video-control-toast';host.setAttribute('data-video-control-toast','');
  if(persistent)host.setAttribute('data-persistent','');
  Object.assign(host.style,{position:'absolute',zIndex:'2147483647',pointerEvents:'none',transform:'translateX(-50%)',margin:'0',padding:'0',visibility:'hidden'});
  const shadow=host.attachShadow({mode:'open'}),style=this.document.createElement('style'),label=this.document.createElement('span');this.label=label;
  style.textContent=':host{all:initial}span{display:block;background:#263746c9;color:#fff;font:500 16px/1.35 system-ui;padding:8px 12px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
  label.textContent=text;shadow.append(style,label);
  this.root(video).append(host);
  this.view.addEventListener('scroll',this.paint,true);this.view.addEventListener('resize',this.paint,true);this.document.addEventListener('fullscreenchange',this.paint,true);
  this.paint();this.update=setInterval(this.paint,150);
 }
 paint(){
  const host=this.host,video=this.video;if(!host||!video)return;
  if(!video.isConnected){this.clear();return;}
  const root=this.root(video);if(host.parentElement!==root)root.append(host);
  const rect=video.getBoundingClientRect();if(!rect.width||!rect.height){host.style.visibility='hidden';return;}
  if(this.persistent){let rate;try{rate=Number(video.playbackRate);}catch{}this.label.textContent=Number.isFinite(rate)&&rate>0?String(Number(rate.toFixed(2)))+'×':'—';}
  let parent=host.offsetParent;if(parent===this.document.body&&this.view.getComputedStyle(parent).position==='static')parent=null;
  const bounds=parent?.getBoundingClientRect(),sx=bounds&&parent.offsetWidth?bounds.width/parent.offsetWidth:1,sy=bounds&&parent.offsetHeight?bounds.height/parent.offsetHeight:1;
  const cx=rect.left+rect.width/2,top=rect.top+Math.min(78,Math.max(18,rect.height*.1));
  const left=parent?(cx-bounds.left)/sx+(parent.scrollLeft||0)-(parent.clientLeft||0):cx+this.view.scrollX;
  const y=parent?(top-bounds.top)/sy+(parent.scrollTop||0)-(parent.clientTop||0):top+this.view.scrollY;
  Object.assign(host.style,{left:left+'px',top:y+'px',maxWidth:Math.max(0,(rect.width-24)/sx)+'px',visibility:'visible'});
  Object.assign(this.label.style,{fontSize:Math.min(18,Math.max(14,rect.height*.024))/sy+'px',padding:Math.min(11,Math.max(6,rect.height*.012))/sy+'px '+Math.min(16,Math.max(10,rect.width*.011))/sx+'px'});
 }
 clear(){
  clearTimeout(this.timer);clearTimeout(this.lease);clearInterval(this.update);
  this.view.removeEventListener('scroll',this.paint,true);this.view.removeEventListener('resize',this.paint,true);this.document.removeEventListener('fullscreenchange',this.paint,true);
  this.host?.remove();this.host=null;this.video=null;this.label=null;this.persistent=false;
 }
}
