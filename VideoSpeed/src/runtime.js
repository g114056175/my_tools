export const isContextInvalidatedError=error=>{
 try{return /extension context invalidated/i.test(String(error?.message??error));}
 catch{return false;}
};

// Port errors exist only during onDisconnect; read them before any liveness check.
export function consumeRuntimeError(runtime){
 try{return runtime?.lastError?.message||'';}
 catch(error){if(isContextInvalidatedError(error))return 'Extension context invalidated.';throw error;}
}

export function createRuntimeMessenger(runtime,onInvalid=()=>{}){
 let invalid=false;
 const invalidate=()=>{
  if(invalid)return null;
  invalid=true;
  try{onInvalid();}
  catch(error){if(!isContextInvalidatedError(error))throw error;}
  return null;
 };
 const alive=()=>{
  if(invalid)return false;
  let valid=false;
  try{
   // 更新後 runtime.id 可能仍是舊值，必須驗證原生 API。
   valid=!!runtime?.id;
   if(valid&&typeof runtime.getManifest==='function')valid=!!runtime.getManifest();
  }catch(error){if(!isContextInvalidatedError(error))throw error;valid=false;}
  if(!valid){invalidate();return false;}
  return true;
 };
 const run=callback=>{
  if(!alive())return invalidate();
  let result;
  try{result=callback();}
  catch(error){if(!isContextInvalidatedError(error))throw error;return invalidate();}
  if(result&&typeof result.then==='function')return Promise.resolve(result).catch(error=>{
   if(!isContextInvalidatedError(error))throw error;
   return invalidate();
  });
  return result;
 };
 const cleanup=callback=>{
  try{
   const result=callback();
   if(result&&typeof result.then==='function')return Promise.resolve(result).catch(error=>{
    if(!isContextInvalidatedError(error))throw error;
    return invalidate();
   });
   return result;
  }catch(error){if(!isContextInvalidatedError(error))throw error;return invalidate();}
 };
 const call=(target,methodName,...args)=>run(()=>{
  const method=target?.[methodName];
  return typeof method==='function'?Reflect.apply(method,target,args):undefined;
 });
 const guard=callback=>(...args)=>run(()=>callback(...args));
 const subscribe=(event,listener)=>{
  call(event,'addListener',listener);
  let active=true;
  return ()=>{
   if(!active)return null;
   active=false;
   return cleanup(()=>{
    const remove=event?.removeListener;
    return typeof remove==='function'?Reflect.apply(remove,event,[listener]):undefined;
   });
  };
 };
 const listen=(event,callback)=>subscribe(event,guard(callback));
 const listenDisconnect=(port,callback)=>{
  const event=run(()=>port.onDisconnect);if(!event)return ()=>{};
  return subscribe(event,(...args)=>{
   const error=consumeRuntimeError(runtime);
   if(isContextInvalidatedError(error))return invalidate();
   return run(()=>callback(error,...args));
  });
 };
 const send=async message=>{
  if(!alive())return invalidate();
  try{return await runtime.sendMessage(message);}
  catch(error){
   if(isContextInvalidatedError(error)||!alive())invalidate();
   return null;
  }
 };
 return {send,alive,invalidate,call,guard,listen,listenDisconnect,cleanup};
}
