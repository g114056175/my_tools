import {mediaTitleLabel} from './popup-state.js';

// Keep browser-native popup sizing while making every deliberate choice an activation.
export function createMediaMenu(source, root, onActivate = () => {}) {
  const doc = root?.ownerDocument || source?.ownerDocument || globalThis.document;
  if (!source || !root || !doc) throw new TypeError('media menu requires select and root');
  const currentValue = '__vp_current__';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Current video');
  root.classList.add('media-chooser');
  root.replaceChildren(select);
  const context=doc.createElement('canvas').getContext?.('2d');
  const metrics=()=>{
    const style=doc.defaultView?.getComputedStyle(select),rawWidth=Number(select.clientWidth);
    // A hidden select has no layout box. Use a bounded provisional width so
    // native menus never receive an unbounded full title; ResizeObserver will
    // replace it with the actual pixel width when the chooser is displayed.
    const width=Number.isFinite(rawWidth)&&rawWidth>0?rawWidth:220;
    if(!context||!style)return {width,font:'',measure:text=>String(text).length*7};
    context.font=style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // Reserve the native dropdown arrow in addition to the authored padding.
    // Chromium's native arrow and option font can be wider than the select's
    // authored font metrics; keep a conservative 32px control reserve.
    return {width:Math.max(0,width-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0)-32),font:context.font,measure:text=>context.measureText(text).width};
  };
  // A hidden display-only option preserves the current title. Every real
  // option therefore changes value, including choosing the current video.
  select.addEventListener('change', () => {
    const value = select.value;
    const option = [...source.options].find(item => item.value === value && !item.disabled);
    select.value = currentValue;
    if (option) onActivate(value);
  });
  let fingerprint = '';
  const render = () => {
    root.hidden = !!source.hidden;
    select.disabled = !!source.disabled || !source.options.length;
    const options = [...source.options];
    const layout=metrics(),label=item=>mediaTitleLabel(item?.textContent,layout.width,layout.measure);
    const next = JSON.stringify([source.value,layout.width,layout.font,...options.map(item => [item.value,item.textContent,item.title || '',!!item.disabled])]);
    if (next === fingerprint) return;
    fingerprint = next;
    const chosen = options.find(item => item.value === source.value);
    const display = doc.createElement('option');
    display.value = currentValue;
    display.textContent = chosen?label(chosen):(options.length ? 'Select video' : 'No videos available');
    display.hidden = true;display.disabled = true;
    select.replaceChildren(display);
    for (const item of options) {
      const option = doc.createElement('option');
      option.value = item.value;option.textContent = label(item);
      option.setAttribute('data-current', String(item.value === source.value));
      option.dataset && (option.dataset.fullTitle = item.textContent);
      option.title = item.title || item.textContent;option.disabled = !!item.disabled;
      select.append(option);
    }
    select.value = currentValue;
    select.title = chosen?.title || chosen?.textContent || display.textContent;
  };
  // A source error can shrink this field; measuring again avoids stale widths.
  if(typeof doc.defaultView?.ResizeObserver==='function')new doc.defaultView.ResizeObserver(render).observe(root);
  doc.fonts?.ready?.then(render).catch(()=>{});
  return {render};
}
