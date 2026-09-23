/* Shared with the DOM fixture tests. No X page scripts or credentials are used. */
globalThis.VeilDOM = (() => {
  function statusId(path) {
    return path.match(/^\/[\w]+\/status\/(\d+)\/?$/)?.[1] || null;
  }

  function readArticle(article) {
    // A timestamp permalink identifies the outer tweet, excluding quoted cards.
    const time = article.querySelector('a[href*="/status/"] > time');
    const link = time?.parentElement;
    const id = link && statusId(new URL(link.href, "https://x.com").pathname);
    const textNode = [...article.querySelectorAll('[data-testid="tweetText"]')].find(node => !node.closest('[role="link"]'));
    const text = textNode?.textContent?.trim() || "";
    return { id, text };
  }

  function collect(document, threadId) {
    const column = document.querySelector('[data-testid="primaryColumn"]');
    const articles = [...(column?.querySelectorAll('article[data-testid="tweet"]') || [])];
    const root = articles.findIndex(article => readArticle(article).id === threadId);
    if (root < 0) return null;
    // Only the timeline containing the main post is eligible; never sidebar cards.
    const timeline = articles[root].closest('[aria-label][role="region"]') || column;
    const replies = articles.slice(root + 1).filter(article => timeline.contains(article) && readArticle(article).id !== threadId);
    return {
      post: readArticle(articles[root]).text,
      timeline,
      headings: [...timeline.querySelectorAll('h2, [role="heading"]')].filter(heading => Boolean(heading.compareDocumentPosition(articles[root]) & 4)),
      ancestors: articles.slice(0, root).map(article => readArticle(article).id),
      replies
    };
  }

  function beforeRecommendation(article, timeline, initialHeadings = new Set()) {
    // X renders recommendation sections with headings. Fail open after any section heading.
    return ![...timeline.querySelectorAll('h2, [role="heading"]')].some(heading =>
      !initialHeadings.has(heading) && !heading.closest("article") && Boolean(heading.compareDocumentPosition(article) & 4)
    );
  }

  return { statusId, readArticle, collect, beforeRecommendation };
})();
