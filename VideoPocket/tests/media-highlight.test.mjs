import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightMedia} from '../extension/media-highlight.js';

class NodeMock {
  constructor(tag, rect = {}) { this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.parentNode = null; this.rect = {left: 4, top: 8, width: 120, height: 70, ...rect}; this.isConnected = true; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.isConnected = false; }
  setAttribute() {}
  querySelectorAll(selector) { return selector === 'video' ? (this.videos || []) : (this.nodes || []); }
  contains(node) { return node === this || this.videos?.includes(node) || this.children.includes(node) || this.children.some(child => child.contains?.(node)); }
  getBoundingClientRect() { return this.rect; }
}

function world(videos) {
  const listeners = new Map();
  const root = new NodeMock('html'); const body = new NodeMock('body'); root.append(body); body.videos = videos;
  const documentMock = {documentElement: root, body, createElement: tag => new NodeMock(tag), querySelectorAll: selector => selector === 'video' ? videos : (body.nodes || []),};
  const old = {document: globalThis.document, addEventListener: globalThis.addEventListener, removeEventListener: globalThis.removeEventListener};
  globalThis.document = documentMock;
  globalThis.addEventListener = (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); };
  globalThis.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn));
  return {root, body, listeners, restore() { globalThis.document = old.document; globalThis.addEventListener = old.addEventListener; globalThis.removeEventListener = old.removeEventListener; }};
}

function identities(entries) {
  const keys = new WeakMap(); for (const [video, key] of entries) keys.set(video, key);
  globalThis[Symbol.for('video-pocket.identities')] = {keys};
  globalThis[Symbol.for('video-pocket.selection')] = {videos: entries.map(([video]) => video)};
}

test('highlights only the exact keyed video and tracks scroll/resize', () => {
  const first = new NodeMock('video', {left: 1}); const second = new NodeMock('video', {left: 20}); const state = world([first, second]);
  try {
    identities([[first, 11], [second, 22]]);
    assert.deepEqual(highlightMedia({mediaKey: 22}), {highlighted: true});
    assert.equal(state.body.children.length, 1);
    const frame = state.body.children[0]; assert.equal(frame.style.left, '20px'); assert.equal(frame.style.background, undefined); assert.equal(frame.style.pointerEvents, 'none');
    second.rect.left = 44; for (const fn of state.listeners.get('scroll') || []) fn(); assert.equal(frame.style.left, '44px');
  } finally { highlightMedia({clear: true}); state.restore(); }
});

test('expired or unknown keys do not fall back to the first video', () => {
  const first = new NodeMock('video'); const state = world([first]);
  try { identities([[first, 1]]); assert.deepEqual(highlightMedia({mediaKey: 2}), {highlighted: false}); assert.equal(state.body.children.length, 0); first.isConnected = false; assert.deepEqual(highlightMedia({mediaKey: 1}), {highlighted: false}); }
  finally { highlightMedia({clear: true}); state.restore(); }
});

test('repeated calls remove the previous frame and timer/listeners', () => {
  const video = new NodeMock('video'); const state = world([video]);
  try {
    identities([[video, 7]]); highlightMedia({mediaKey: 7}); const first = state.body.children[0];
    highlightMedia({mediaKey: 7}); assert.equal(state.body.children.length, 1); assert.notEqual(state.body.children[0], first); assert.equal((state.listeners.get('scroll') || []).length, 1); assert.equal((state.listeners.get('resize') || []).length, 1);
    highlightMedia({clear: true}); assert.equal(state.body.children.length, 0); assert.equal((state.listeners.get('scroll') || []).length, 0); assert.equal((state.listeners.get('resize') || []).length, 0);
  } finally { highlightMedia({clear: true}); state.restore(); }
});

test('open shadow video uses composed root when isConnected is unavailable', () => {
  const video = new NodeMock('video'); delete video.isConnected;
  const shadow = new NodeMock('#shadow'); shadow.videos = [video];
  const host = new NodeMock('div'); host.shadowRoot = shadow;
  const state = world([]); state.body.nodes = [host];
  video.getRootNode = () => globalThis.document;
  try {
    identities([[video, 31]]);
    assert.deepEqual(highlightMedia({mediaKey: 31}), {highlighted: true});
    assert.equal(state.body.children.length, 1);
  } finally { highlightMedia({clear: true}); state.restore(); }
});
