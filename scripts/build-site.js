const fs = require("fs");
const path = require("path");
const {
  escapeHtml,
  lifecycleAppliesToRelease,
  loadProducts,
  loadTopics,
  parseArgs,
  releaseAcceptsUpdates,
  slugify,
  topicRenderedContentHash,
} = require("./common");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtml(markdown) {
  const html = [];
  let paragraph = [];
  let listType = null;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    html.push(listType === "ol" ? "</ol>" : "</ul>");
    listType = null;
  }

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    const unordered = line.match(/^-\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return html.join("\n");
}

function hrefFrom(fromDir, targetPath) {
  return path.relative(fromDir, targetPath).replace(/\\/g, "/") || "index.html";
}

function renderBreadcrumbs(breadcrumbs) {
  if (!breadcrumbs || breadcrumbs.length === 0) return "";

  return `<nav class="breadcrumbs" aria-label="Breadcrumb">
    ${breadcrumbs.map((item, index) => {
      const label = escapeHtml(item.label);
      const content = item.href ? `<a href="${escapeHtml(item.href)}">${label}</a>` : `<span>${label}</span>`;
      const separator = index < breadcrumbs.length - 1 ? '<span class="separator">/</span>' : "";
      return `${content}${separator}`;
    }).join("")}
  </nav>`;
}

