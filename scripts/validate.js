const path = require("path");
const {
  applicableReleaseNames,
  lifecycleAppliesToRelease,
  lifecycleRefs,
  loadProducts,
  loadTopics,
  parseArgs,
  releaseById,
  topicIdsFromSections,
  versionBlockRefs,
  versionBlocks,
} = require("./common");

function rel(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || ".";
}

function requireArray(value, label, issues) {
  if (Array.isArray(value)) return value;
  issues.push(`${label}: expected an array`);
  return [];
}

function validateProduct(repoRoot, product, issues) {
  if (product.config.product_id !== product.productId) {
    issues.push(`${rel(repoRoot, product.configPath)}: product_id must match directory name "${product.productId}"`);
  }
  if (!product.config.display_name) {
    issues.push(`${rel(repoRoot, product.configPath)}: missing display_name`);
  }
  if (!product.config.base_path || !String(product.config.base_path).startsWith("/") || !String(product.config.base_path).endsWith("/")) {
    issues.push(`${rel(repoRoot, product.configPath)}: base_path must start and end with "/"`);
  }
}

function validateReleases(repoRoot, product, issues) {
  const orders = new Map();
  const latest = [];

  for (const release of product.releases) {
    const label = rel(repoRoot, release.metadataPath);
    if (release.metadata.release !== release.releaseName) {
      issues.push(`${label}: release must match directory name "${release.releaseName}"`);
    }
    if (!release.metadata.display_name) issues.push(`${label}: missing display_name`);
    if (!release.metadata.status) issues.push(`${label}: missing status`);
    if (!release.metadata.publish_path || !String(release.metadata.publish_path).startsWith("/") || !String(release.metadata.publish_path).endsWith("/")) {
      issues.push(`${label}: publish_path must start and end with "/"`);
    }
    if (!Number.isFinite(release.order)) {
      issues.push(`${label}: order must be a number`);
    } else if (orders.has(release.order)) {
      issues.push(`${label}: duplicate order ${release.order}; also used by ${orders.get(release.order)}`);
    } else {
      orders.set(release.order, release.releaseName);
    }
    if (typeof release.metadata.latest !== "boolean") issues.push(`${label}: latest must be true or false`);
    if (release.metadata.publish !== undefined && typeof release.metadata.publish !== "boolean") {
      issues.push(`${label}: publish must be true or false when specified`);
    }
    if (release.metadata.latest === true) latest.push(release.releaseName);
  }

  if (latest.length !== 1) {
    issues.push(`products/${product.productId}: exactly one release must have latest: true; found ${latest.length}`);
  }
}

function validateLifecycleRefs(repoRoot, product, topic, issues) {
  const known = new Set(product.releases.map((release) => release.releaseName));
  for (const releaseId of lifecycleRefs(topic.lifecycle)) {
    if (!known.has(releaseId)) {
      issues.push(`${rel(repoRoot, topic.path)}: lifecycle references unknown release "${releaseId}" for product ${product.productId}`);
    }
  }

  const applicable = applicableReleaseNames(product, topic);
  if (applicable.length === 0) {
    issues.push(`${rel(repoRoot, topic.path)}: lifecycle does not apply to any known release`);
  }
}

