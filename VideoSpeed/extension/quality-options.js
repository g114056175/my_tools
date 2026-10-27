export const PRESERVED_QUALITY='preferred';
const STANDARD_HEIGHTS=[4320,2160,1440,1080,720,480,360,240,144];
function availableQualityOptions(preferred,heights=[]){
 const values=[...new Set(heights.map(Number).filter(value=>Number.isFinite(value)&&value>0))].sort((a,b)=>b-a);
 const wanted=Number(preferred)||0;
 if(!values.length)return {options:[{value:'0',label:'Best'},...[...new Set([...STANDARD_HEIGHTS,...(wanted?[wanted]:[])])].sort((a,b)=>b-a).map(value=>({value:String(value),label:value+'p'}))],selected:String(wanted)};
 const effective=values.includes(wanted)?wanted:values.find(value=>value<=wanted)??values.at(-1);
 const automatic=wanted>0&&!values.includes(wanted);
 const options=[{value:'0',label:'Best ('+values[0]+'p)'}];
 if(automatic)options.push({value:PRESERVED_QUALITY,label:effective+'p (Auto)',title:'Preferred '+wanted+'p; this video uses '+effective+'p'});
 options.push(...values.map(value=>({value:String(value),label:value+'p'})));
 return {options,selected:automatic?PRESERVED_QUALITY:String(wanted)};
}

export const QUALITY_OFF='off';
export function videoQualityOptions(preferred,heights=[],enabled=true){
 const menu=availableQualityOptions(preferred,heights);
 return {options:[...menu.options,{value:QUALITY_OFF,label:'Off'}],selected:enabled?menu.selected:QUALITY_OFF};
}
