import { DEFAULTS, publicSettings, evaluate, backoffDelay } from "./core.js";

const MAX_CONCURRENT = 4;
const MAX_ATTEMPTS = 3;
const MAX_BACKOFF = 30000;
const COOLDOWN = 60000;

const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const cache = new Map();
const pending = new Map();
const waiting = [];
let active = 0;
let epoch = 0;
let retryAfter = 0;
let authError = "";
let lastError = "";

chrome.storage.onChanged.addListener(() => {
  epoch++;
  cache.clear();
  pending.clear();
  retryAfter = 0;
  authError = "";
  lastError = "";
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tagged = (message, kind) => Object.assign(new Error(message), { kind });

// Caps Jev requests across all tabs. A finishing task hands its slot directly to the next waiter.
async function withSlot(task) {
  if (active < MAX_CONCURRENT) active++;
  else await new Promise(resolve => waiting.push(resolve));
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

async function callJev(start, apiKey, rules, post, reply) {
  for (let attempt = 1; ; attempt++) {
    // Settings may change while this request waits for a slot or a backoff.
    if (epoch !== start) throw tagged("", "stale");
    if (authError) throw tagged(authError, "auth");
    if (Date.now() < retryAfter) throw tagged(lastError, "retry");
    try {
      return await evaluate(apiKey, rules, post, reply);
    } catch (error) {
      if (epoch !== start) throw tagged("", "stale");
      lastError = error.message;
      if (error.kind === "auth") authError = error.message;
      if (error.kind !== "retry") throw error;
      const delay = backoffDelay(attempt, error.retryAfterMs);
      if (attempt >= MAX_ATTEMPTS || delay > MAX_BACKOFF) {
        retryAfter = Date.now() + Math.max(COOLDOWN, error.retryAfterMs || 0);
        throw error;
      }
      await sleep(delay);
    }
  }
}

function request(key, apiKey, rules, post, reply) {
  if (pending.has(key)) return pending.get(key);
  const start = epoch;
  const promise = withSlot(() => callJev(start, apiKey, rules, post, reply))
    .then(probability => {
      if (epoch === start) {
        cache.set(key, probability);
        if (cache.size > 500) cache.delete(cache.keys().next().value);
        lastError = "";
      }
      return probability;
    })
    .finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}

async function handle(message) {
  await ready;
  const settings = await chrome.storage.local.get({ ...DEFAULTS, revision: 0 });
  const config = publicSettings(settings);
  const revision = JSON.stringify([config, settings.revision]);
  if (message.type === "config") return { ...config, revision, lastError };
  if (message.type !== "evaluate" || !config.enabled || message.revision !== revision) return { skipped: true };
  const { post, reply } = message;
  if (typeof post !== "string" || typeof reply !== "string" || !reply.trim() || post.length > 12000 || reply.length > 12000) {
    return { skipped: true };
  }
  const key = JSON.stringify([settings.apiKey, config.rules, post, reply]);
  let probability = cache.get(key);
  if (probability === undefined) {
    if (authError) return { error: authError };
    if (Date.now() < retryAfter) return { error: lastError, retryAt: retryAfter };
    try {
      probability = await request(key, settings.apiKey, config.rules, post, reply);
    } catch (error) {
      if (error.kind === "stale") return { skipped: true };
      // Only transient failures tell the page when to ask again; auth and rejected replies wait for new settings.
      return error.kind === "retry" ? { error: error.message, retryAt: retryAfter || Date.now() + COOLDOWN } : { error: error.message };
    }
  }
  return { hide: probability >= config.threshold, probability, revision };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !["config", "evaluate"].includes(message?.type)) return;
  if (message.type === "evaluate" && !/^https:\/\/(www\.)?(x\.com|twitter\.com)\//.test(sender.url || "")) return;
  handle(message).then(sendResponse, () => sendResponse({ error: "無法執行過濾，請檢查設定與網路。" }));
  return true;
});
