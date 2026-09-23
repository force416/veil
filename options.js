import { DEFAULTS } from "./core.js";

const form = document.querySelector("form");
const message = document.querySelector("#message");
const fields = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, document.getElementById(key)]));
const controls = [form.querySelector("button"), fields.enabled];
controls.forEach(control => { control.disabled = true; });

async function load() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const settings = await chrome.storage.local.get(DEFAULTS);
  for (const [key, field] of Object.entries(fields)) {
    if (key === "enabled") field.checked = settings[key];
    else field.value = settings[key];
  }
  controls.forEach(control => { control.disabled = false; });
}

// The switch saves the whole form right away; if the form can't be saved, flip it back.
fields.enabled.addEventListener("change", () => {
  if (form.checkValidity()) return form.requestSubmit();
  fields.enabled.checked = !fields.enabled.checked;
  form.reportValidity();
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const settings = {
    enabled: fields.enabled.checked,
    apiKey: fields.apiKey.value.trim(),
    rules: fields.rules.value.trim(),
    threshold: Number(fields.threshold.value)
  };
  if (!settings.rules || (settings.enabled && !settings.apiKey)) {
    if (!event.submitter) fields.enabled.checked = !settings.enabled;
    message.textContent = "Enter your filter rules. An API key is also required when filtering is enabled.";
    return;
  }
  try {
    await chrome.storage.local.set({ ...settings, revision: Date.now() });
    message.textContent = "Saved. Open X tabs will apply the change within two seconds.";
  } catch {
    message.textContent = "Couldn't save. Reopen the settings page and try again.";
  }
});

load().catch(() => { message.textContent = "Couldn't load settings. Reload the extension."; });
