// Automatic feedback follows a rendered frame, independently of speed setup.
// Only the selected pending video owns a frame callback; manual feedback is immediate.
export class InitialRateNotice{
 constructor(video,{identity,canShow,show,shown}){
  Object.assign(this,{video,identity,canShow,show,shown,pending:false,disposed:false,frame:null,animation:null,listening:false});
  this.wake=this.wake.bind(this);this.view=video.ownerDocument?.defaultView||globalThis;
 }
 request(){
  if(this.disposed)return;
  this.pending=true;this.anchorTime=this.video.currentTime;
  if(!this.listening){for(const type of ['playing','loadeddata','timeupdate','resize'])this.video.addEventListener(type,this.wake);this.listening=true;}
  this.wake();
 }
 ready(){
  const video=this.video;
  if(this.disposed||!this.pending||!video.isConnected||video.paused||video.ended||video.readyState<2||!this.canShow())return false;
  if(video.checkVisibility&&!video.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
  const rect=video.getBoundingClientRect();return rect.width>0&&rect.height>0;
 }
 wake(){
  if(!this.ready()){this.cancelFrame();return;}
  const key=this.identity();if(!key)return;
  if(this.shown.key===key){this.cancel();return;}
  if(this.frame!==null||this.animation!==null)return;
  if(typeof this.video.requestVideoFrameCallback==='function'){
   this.frame=this.video.requestVideoFrameCallback(()=>{this.frame=null;this.present();});
  }else if(Number.isFinite(this.video.currentTime)&&this.video.currentTime!==this.anchorTime){
   this.animation=this.view.requestAnimationFrame(()=>{this.animation=null;this.present();});
  }
 }
 present(){
  if(!this.ready())return;
  const key=this.identity();if(!key)return;
  const duplicate=this.shown.key===key;this.cancel();
  if(!duplicate){this.shown.key=key;this.show(this.video);}
 }
 cancelFrame(){
  if(this.frame!==null){this.video.cancelVideoFrameCallback?.(this.frame);this.frame=null;}
  if(this.animation!==null){this.view.cancelAnimationFrame?.(this.animation);this.animation=null;}
 }
 cancel(){
  this.pending=false;this.cancelFrame();
  if(this.listening){for(const type of ['playing','loadeddata','timeupdate','resize'])this.video.removeEventListener(type,this.wake);this.listening=false;}
 }
 dispose(){this.disposed=true;this.cancel();}
}
