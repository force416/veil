import { DEFAULTS } from "./core.js";

const form = document.querySelector("form");
const message = document.querySelector("#message");
const fields = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, document.getElementById(key)]));
form.querySelector("button").disabled = true;

async function load() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const settings = await chrome.storage.local.get(DEFAULTS);
  for (const [key, field] of Object.entries(fields)) {
    if (key === "enabled") field.checked = settings[key];
    else field.value = settings[key];
  }
  form.querySelector("button").disabled = false;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const settings = {
    enabled: fields.enabled.checked,
    apiKey: fields.apiKey.value.trim(),
    rules: fields.rules.value.trim(),
    threshold: Number(fields.threshold.value)
  };
  if (!settings.rules || (settings.enabled && !settings.apiKey)) {
    message.textContent = "請填寫過濾條件；啟用時也需要 API Key。";
    return;
  }
  try {
    await chrome.storage.local.set({ ...settings, revision: Date.now() });
    message.textContent = "已儲存，開啟中的 X 頁面會在兩秒內套用。";
  } catch {
    message.textContent = "儲存失敗，請重新開啟設定頁。";
  }
});

load().catch(() => { message.textContent = "讀取設定失敗，請重新載入插件。"; });
