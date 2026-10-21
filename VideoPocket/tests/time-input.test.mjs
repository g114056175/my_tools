import test from 'node:test';
import assert from 'node:assert/strict';
import {bindTimeInput, maskTimeDigits} from '../extension/time-input.js';
import {createRangeController} from '../extension/range-controls.js';

function field() {
  const handlers = {}, input = {
    value:'00:00:00.0', selectionStart:0, selectionEnd:10,
    addEventListener(name, fn) { (handlers[name] ||= []).push(fn); },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    select() { this.setSelectionRange(0, this.value.length); },
    setCustomValidity(value) { this.validationMessage = value; },
    setAttribute(name, value) { this[name] = value; },
    fire(name, properties = {}) {
      const event = {preventDefault() { this.defaultPrevented = true; }, ...properties};
      for (const handler of handlers[name] || []) handler(event);
      return event;
    },
    type(text) { for (const data of text) this.fire('beforeinput', {inputType:'insertText', data}); }
  };
  return input;
}

test('compact digits match the requested clock mask, including leading padding', () => {
  assert.equal(maskTimeDigits('001345'), '00:01:34.5');
  assert.equal(maskTimeDigits('1234567'), '12:34:56.7');
  assert.equal(maskTimeDigits(''), '00:00:00.0');
});
test('continuous typing replaces a selected clock and commits once on blur', () => {
  const input = field(), commits = []; bindTimeInput(input, () => commits.push(input.value));
  input.fire('focus'); input.type('001345');
  assert.equal(input.value, '00:01:34.5'); assert.deepEqual(commits, []);
  input.fire('blur'); assert.deepEqual(commits, ['00:01:34.5']);
  input.fire('blur'); assert.equal(commits.length, 1);
});
test('whole-field numeric entry stops after seven digits instead of shifting forever', () => {
  const input=field();bindTimeInput(input,()=>{});input.fire('focus');input.type('1234567');
  assert.equal(input.value,'12:34:56.7');input.type('89012345');assert.equal(input.value,'12:34:56.7');
  input.fire('beforeinput',{inputType:'deleteContentBackward'});assert.equal(input.value,'01:23:45.6');
  input.type('8');assert.equal(input.value,'12:34:56.8');
  input.setSelectionRange(0,10);input.type('001345');assert.equal(input.value,'00:01:34.5');
});
test('batched insertion and autofill keep the first seven digits, while oversized paste is rejected', () => {
  const input=field();bindTimeInput(input,()=>{});input.fire('focus');
  input.fire('beforeinput',{inputType:'insertReplacementText',data:'123456789'});assert.equal(input.value,'12:34:56.7');
  input.value='123456789';input.fire('input');assert.equal(input.value,'12:34:56.7');
  input.fire('paste',{clipboardData:{getData:()=> '99999999'}});assert.equal(input.value,'12:34:56.7');
});
test('separators cannot be typed over or removed; editing one slot preserves the others', () => {
  const input = field(); bindTimeInput(input, () => {});
  input.value = '00:01:34.5'; input.setSelectionRange(5, 6); // second colon only
  input.fire('beforeinput', {inputType:'deleteContentBackward'});
  assert.equal(input.value, '00:0 :34.5');
  input.setSelectionRange(8, 9); input.type('.:abc');
  assert.equal(input.value, '00:0 :34.5');
  input.setSelectionRange(6, 8); input.type('42');
  assert.equal(input.value, '00:0 :42.5');
  input.setSelectionRange(8, 8); input.fire('beforeinput', {inputType:'deleteContentForward'});
  assert.equal(input.value, '00:0 :42. ');
});
test('backspace during compact entry, undo and redo keep the mask intact', () => {
  const input = field(); bindTimeInput(input, () => {});
  input.fire('focus'); input.type('001345');
  input.fire('beforeinput', {inputType:'deleteContentBackward'});
  assert.equal(input.value, '00:00:13.4');
  input.fire('keydown', {key:'z', ctrlKey:true}); assert.equal(input.value, '00:01:34.5');
  input.fire('keydown', {key:'z', ctrlKey:true, shiftKey:true}); assert.equal(input.value, '00:00:13.4');
});
test('clicking minutes selects that part; replacement and deletion leave other parts intact', () => {
  const input=field(),commits=[];bindTimeInput(input,()=>commits.push(input.value));
  input.value='01:23:45.6';input.fire('pointerdown');input.fire('focus');input.setSelectionRange(4,4);input.fire('click');
  assert.equal(input.selectionStart,0);assert.equal(input.selectionEnd,10,'first focus retains quick whole-clock entry');
  input.fire('pointerdown');input.setSelectionRange(4,4);input.fire('click');
  assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,5);
  input.type('12');assert.equal(input.value,'01:12:45.6');assert.equal(input.selectionStart,6);assert.equal(input.selectionEnd,8);
  input.setSelectionRange(5,5);input.fire('beforeinput',{inputType:'deleteContentBackward'});
  assert.equal(input.value,'01:1 :45.6','delete removes a digit rather than replacing it with zero');
  input.fire('blur');assert.deepEqual(commits,['01:01:45.6']);
});
test('Delete removes the digit at the caret and clearing the field stays blank until commit', () => {
  const input=field();bindTimeInput(input,()=>{});input.value='01:23:45.6';
  input.setSelectionRange(3,3);input.fire('beforeinput',{inputType:'deleteContentForward'});assert.equal(input.value,'01:3 :45.6');
  input.setSelectionRange(0,10);input.fire('beforeinput',{inputType:'deleteContentBackward'});assert.equal(input.value,'  :  :  . ');
  input.type('12345');assert.equal(input.value,'00:12:34.5');
  input.setSelectionRange(0,10);input.fire('beforeinput',{inputType:'deleteContentForward'});input.fire('blur');assert.equal(input.value,'00:00:00.0');
});
test('paste accepts clock or compact digits, blocks other text and supports full-width digits', () => {
  const input = field(); bindTimeInput(input, () => {});
  const paste = text => input.fire('paste', {clipboardData:{getData:() => text}});
  paste('001345'); assert.equal(input.value, '00:01:34.5');
  paste('01:02:03'); assert.equal(input.value, '01:02:03.0');
  paste('00:00:10.1'); assert.equal(input.value, '00:00:10.1');
  paste('００１３４５'); assert.equal(input.value, '00:01:34.5');
  paste('not a time'); assert.equal(input.value, '00:01:34.5');
});
test('autofill and Enter synchronize the actual range and sliders without requiring native change', () => {
  const start = field(), end = field(), startSlider = field(), endSlider = field();
  const controller = createRangeController({start, end, startSlider, endSlider});
  controller.setCapability({duration:213.1, supported:true}); controller.setEnabled(true);
  start.value = '001345'; start.fire('input'); start.fire('keydown', {key:'Enter'});
  assert.deepEqual(controller.getRange(), {start:94.5, end:213.1});
  assert.equal(startSlider.value, '94.5'); assert.equal(start.value, '00:01:34.5');
  end.value = '00:02:00'; end.fire('input'); end.fire('blur');
  assert.deepEqual(controller.getRange(), {start:94.5, end:120});
  assert.equal(end.value, '00:02:00.0');
});
test('invalid clocks or times beyond the video never change the committed range', () => {
  const start = field(), end = field(), controller = createRangeController({start, end});
  controller.setCapability({duration:120, supported:true}); controller.setEnabled(true);
  start.fire('focus'); start.type('009999'); start.fire('blur');
  assert.equal(start.value, '00:00:00.0'); assert.equal(start['aria-invalid'], 'true');
  end.fire('focus'); end.type('001345'); end.fire('blur'); assert.equal(controller.getState().end, 94.5);
  end.fire('focus'); end.type('003000'); end.fire('blur');
  assert.equal(controller.getState().end, 94.5); assert.equal(end.value, '00:01:34.5');
});
