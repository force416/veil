(() => {
  const { statusId, readArticle, collect, beforeRecommendation } = VeilDOM;
  const MAX_IN_FLIGHT = 4;
  let config;
  let thread = null;
  let generation = 0;
  let inFlight = 0;
  let records = new WeakMap();
  let post = "";
  let eligible = new Set();
  let timeline = null;
  let ancestors = new Set();
  let initialHeadings = new Set();
  let notice;

  function restore() {
    document.querySelectorAll('[data-veil-hidden]').forEach(node => node.removeAttribute("data-veil-hidden"));
  }

  function reset() {
    generation++;
    restore();
    records = new WeakMap();
    eligible.clear();
    timeline = null;
    ancestors.clear();
    initialHeadings.clear();
    post = "";
  }

  function showStatus(error = "") {
    if (!config?.enabled || !thread) {
      notice?.remove();
      notice = null;
      return;
    }
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "veil-status";
      document.body.append(notice);
    }
    const count = document.querySelectorAll('[data-veil-hidden="true"]').length;
    const text = error ? `Veil：${error}` : `Veil · 目前隱藏 ${count} 則留言`;
    if (notice.textContent !== text) notice.textContent = text;
  }

  async function refresh() {
    try {
      const next = await chrome.runtime.sendMessage({ type: "config" });
      if (!next?.revision) return;
      if (next.revision !== config?.revision) reset();
      config = next;
      scan();
    } catch {
      config = null;
      reset();
      showStatus();
    }
  }

  function scan() {
    const nextThread = statusId(location.pathname);
    if (nextThread !== thread) {
      thread = nextThread;
      reset();
    }
    showStatus(config?.lastError);
    if (!config?.enabled || !thread) return;
    const context = collect(document, thread);
    if (context) {
      post = context.post;
      timeline = context.timeline;
      initialHeadings = new Set(context.headings);
      context.ancestors.forEach(id => ancestors.add(id));
      for (const article of context.replies) eligible.add(readArticle(article).id);
    } else if (timeline?.isConnected) {
      for (const article of timeline.querySelectorAll('article[data-testid="tweet"]')) {
        const { id } = readArticle(article);
        if (!ancestors.has(id)) eligible.add(id);
      }
    }
    const articles = document.querySelectorAll('[data-testid="primaryColumn"] article[data-testid="tweet"]');
    for (const article of articles) {
      const value = readArticle(article);
      const signature = JSON.stringify(value);
      const record = records.get(article);
      if (record?.signature !== signature || value.id === thread) article.removeAttribute("data-veil-hidden");
      if (inFlight >= MAX_IN_FLIGHT || !timeline?.contains(article) || !beforeRecommendation(article, timeline, initialHeadings) || !eligible.has(value.id) || !value.id || value.id === thread || !value.text || value.text.length > 12000 || post.length > 12000) continue;
      // Transient failures carry retryAt; other results stay final until the signature or settings change.
      if (record?.signature === signature && (!record.retryAt || Date.now() < record.retryAt)) continue;
      records.set(article, { signature });
      inFlight++;
      const token = generation;
      const path = location.pathname;
      chrome.runtime.sendMessage({ type: "evaluate", revision: config.revision, post, reply: value.text })
        .then(result => {
          if (token !== generation || path !== location.pathname || !article.isConnected || JSON.stringify(readArticle(article)) !== signature) return;
          if (result?.retryAt) records.set(article, { signature, retryAt: result.retryAt });
          if (result?.hide && result.revision === config.revision) article.setAttribute("data-veil-hidden", "true");
          showStatus(result?.error);
        })
        .catch(() => showStatus("連線失敗，已保留留言。"))
        .finally(() => { inFlight--; });
    }
  }

  // Polling also detects SPA navigation and virtualized/reused tweet elements.
  setInterval(scan, 500);
  setInterval(refresh, 2000);
  refresh();
})();
