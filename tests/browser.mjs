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
  assert.equal(await page.locator("#tweet-100").getAttribute("data-veil-hidden"), null);
  assert.equal(await page.locator("#tweet-99").getAttribute("data-veil-hidden"), null);
  assert.equal(await page.locator("#tweet-102").getAttribute("data-veil-hidden"), null);
  assert.equal(await page.locator("#tweet-900").getAttribute("data-veil-hidden"), null);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tweet-101"), "::after").content), '"Hidden by Veil · Click to show"');
  await page.evaluate(() => document.querySelector("#tweet-101 [data-testid=tweetText]").style.height = "500px");
  assert.equal(await page.evaluate(() => document.querySelector("#tweet-101").offsetHeight), 80);
  assert.equal(await page.locator("#tweet-101 [data-testid=tweetText]").isVisible(), false);

  // The first click removes the mask without reaching X's handlers; the reveal survives a remount.
  await page.evaluate(() => {
    window.xClicks = 0;
    document.querySelector("section").addEventListener("click", () => window.xClicks++);
  });
  await page.locator("#tweet-101").click();
  assert.equal(await page.evaluate(() => document.querySelector("#tweet-101").dataset.veilHidden), "revealed");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tweet-101"), "::after").content), "none");
  assert.equal(await page.evaluate(() => document.querySelector("#tweet-101").offsetHeight > 500), true);
  await page.evaluate(() => document.querySelector("#tweet-101 [data-testid=tweetText]").style.height = "");
  assert.equal(await page.evaluate(() => window.xClicks), 0);
  await page.locator("#tweet-101").click();
  assert.equal(await page.evaluate(() => window.xClicks), 1);
  await page.evaluate(html => document.querySelector("section").insertAdjacentHTML("beforeend", html), article(101, "ad").replace('id="tweet-101"', 'id="tweet-101b"'));
  await page.waitForFunction(() => document.querySelector("#tweet-101b").dataset.veilHidden === "revealed");

  // Root virtualizes away; new replies still use the previously captured main text.
  await page.evaluate(html => {
    document.querySelector("#tweet-100").remove();
    document.querySelector("section").insertAdjacentHTML("beforeend", html);
  }, article(103, "ad"));
  await page.waitForFunction(() => document.querySelector("#tweet-103").dataset.veilHidden === "true");

  // A masked video cannot autoplay. Keyboard shortcuts stay blocked until Enter reveals the reply.
  const paused = await page.evaluate(async () => {
    const video = document.createElement("video");
    document.querySelector("#tweet-103").append(video);
    video.play().catch(() => {});
    await new Promise(resolve => video.addEventListener("pause", resolve, { once: true }));
    return video.paused;
  });
  assert.equal(paused, true);
  await page.evaluate(() => {
    window.xKeys = [];
    document.querySelector("section").addEventListener("keydown", event => window.xKeys.push(event.key));
    document.querySelector("#tweet-103").tabIndex = 0;
    document.querySelector("#tweet-103").focus();
  });
  await page.keyboard.press("l");
  await page.keyboard.press("j");
  assert.deepEqual(await page.evaluate(() => window.xKeys), ["j"]);
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.querySelector("#tweet-103").dataset.veilHidden), "revealed");
  assert.deepEqual(await page.evaluate(() => window.xKeys), ["j"]);
  assert.equal(await page.evaluate(() => window.calls.at(-1).post), "main");

  // Emoji images keep their alt text, and the author name and handle are sent without the timestamp.
  await page.evaluate(() => {
    document.querySelector("section").insertAdjacentHTML("beforeend", `<article data-testid="tweet" id="tweet-104"><div data-testid="User-Name"><a href="/bot"><span>严丽<img alt="🌸">同城上门</span></a><a href="/bot">@bot</a><a href="/bot/status/104"><time>8h</time></a></div><div data-testid="tweetText">玩的开<img alt="🍰">ad</div></article>`);
  });
  await page.waitForFunction(() => window.calls.some(call => call.reply === "玩的开🍰ad"));
  assert.equal(await page.evaluate(() => window.calls.find(call => call.reply === "玩的开🍰ad").author), "严丽🌸同城上门 (@bot)");

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
  assert.equal(await page.locator("#tweet-105").getAttribute("data-veil-hidden"), null);

  // Recommendations with a section heading are excluded; disabling restores replies.
  await page.evaluate(html => {
    document.querySelector("section").innerHTML = html;
    history.pushState({}, "", "/user/status/200");
  }, `${article(200, "main two")}${article(201, "ad")}<h2>Discover more</h2>${article(202, "ad recommended")}`);
  await page.waitForFunction(() => document.querySelector("#tweet-201").dataset.veilHidden === "true");
  assert.equal(await page.locator("#tweet-202").getAttribute("data-veil-hidden"), null);
  assert.equal(await page.evaluate(() => window.calls.some(call => call.reply === "ad recommended")), false);
  await page.evaluate(() => { window.config.enabled = false; window.config.revision = "two"; });
  await page.waitForFunction(() => document.querySelectorAll('[data-veil-hidden]').length === 0);
  assert.equal(await page.locator("#tweet-201").getAttribute("data-veil-hidden"), null);
  console.log("PASS: main/ancestor/sidebar protection, filtering, click and keyboard reveal, video pause, virtualization, recycled DOM, SPA stale response, recommendation boundary, disable restore");

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
