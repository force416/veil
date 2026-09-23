import test, { after } from "node:test";
import assert from "node:assert/strict";

let listener;
let changed;
let accessLevel;
let calls = 0;
let respond;
const settings = { enabled: true, apiKey: "secret", rules: "ads", threshold: 0.85, revision: 1 };
const response = (status, noul = 0.9, headers = {}) => ({
  ok: status === 200,
  status,
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  json: async () => ({ answers: { hide: { type: "noul", noul } } })
});
globalThis.chrome = {
  storage: {
    local: {
      setAccessLevel: async value => { accessLevel = value.accessLevel; },
      get: async defaults => ({ ...defaults, ...settings })
    },
    onChanged: { addListener: fn => { changed = fn; } }
  },
  runtime: { id: "test", onMessage: { addListener: fn => { listener = fn; } } }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  calls++;
  return respond();
};
await import("../background.js");
after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.chrome;
});

function send(message) {
  return new Promise(resolve => listener(message, { id: "test", url: "https://x.com/user/status/1" }, resolve));
}

// Simulates saving settings and returns a request bound to the new revision.
async function fresh(next = () => response(200)) {
  settings.revision++;
  changed({ revision: {} });
  respond = next;
  calls = 0;
  const { revision } = await send({ type: "config" });
  return { type: "evaluate", revision, post: "main", reply: "ad" };
}

async function until(check) {
  for (let i = 0; i < 1000 && !check(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(check());
}

test("設定隔離、門檻、快取與過期結果", async () => {
  const config = await send({ type: "config" });
  assert.equal(accessLevel, "TRUSTED_CONTEXTS");
  assert.equal(JSON.stringify(config).includes("secret"), false);
  const request = await fresh();
  assert.equal((await send(request)).hide, true);
  assert.equal((await send(request)).hide, true);
  assert.equal(calls, 1);
  settings.revision++;
  settings.threshold = 0.95;
  changed({ revision: {} });
  assert.equal((await send(request)).skipped, true);
  request.revision = (await send({ type: "config" })).revision;
  assert.equal((await send(request)).hide, false);
  settings.threshold = 0.85;
});

test("跨分頁最多同時 4 個請求，相同內容共用同一請求", async () => {
  let running = 0;
  let peak = 0;
  const gates = [];
  const request = await fresh(() => {
    peak = Math.max(peak, ++running);
    return new Promise(resolve => gates.push(() => { running--; resolve(response(200)); }));
  });
  const replies = ["r0", "r1", "r2", "r3", "r4", "r5", "r0"];
  const results = Promise.all(replies.map(reply => send({ ...request, reply })));
  await until(() => gates.length === 4);
  while (calls < 6 || gates.length) {
    gates.shift()?.();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok((await results).every(result => result.hide === true));
  assert.equal(peak, 4);
  assert.equal(calls, 6);
});

test("529 暫時錯誤會退避後重試成功", async () => {
  const statuses = [529, 200];
  const request = await fresh(() => response(statuses.shift()));
  const result = await send(request);
  assert.equal(result.hide, true);
  assert.equal(calls, 2);
});

test("429 的 retry-after 過長時進入冷卻，並回傳重試時間", async () => {
  const request = await fresh(() => response(429, 0.9, { "retry-after": "120" }));
  const result = await send(request);
  assert.match(result.error, /429/);
  assert.ok(result.retryAt >= Date.now() + 110000);
  assert.equal(calls, 1);
  const other = await send({ ...request, reply: "another" });
  assert.match(other.error, /429/);
  assert.equal(other.retryAt, result.retryAt);
  assert.equal(calls, 1);
});

test("401 停止所有請求直到設定變更，且不提供重試時間", async () => {
  let request = await fresh(() => response(401));
  const result = await send(request);
  assert.match(result.error, /401.*API Key/);
  assert.equal(result.retryAt, undefined);
  assert.match((await send({ ...request, reply: "another" })).error, /401/);
  assert.equal(calls, 1);
  request = await fresh();
  assert.equal((await send(request)).hide, true);
});

test("422 只影響該則留言，不暫停其他請求", async () => {
  const request = await fresh(() => response(422));
  const result = await send(request);
  assert.match(result.error, /422/);
  assert.equal(result.retryAt, undefined);
  respond = () => response(200);
  assert.equal((await send({ ...request, reply: "another" })).hide, true);
  assert.equal(calls, 2);
});

test("切換是否隱藏已過濾留言不會清除快取或改變 revision", async () => {
  const request = await fresh();
  assert.equal((await send(request)).hide, true);
  settings.hideFiltered = false;
  changed({ hideFiltered: { oldValue: true, newValue: false } });
  const config = await send({ type: "config" });
  assert.equal(config.hideFiltered, false);
  assert.equal(config.revision, request.revision);
  assert.equal((await send(request)).hide, true);
  assert.equal(calls, 1);
  delete settings.hideFiltered;
});

test("停用後不送出請求", async () => {
  settings.enabled = false;
  const request = await fresh();
  assert.equal((await send(request)).skipped, true);
  assert.equal(calls, 0);
  settings.enabled = true;
});
