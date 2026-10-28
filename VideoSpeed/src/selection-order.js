export class SelectionOrder{
 constructor(){this.epoch=-1;this.revision=-1;this.id=null;}
 accept(message){
  const {selectionEpoch:epoch,selectionRevision:revision}=message;
  if(!Number.isSafeInteger(epoch)||!Number.isSafeInteger(revision))return this.epoch<0;
  if(epoch<this.epoch||epoch===this.epoch&&revision<this.revision)return false;
  if(epoch===this.epoch&&revision===this.revision&&message.id!==this.id)return false;
  this.epoch=epoch;this.revision=revision;this.id=message.id;return true;
 }
}