function validateVersionBlocks(repoRoot, product, topic, issues) {
  for (const block of versionBlocks(topic)) {
    const label = `${rel(repoRoot, topic.path)}:${block.lineNumber}`;
    if (block.missingClose) {
      issues.push(`${label}: version block is missing closing ::: marker`);
      continue;
    }

    const hasOnly = Boolean(block.attrs.only);
    const hasRange = Boolean(block.attrs.from || block.attrs.until);
    if (!hasOnly && !hasRange) {
      issues.push(`${label}: version block must use only=\"release\", from=\"release\", or until=\"release\"`);
    }
    if (hasOnly && hasRange) {
      issues.push(`${label}: version block cannot combine only with from/until`);
    }

    for (const releaseId of versionBlockRefs(block)) {
      if (!releaseById(product, releaseId)) {
        issues.push(`${label}: version block references unknown release "${releaseId}" for product ${product.productId}`);
      }
    }

    const matchedReleases = product.releases.filter((release) => {
      const refsKnown = versionBlockRefs(block).every((releaseId) => releaseById(product, releaseId));
      if (!refsKnown) return false;
      const { releaseMatchesVersionBlock } = require("./common");
      return releaseMatchesVersionBlock(product, release, block);
    });

    if (matchedReleases.length === 0 && versionBlockRefs(block).every((releaseId) => releaseById(product, releaseId))) {
      issues.push(`${label}: version block does not match any release`);
    }

    const outsideLifecycle = matchedReleases
      .filter((release) => !lifecycleAppliesToRelease(product, topic.lifecycle, release))
      .map((release) => release.releaseName);
    if (outsideLifecycle.length > 0) {
      issues.push(`${label}: version block matches release(s) outside lifecycle: ${outsideLifecycle.join(", ")}`);
    }
  }
}

function validateTopics(repoRoot, product, issues) {
  const topics = loadTopics(product);
  const topicIds = new Set();

  for (const topic of topics.values()) {
    const label = rel(repoRoot, topic.path);
    if (!topic.topicId) issues.push(`${label}: missing topic_id`);
    if (!topic.title) issues.push(`${label}: missing title`);
    if (topicIds.has(topic.topicId)) issues.push(`${label}: duplicate topic_id "${topic.topicId}"`);
    topicIds.add(topic.topicId);
    if (!topic.lifecycle || typeof topic.lifecycle !== "object") issues.push(`${label}: missing lifecycle object`);
    validateLifecycleRefs(repoRoot, product, topic, issues);
    validateVersionBlocks(repoRoot, product, topic, issues);
  }

  return topics;
}

function validateManifests(repoRoot, product, topics, issues) {
  for (const release of product.releases) {
    if (release.guides.length === 0) {
      issues.push(`${rel(repoRoot, release.releaseRoot)}: expected at least one guide manifest`);
    }

    const bookIds = new Set();
    for (const guide of release.guides) {
      const label = rel(repoRoot, guide.manifestPath);
      if (!guide.manifest.book_id) issues.push(`${label}: missing book_id`);
      if (!guide.manifest.title) issues.push(`${label}: missing title`);
      if (bookIds.has(guide.manifest.book_id)) issues.push(`${label}: duplicate book_id "${guide.manifest.book_id}"`);
      bookIds.add(guide.manifest.book_id);

      const sections = requireArray(guide.manifest.sections, `${label} sections`, issues);
      const seenInGuide = new Set();
      for (const section of sections) {
        if (!section.id) issues.push(`${label}: section is missing id`);
        if (!section.title) issues.push(`${label}: section "${section.id || "(missing id)"}" is missing title`);
        for (const topicId of requireArray(section.topics, `${label} section "${section.id || "(missing id)"}" topics`, issues)) {
          if (seenInGuide.has(topicId)) issues.push(`${label}: topic "${topicId}" appears more than once in this guide`);
          seenInGuide.add(topicId);
          const topic = topics.get(topicId);
          if (!topic) {
            issues.push(`${label}: references missing topic "${topicId}"`);
            continue;
          }
          if (!lifecycleAppliesToRelease(product, topic.lifecycle, release)) {
            issues.push(`${label}: references topic "${topicId}" for ${release.releaseName}, but topic lifecycle does not apply`);
          }
        }
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.root || args._[0] || ".");
  const issues = [];
  const products = loadProducts(repoRoot);

  if (products.length === 0) {
    issues.push("products/: expected at least one product folder");
  }

  for (const product of products) {
    validateProduct(repoRoot, product, issues);
    validateReleases(repoRoot, product, issues);
    const topics = validateTopics(repoRoot, product, issues);
    validateManifests(repoRoot, product, topics, issues);
  }

  if (issues.length > 0) {
    console.error("Validation failed:");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  const releaseCount = products.reduce((count, product) => count + product.releases.length, 0);
  console.log(`Validated ${products.length} product(s) and ${releaseCount} release(s).`);
}

main();
