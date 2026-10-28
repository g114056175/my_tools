// A blur deadline belongs to one discovered element and one media identity.
// An empty source may acquire its first identity; subsequent replacements do
// not inherit the old element's permission and events never extend the lease.
export class PendingMediaLease{
 constructor(){this.reset();}
 reset(){this.started=false;this.key='';this.until=0;}
 start(key,until){
  if(this.started)return;
  this.started=true;this.key=key||'';this.until=Number.isSafeInteger(until)?until:0;
 }
 accepts(key,now=Date.now()){
  if(!this.started||now>=this.until)return false;
  if(!this.key&&key)this.key=key;
  if(this.key&&key&&key!==this.key){this.finish();return false;}
  return true;
 }
 finish(){this.started=true;this.until=0;}
}