function page(title, body, navigation = {}) {
  const homeHref = navigation.homeHref || "index.html";
  const navLinks = navigation.links || [{ label: "Products", href: homeHref }];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #f6f7f8;
      --paper: #ffffff;
      --ink: #17202a;
      --muted: #5c6773;
      --line: #d9dee5;
      --accent: #176b87;
      --accent-soft: #e7f4f8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: var(--canvas);
      font-family: Inter, "Segoe UI", Arial, sans-serif;
    }
    .site-header {
      background: #17202a;
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 16px 24px;
    }
    .brand {
      color: white;
      font-size: 1.05rem;
      font-weight: 800;
      text-decoration: none;
      white-space: nowrap;
    }
    .site-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      justify-content: flex-end;
    }
    .site-nav a {
      color: #dbe7ef;
      font-weight: 700;
      text-decoration: none;
    }
    .site-nav a:hover,
    .brand:hover,
    .breadcrumbs a:hover {
      text-decoration: underline;
    }
    .breadcrumbs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-width: 1120px;
      margin: 0 auto;
      padding: 18px 20px 0;
      color: var(--muted);
      font-size: 0.95rem;
      font-weight: 700;
    }
    .breadcrumbs a {
      color: var(--accent);
      text-decoration: none;
    }
    .breadcrumbs .separator {
      color: #9aa5b1;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }
    h1, h2, h3 { margin: 0 0 12px; line-height: 1.18; }
    h1 { font-size: 2.25rem; }
    h2 { font-size: 1.35rem; margin-top: 22px; }
    p { line-height: 1.65; margin: 0 0 14px; }
    a { color: var(--accent); text-decoration: none; }
    code {
      background: #edf1f4;
      border-radius: 4px;
      padding: 2px 5px;
    }
    .hero, .panel, .topic {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .eyebrow {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .pill {
      display: inline-flex;
      background: var(--accent-soft);
      color: #0d5267;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 0.84rem;
      font-weight: 700;
      margin: 4px 6px 0 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }
    .actions a {
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--accent);
      font-weight: 800;
      padding: 8px 11px;
      text-decoration: none;
    }
    .actions a:hover {
      background: var(--accent-soft);
    }
    li { margin-bottom: 8px; line-height: 1.55; }
    footer {
      max-width: 1120px;
      margin: 0 auto;
      padding: 0 20px 28px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    @media (max-width: 720px) {
      .site-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .site-nav {
        justify-content: flex-start;
      }
      h1 {
        font-size: 2rem;
      }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="${escapeHtml(homeHref)}">Multi-product Docs POC</a>
    <nav class="site-nav" aria-label="Site">
      ${navLinks.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("")}
    </nav>
  </header>
  ${renderBreadcrumbs(navigation.breadcrumbs)}
  ${body}
  <footer>Generated by the shared product-aware build engine.</footer>
</body>
</html>`;
}

function publishDir(siteDir, release) {
  const normalized = String(release.metadata.publish_path).replace(/^\/+|\/+$/g, "");
  return normalized ? path.join(siteDir, ...normalized.split("/")) : siteDir;
}

function productDir(siteDir, product) {
  const productPath = String(product.config.base_path || `/${product.productId}/`).replace(/^\/+|\/+$/g, "");
  return productPath ? path.join(siteDir, ...productPath.split("/")) : siteDir;
}

function defaultGuide(release) {
  return release.guides.find((guide) => guide.isDefault) || release.guides[0];
}

function guideDir(siteDir, release, guide) {
  const base = publishDir(siteDir, release);
  if (guide === defaultGuide(release)) return base;
  return path.join(base, guide.manifest.book_id || slugify(guide.manifest.title));
}

function outputUrlPath(siteDir, filePath) {
  return `/${path.relative(siteDir, filePath).replace(/\\/g, "/")}`;
}

function ledgerEntry(siteDir, outputPath, product, release, guide, topic) {
  return {
    product_id: product.productId,
    release: release.releaseName,
    guide_id: guide.manifest.book_id,
    guide_title: guide.manifest.title,
    topic_id: topic.topicId,
    dedupe_key: topic.retrieval?.dedupe_key || null,
    title: topic.title,
    source_path: `products/${product.productId}/${topic.relativePath}`,
    output_path: path.relative(siteDir, outputPath).replace(/\\/g, "/"),
    url_path: outputUrlPath(siteDir, outputPath),
    content_hash: topicRenderedContentHash(topic),
  };
}

function buildTopicPage(siteDir, outputDir, product, release, guide, topic) {
  const renderedBody = markdownToHtml(topic.body);
  const homeHref = hrefFrom(outputDir, path.join(siteDir, "index.html"));
  const productHref = hrefFrom(outputDir, path.join(productDir(siteDir, product), "index.html"));
  const guideHref = hrefFrom(outputDir, path.join(outputDir, "index.html"));

  return page(
    `${topic.title} - ${release.metadata.display_name}`,
    `<main>
      <article class="topic">
        <div class="eyebrow">${escapeHtml(product.config.display_name)} / ${escapeHtml(release.releaseName)} / ${escapeHtml(guide.manifest.title)}</div>
        ${topic.summary ? `<p>${escapeHtml(topic.summary)}</p>` : ""}
        <p><strong>Topic ID:</strong> <code>${escapeHtml(topic.topicId)}</code></p>
        ${renderedBody}
        <div class="actions">
          <a href="${escapeHtml(guideHref)}">Back to ${escapeHtml(guide.manifest.title)}</a>
        </div>
      </article>
    </main>`,
    {
      homeHref,
      links: [
        { label: "Products", href: homeHref },
        { label: product.config.display_name, href: productHref },
        { label: release.releaseName, href: guideHref },
      ],
      breadcrumbs: [
        { label: "Products", href: homeHref },
        { label: product.config.display_name, href: productHref },
        { label: release.metadata.display_name, href: guideHref },
        { label: topic.title },
      ],
    }
  );
}

function buildGuide(siteDir, product, release, guide, topics, ledger) {
  const outputDir = guideDir(siteDir, release, guide);
  ensureDir(outputDir);
  const homeHref = hrefFrom(outputDir, path.join(siteDir, "index.html"));
  const productHref = hrefFrom(outputDir, path.join(productDir(siteDir, product), "index.html"));

  const sections = (guide.manifest.sections || []).map((section) => {
    const sectionTopics = (section.topics || [])
      .map((topicId) => topics.get(topicId))
      .filter((topic) => topic && lifecycleAppliesToRelease(product, topic.lifecycle, release));
    return { ...section, topics: sectionTopics };
  }).filter((section) => section.topics.length > 0);

  for (const section of sections) {
    for (const topic of section.topics) {
      const outputPath = path.join(outputDir, `${topic.slug}.html`);
      fs.writeFileSync(
        outputPath,
        buildTopicPage(siteDir, outputDir, product, release, guide, topic),
        "utf8"
      );
      ledger.topics.push(ledgerEntry(siteDir, outputPath, product, release, guide, topic));
    }
  }

  const toc = sections.map((section) => `
    <section class="card">
      <div class="eyebrow">${escapeHtml(section.title)}</div>
      <ol>
        ${section.topics.map((topic) => `<li><a href="./${topic.slug}.html">${escapeHtml(topic.title)}</a><br><span>${escapeHtml(topic.summary)}</span></li>`).join("")}
      </ol>
    </section>
  `).join("");

  fs.writeFileSync(
    path.join(outputDir, "index.html"),
    page(
      `${guide.manifest.title} - ${release.metadata.display_name}`,
      `<main>
        <section class="hero">
          <div class="eyebrow">${escapeHtml(product.config.display_name)}</div>
          <h1>${escapeHtml(release.metadata.display_name)}</h1>
          <p>${escapeHtml(guide.manifest.title)} built from product topics and release manifests.</p>
          <span class="pill">Release ${escapeHtml(release.releaseName)}</span>
          ${release.metadata.latest ? '<span class="pill">Latest</span>' : ""}
          <div class="actions">
            <a href="${escapeHtml(productHref)}">All ${escapeHtml(product.config.display_name)} releases</a>
          </div>
        </section>
        <section class="grid">${toc}</section>
      </main>`,
      {
        homeHref,
        links: [
          { label: "Products", href: homeHref },
          { label: product.config.display_name, href: productHref },
        ],
        breadcrumbs: [
          { label: "Products", href: homeHref },
          { label: product.config.display_name, href: productHref },
          { label: release.metadata.display_name },
        ],
      }
    ),
    "utf8"
  );
}

function buildProductIndex(siteDir, product) {
  const outputDir = productDir(siteDir, product);
  ensureDir(outputDir);
  const homeHref = hrefFrom(outputDir, path.join(siteDir, "index.html"));
  const releases = product.releases.filter(releaseAcceptsUpdates);
  const cards = releases.map((release) => {
    const releaseHref = hrefFrom(outputDir, path.join(publishDir(siteDir, release), "index.html"));
    return `
    <article class="card">
      <div class="eyebrow">Release</div>
      <h2><a href="${escapeHtml(releaseHref)}">${escapeHtml(release.metadata.display_name)}</a></h2>
      <p>Release ID: <code>${escapeHtml(release.releaseName)}</code></p>
      ${release.metadata.latest ? '<span class="pill">Latest</span>' : ""}
    </article>
  `;
  }).join("");

  fs.writeFileSync(
    path.join(outputDir, "index.html"),
    page(
      product.config.display_name,
      `<main>
        <section class="hero">
          <div class="eyebrow">Product</div>
          <h1>${escapeHtml(product.config.display_name)}</h1>
          <p>${releases.length} release output(s).</p>
        </section>
        <section class="grid">${cards}</section>
      </main>`,
      {
        homeHref,
        links: [{ label: "Products", href: homeHref }],
        breadcrumbs: [
          { label: "Products", href: homeHref },
          { label: product.config.display_name },
        ],
      }
    ),
    "utf8"
  );
}

function buildHome(siteDir, products) {
  const cards = products.map((product) => {
    const productHref = hrefFrom(siteDir, path.join(productDir(siteDir, product), "index.html"));
    return `
    <article class="card">
      <div class="eyebrow">Product</div>
      <h2><a href="${escapeHtml(productHref)}">${escapeHtml(product.config.display_name)}</a></h2>
      <p>Generated from product metadata and release manifests.</p>
      <p>${product.releases.length} release output(s)</p>
    </article>
  `;
  }).join("");

  fs.writeFileSync(
    path.join(siteDir, "index.html"),
    page(
      "Multi-product Docs POC",
      `<main>
        <section class="hero">
          <div class="eyebrow">Shared build engine</div>
          <h1>One build system, many product release models</h1>
          <p>This site is generated from multiple products with different release number ranges using the same scripts.</p>
        </section>
        <section class="grid">${cards}</section>
      </main>`,
      {
        homeHref: "index.html",
        links: [{ label: "Products", href: "index.html" }],
      }
    ),
    "utf8"
  );
}

function writePublishLedger(siteDir, ledger) {
  ledger.topics.sort((left, right) => (
    left.product_id.localeCompare(right.product_id)
    || left.release.localeCompare(right.release, undefined, { numeric: true })
    || left.guide_id.localeCompare(right.guide_id)
    || left.topic_id.localeCompare(right.topic_id)
  ));

  fs.writeFileSync(
    path.join(siteDir, "publish-ledger.json"),
    `${JSON.stringify({
      schema_version: 1,
      generated_at: new Date().toISOString(),
      source_commit: process.env.GITHUB_SHA || null,
      workflow_run: process.env.GITHUB_RUN_ID || null,
      topics: ledger.topics,
    }, null, 2)}\n`,
    "utf8"
  );
}

function parseReleaseSelection(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.root || args._[0] || ".");
  const siteDir = path.join(repoRoot, "site");
  const selectedProduct = args.product && args.product !== true ? String(args.product) : null;
  const selectedReleases = new Set(parseReleaseSelection(args.releases || args.release));
  const ledger = { topics: [] };

  removeDir(siteDir);
  ensureDir(siteDir);

  const products = loadProducts(repoRoot)
    .filter((product) => !selectedProduct || product.productId === selectedProduct);

  if (selectedProduct && products.length === 0) {
    console.error(`Unknown product: ${selectedProduct}`);
    process.exit(1);
  }

  let builtReleases = 0;
  for (const product of products) {
    const topics = loadTopics(product);
    const releases = product.releases
      .filter(releaseAcceptsUpdates)
      .filter((release) => selectedReleases.size === 0 || selectedReleases.has(release.releaseName));

    for (const release of releases) {
      for (const guide of release.guides) {
        buildGuide(siteDir, product, release, guide, topics, ledger);
      }
      builtReleases += 1;
    }
    buildProductIndex(siteDir, product);
  }

  buildHome(siteDir, products);
  writePublishLedger(siteDir, ledger);
  fs.writeFileSync(path.join(siteDir, ".nojekyll"), "", "utf8");
  console.log(`Built ${builtReleases} release output(s) across ${products.length} product(s).`);
}

main();
