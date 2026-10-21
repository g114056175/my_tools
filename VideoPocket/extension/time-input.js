// One field, seven editable digits; clock separators are never editable slots.
const SLOTS = [0, 1, 3, 4, 6, 7, 9];
const PARTS = [{start:0,size:2}, {start:3,size:2}, {start:6,size:2}, {start:9,size:1}];
const digitsOf = value => String(value ?? '').replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10)).replace(/\D/g, '');
const clock = digits => `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}.${digits[6]}`;
const blankClock = '  :  :  . ';

export function maskTimeDigits(value) {
  const digits = digitsOf(value).slice(0, 7).padStart(7, '0');
  return clock(digits);
}

function completeClock(value) {
  const parts = String(value).match(/^([\d ]{0,2}):([\d ]{0,2}):([\d ]{0,2})\.([\d ]?)$/);
  return parts ? parts.slice(1).map((part, index) => digitsOf(part).padStart(index === 3 ? 1 : 2, '0')).join('').replace(/^(\d{2})(\d{2})(\d{2})(\d)$/, '$1:$2:$3.$4') : value;
}

export function bindTimeInput(input, onCommit, onEdit = () => {}) {
  if (!input) return;
  let rolling = null, dirty = false, pointerFocus = false, justFocused = false, history = [], redo = [];
  const write = (value, position = 10, record = true, end = position) => {
    if (record && input.value !== value) {
      history.push(input.value); if (history.length > 32) history.shift(); redo = [];
    }
    input.value = value; dirty = true; input.setSelectionRange?.(position, end);
    input.setCustomValidity?.(''); input.setAttribute?.('aria-invalid', 'false');
    onEdit();
  };
  const commit = () => {
    rolling = null; dirty = false; history = []; redo = [];
    input.value = completeClock(input.value);
    onCommit();
  };
  input.addEventListener('focus', () => {
    rolling = null; history = []; redo = [];
    justFocused = pointerFocus; input.select?.();
  });
  input.addEventListener('pointerdown', () => { rolling = null; pointerFocus = true; });
  input.addEventListener('click', () => {
    pointerFocus = false;
    // Preserve quick compact entry on first focus. A subsequent click selects
    // a clock part for local editing, without splitting the actual input.
    if (justFocused) { justFocused = false; input.select?.(); return; }
    const position = input.selectionStart ?? 0;
    if (position !== input.selectionEnd) return; // Keep a user's drag selection.
    const part = PARTS.find(part => position <= part.start + part.size) || PARTS[3];
    input.setSelectionRange?.(part.start, part.start + part.size);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); return; }
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key?.toLowerCase())) {
      event.preventDefault(); rolling = null;
      const undo = event.key.toLowerCase() === 'z' && !event.shiftKey;
      const from = undo ? history : redo, to = undo ? redo : history;
      if (from.length) { to.push(input.value); write(from.pop(), 10, false); }
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) rolling = null;
  });
  input.addEventListener('beforeinput', event => {
    const type = event.inputType || '';
    if (!type.startsWith('insert') && !type.startsWith('delete')) return;
    // Paste is handled below, where clipboard text is available in Chrome.
    if (type === 'insertFromPaste') { event.preventDefault(); return; }
    event.preventDefault();
    const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
    const selected = SLOTS.map((position, index) => position >= start && position < end ? index : -1).filter(index => index >= 0);
    const all = selected.length === 7;
    if (type.startsWith('insert')) {
      const text = String(event.data ?? '').replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10));
      if (!/^\d+$/.test(text)) return;
      if (all || (rolling !== null && start === 10 && end === 10)) {
        const current = all ? '' : rolling;
        if (current.length >= 7) return;
        rolling = (current + text).slice(0, 7);
        write(maskTimeDigits(rolling)); return;
      }
      rolling = null;
      const partIndex = PARTS.findIndex(part => start < part.start + part.size);
      if (partIndex < 0) return;
      const part = PARTS[partIndex], offset = Math.max(0, start - part.start);
      const current = input.value.slice(part.start, part.start + part.size);
      const from = Math.min(offset, current.trimEnd().length);
      const to = Math.min(part.size, Math.max(from, end - part.start));
      const replacement = (current.slice(0, from) + text + current.slice(to)).trimEnd().slice(0, part.size);
      const value = input.value.slice(0, part.start) + replacement.padEnd(part.size, ' ') + input.value.slice(part.start + part.size);
      const next = PARTS[partIndex + 1], position = from + text.length;
      // Finished a clock part: select the next part for direct replacement.
      if (position >= part.size && next) write(value, next.start, true, next.start + next.size);
      else write(value, Math.min(part.start + part.size, part.start + position));
    } else {
      if (!selected.length && rolling !== null && start === 10 && type === 'deleteContentBackward') {
        rolling = rolling.slice(0, -1); write(rolling ? maskTimeDigits(rolling) : blankClock); return;
      }
      rolling = null;
      if (all) { rolling = ''; write(blankClock); return; }
      let indices = selected;
      if (!indices.length) {
        const index = type === 'deleteContentBackward'
          ? SLOTS.findLastIndex(position => position < start)
          : SLOTS.findIndex(position => position >= start);
        if (index >= 0) indices = [index];
      }
      if (!indices.length) return;
      const deleted = new Set(indices.map(index => SLOTS[index]));
      let value = input.value;
      for (const part of PARTS) {
        const replacement = [...value.slice(part.start, part.start + part.size)].filter((_, index) => !deleted.has(part.start + index)).join('').padEnd(part.size, ' ');
        value = value.slice(0, part.start) + replacement + value.slice(part.start + part.size);
      }
      write(value, SLOTS[indices[0]]);
    }
  });
  input.addEventListener('paste', event => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text')?.trim() ?? '';
    // Accept either compact digits or a clock copied from this field.
    if (!/^(?:[0-9０-９]{1,7}|\d{1,2}:\d{2}:\d{2}(?:\.\d)?)$/.test(text)) return;
    rolling = null;
    write(maskTimeDigits(text.includes(':') && !text.includes('.') ? `${text}.0` : text));
  });
  // Covers autofill and input events from accessibility tools as well.
  input.addEventListener('input', () => {
    rolling = null;
    const value = input.value;
    write(maskTimeDigits(/^\d{1,2}:\d{2}:\d{2}$/.test(value) ? `${value}.0` : value));
  });
  input.addEventListener('change', commit);
  input.addEventListener('blur', () => { pointerFocus = false; justFocused = false; if (dirty) commit(); });
}
