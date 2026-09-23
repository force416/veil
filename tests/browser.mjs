import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const playwright = process.env.PLAYWRIGHT_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href)
  : await import("playwright");
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
});
const page = await browser.newPage();
const article = (id, text) => `<article data-testid="tweet" id="tweet-${id}"><a href="/user/status/${id}"><time>now</time></a><div data-testid="tweetText">${text}</div></article>`;
try {
  await page.route("https://x.com/**", route => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("https://x.com/user/status/100");
  await page.setContent(`<div data-testid="primaryColumn"><section role="region" aria-label="Timeline"><h2>Conversation</h2>${article(99, "ancestor")}${article(100, "main")}${article(101, "ad")}${article(102, "normal")}</section></div><aside>${article(900, "ad")}</aside>`);
  await page.evaluate(() => {
    window.calls = [];
    window.config = { enabled: true, rules: "ads", threshold: 0.85, revision: "one" };
    window.chrome = { runtime: { sendMessage: async message => {
      if (message.type === "config") return { ...window.config };
      window.calls.push(message);
      if (message.reply === "delayed ad") await new Promise(resolve => { window.resolveDelayed = resolve; });
      return { hide: message.reply.includes("ad"), revision: message.revision };
    } } };
  });
  await page.addStyleTag({ path: "content.css" });
  await page.addScriptTag({ path: "dom.js" });
  await page.addScriptTag({ path: "content.js" });
  await page.waitForFunction(() => document.querySelector("#tweet-101").dataset.veilHidden === "true");
  await page.waitForFunction(() => window.calls.length === 2);
  assert.equal(await page.locator("#tweet-100").isVisible(), true);
  assert.equal(await page.locator("#tweet-99").isVisible(), true);
  assert.equal(await page.locator("#tweet-102").isVisible(), true);
  assert.equal(await page.locator("#tweet-900").isVisible(), true);
  assert.equal(await page.locator("#tweet-101").isVisible(), false);

  // Turning off "hide filtered replies" shows originals without re-evaluating.
  await page.evaluate(() => { window.config.hideFiltered = false; });
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-veil-reveal"));
  assert.equal(await page.locator("#tweet-101").isVisible(), true);
  assert.match(await page.locator("#veil-status").textContent(), /matched, shown/);
  await page.evaluate(() => { window.config.hideFiltered = true; });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-veil-reveal"));
  assert.equal(await page.locator("#tweet-101").isVisible(), false);
  assert.equal(await page.evaluate(() => window.calls.length), 2);

  // Root virtualizes away; new replies still use the previously captured main text.
  await page.evaluate(html => {
    document.querySelector("#tweet-100").remove();
    document.querySelector("section").insertAdjacentHTML("beforeend", html);
  }, article(103, "ad"));
  await page.waitForFunction(() => document.querySelector("#tweet-103").dataset.veilHidden === "true");
  assert.equal(await page.evaluate(() => window.calls.at(-1).post), "main");

  // React reuses the hidden element for an ordinary reply.
  await page.evaluate(() => {
    const node = document.querySelector("#tweet-101");
    node.querySelector("a").href = "/user/status/104";
    node.querySelector('[data-testid="tweetText"]').textContent = "ordinary";
  });
  await page.waitForFunction(() => !document.querySelector("#tweet-101").hasAttribute("data-veil-hidden"));
  await page.waitForFunction(() => window.calls.some(call => call.reply === "ordinary"));

  // A late result must not hide an element after SPA navigation.
  await page.evaluate(html => document.querySelector("section").insertAdjacentHTML("beforeend", html), article(105, "delayed ad"));
  await page.waitForFunction(() => Boolean(window.resolveDelayed));
  await page.evaluate(() => { history.pushState({}, "", "/home"); window.resolveDelayed(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-veil-hidden]').length === 0);
  assert.equal(await page.locator("#tweet-105").isVisible(), true);

  // Recommendations with a section heading are excluded; disabling restores replies.
  await page.evaluate(html => {
    document.querySelector("section").innerHTML = html;
    history.pushState({}, "", "/user/status/200");
  }, `${article(200, "main two")}${article(201, "ad")}<h2>Discover more</h2>${article(202, "ad recommended")}`);
  await page.waitForFunction(() => document.querySelector("#tweet-201").dataset.veilHidden === "true");
  assert.equal(await page.locator("#tweet-202").isVisible(), true);
  assert.equal(await page.evaluate(() => window.calls.some(call => call.reply === "ad recommended")), false);
  await page.evaluate(() => { window.config.enabled = false; window.config.revision = "two"; });
  await page.waitForFunction(() => document.querySelectorAll('[data-veil-hidden]').length === 0);
  assert.equal(await page.locator("#tweet-201").isVisible(), true);
  console.log("PASS: main/ancestor/sidebar protection, filtering, show/hide toggle, virtualization, recycled DOM, SPA stale response, recommendation boundary, disable restore");

  await page.goto("https://x.com/options-preview");
  await page.setContent(await (await import("node:fs/promises")).readFile("options.html", "utf8"));
  await page.addStyleTag({ path: "options.css" });
  await page.locator("#rules").fill("商業廣告、導流推銷或詐騙留言。正常討論與提醒詐騙的留言保留。");
  await page.locator("#threshold").fill("0.85");
  await page.setViewportSize({ width: 420, height: 800 });
  await page.screenshot({ path: "/tmp/veil-options.png" });
} finally {
  await browser.close();
}
