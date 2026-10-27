// Activity replies can cross focus notifications while a frame is starting.
export class ActivityLease{
 constructor(){this.revision=-1;this.focused=false;this.until=0;}
 accept(value){
  if(!value||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.focused!=='boolean'||!Number.isSafeInteger(value.until)||value.until<0)return false;
  if(value.revision<this.revision)return false;
  if(value.revision===this.revision&&(value.focused!==this.focused||value.until>this.until))return false;
  this.revision=value.revision;this.focused=value.focused;this.until=value.focused?0:value.until;return true;
 }
 isRecent(now=Date.now()){return this.focused||now<this.until;}
}
