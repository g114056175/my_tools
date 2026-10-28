export function bindPopupTheme(button,{
 root=button?.ownerDocument?.documentElement || globalThis.document?.documentElement,
 storage=globalThis.chrome?.storage?.local,
 system=globalThis.matchMedia?.('(prefers-color-scheme: dark)'),
}={}){
 if(!button||!root)return;
 let appearance='system',revision=0,closed=false,writes=Promise.resolve();
 const paint=()=>{
  const dark=appearance==='dark'||appearance==='system'&&!!system?.matches;
  root.dataset.theme=dark?'dark':'light';
  button.title=dark?'Switch to light theme':'Switch to dark theme';
  button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(dark));
 };
 const change=()=>{if(!closed&&appearance==='system')paint();};
 const toggle=()=>{
  if(closed)return;
  revision++;appearance=root.dataset.theme==='dark'?'light':'dark';paint();
  const value=appearance;
  writes=writes.catch(()=>{}).then(()=>storage?.set({popupTheme:value})).catch(()=>{});
  return writes;
 };
 paint();button.addEventListener('click',toggle);system?.addEventListener?.('change',change);
 const ready=Promise.resolve().then(()=>storage?.get('popupTheme')).then(value=>{
  if(closed||revision)return;
  if(['light','dark'].includes(value?.popupTheme))appearance=value.popupTheme;
  paint();
 }).catch(()=>{});
 return {ready,dispose(){closed=true;button.removeEventListener?.('click',toggle);system?.removeEventListener?.('change',change);}};
}
