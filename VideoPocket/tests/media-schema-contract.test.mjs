import test from "node:test";
import assert from "node:assert/strict";
import { createMediaModelStore, extractMediaModels } from "../extension/media-models.js";
import { observeJsonMetadata, copyMediaMetadata } from "../extension/json-media-observer.js";
import { observeWorkerMetadata } from "../extension/worker-media.js";

const BASE = "https://page.example.test/video/contract";

import {mediaSchemaFixtures as fixtures} from "./fixtures/media-schema-contract.mjs";

function partsOf(fixture) { return fixture.parts || [{ value: fixture.value, baseUrl: BASE }]; }

function modelsFrom(values) {
  const store = createMediaModelStore();
  for (const { value, baseUrl } of values) store.merge(extractMediaModels(value, { baseUrl }));
  return store.models();
}

function semantic(models) {
  return models.filter(model => model.versions?.length || model.manifestUrl).map(model => ({
    aliases: [...model.aliases].sort(),
    urls: [...model.versions.map(version => version.url), ...(model.manifestUrl ? [model.manifestUrl] : [])].sort(),
    versions: model.versions,
    duration: model.duration, height: model.height,
    title: model.title,
  }));
}

function assertContract(name, original, copied) {
  const baseline = semantic(original);
  assert.ok(baseline.length, `${name}: fixture should produce a source model`);
  for (const expected of baseline) {
    const actual = copied.find(model => expected.aliases.some(alias => model.aliases.includes(alias)));
    assert.ok(actual, `${name}: copied metadata lost identity ${expected.aliases.join(",")}`);
    assert.deepEqual([...actual.aliases].sort(), expected.aliases, `${name}: identity aliases`);
    for (const url of expected.urls) assert.ok(actual.versions.some(version => version.url === url) || actual.manifestUrl === url,
      `${name}: copied metadata lost source URL ${url}`);
    if (expected.duration !== undefined) assert.equal(actual.duration, expected.duration, `${name}: duration`);
    if (expected.height !== undefined) assert.equal(actual.height, expected.height, `${name}: height`);
    if (expected.title) assert.equal(actual.title, expected.title, `${name}: title`);
    assert.deepEqual(actual.versions, expected.versions, `${name}: source classification and dimensions`);
  }
}

function observeJsonCopy(value, { large = false } = {}) {
  const seen = [];
  const target = { JSON: { parse: JSON.parse } };
  const observer = observeJsonMetadata(target, copied => seen.push(copied));
  const payload = large ? { envelope: value, unrelated: "x".repeat(270 * 1024) } : value;
  target.JSON.parse(JSON.stringify(payload));
  observer.dispose();
  return seen;
}

function copyWorkerMediaMetadata(value) {
  const seen = [];
  class WorkerMock {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
    receive(data) { this.listeners.get("message")?.({ data }); }
  }
  const target = { Worker: WorkerMock };
  const dispose = observeWorkerMetadata(target, copied => seen.push(copied), { metadataOnly: true, maxDepth: 8, maxNodes: 512 });
  new target.Worker().receive(value);
  dispose();
  return seen;
}

for (const fixture of fixtures) {
  test(`media schema contract: ${fixture.name} through small JSON copy`, () => {
    const parts = partsOf(fixture);
    assertContract(fixture.name, modelsFrom(parts), modelsFrom(parts.map(part => ({
      value: observeJsonCopy(part.value)[0], baseUrl: part.baseUrl,
    }))));
  });

  test(`media schema contract: ${fixture.name} through large targeted JSON copy`, () => {
    const parts = partsOf(fixture);
    assertContract(fixture.name, modelsFrom(parts), modelsFrom(parts.map(part => ({
      value: observeJsonCopy(part.value, { large: true })[0], baseUrl: part.baseUrl,
    }))));
  });

  if(fixture.worker!==false)test(`media schema contract: ${fixture.name} through worker metadata copy`, () => {
    const parts = partsOf(fixture);
    assertContract(fixture.name, modelsFrom(parts), modelsFrom(parts.map(part => ({
      value: copyWorkerMediaMetadata(part.value)[0], baseUrl: part.baseUrl,
    }))));
  });
}

test("media schema contract: direct copyMediaMetadata keeps a supported fixture usable", () => {
  const value = fixtures[0].value;
  const copied = copyMediaMetadata(value);
  assertContract("direct metadata copy", modelsFrom([{ value, baseUrl: BASE }]), modelsFrom([{ value: copied, baseUrl: BASE }]));
});
