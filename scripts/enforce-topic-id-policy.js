const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  lifecycleAppliesToRelease,
  loadProducts,
  loadTopics,
  normalizePath,
  parseArgs,
  parseTopicDocument,
  releaseAcceptsUpdates,
  topicIdsFromSections,
  topicRenderedContentHash,
} = require("./common");

function usage() {
  console.error(`Usage:
node scripts/enforce-topic-id-policy.js . \\
  --ledger site/publish-ledger.json \\
  --base <base-sha> \\
  --head <head-sha>

Also supports:
  --ledger-url <url>       Read the last published ledger from a deployed site.
  --files <path>           Check specific changed files.
  --changed-files <path>   Read changed files from a newline-delimited file.
  --all                    Check every topic file in the repo.

The script blocks rendered-content edits to topic_ids that are already present
in the last published ledger for the same product and release.`);
}

function splitFileList(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function allTopicFiles(products, repoRoot) {
  const files = [];
  for (const product of products) {
    if (!fs.existsSync(product.topicsDir)) continue;
    for (const fileName of fs.readdirSync(product.topicsDir).filter((name) => name.endsWith(".md"))) {
      files.push(normalizePath(path.relative(repoRoot, path.join(product.topicsDir, fileName))));
    }
  }
  return files.sort();
}

function readChangedFiles(args, repoRoot, products) {
  if (args.all === true) return allTopicFiles(products, repoRoot);

  const files = [];
  for (const value of args.files || []) files.push(...splitFileList(value));

  if (args["changed-files"]) {
    files.push(...fs.readFileSync(path.resolve(repoRoot, args["changed-files"]), "utf8").split(/\r?\n/).filter(Boolean));
  }

  if (args.base && args.base !== true && args.head && args.head !== true) {
    const output = execFileSync("git", ["diff", "--name-only", args.base, args.head], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    files.push(...output.split(/\r?\n/).filter(Boolean));
  }

  return [...new Set(files.map(normalizePath))].sort();
}

function requestJson(urlString, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects while reading ${urlString}`));
      return;
    }

    const url = new URL(urlString);
    const client = url.protocol === "http:" ? http : https;
    const request = client.get(url, { headers: { accept: "application/json" } }, (response) => {
      const redirectCodes = new Set([301, 302, 303, 307, 308]);
      if (redirectCodes.has(response.statusCode) && response.headers.location) {
        response.resume();
        resolve(requestJson(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }

      if (response.statusCode === 404) {
        response.resume();
        resolve(null);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Could not read ${urlString}; HTTP ${response.statusCode}`));
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Could not parse JSON from ${urlString}: ${error.message}`));
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(15000, () => {
      request.destroy(new Error(`Timed out reading ${urlString}`));
    });
  });
}

async function loadLedger(args, repoRoot) {
  if (args.ledger && args.ledger !== true) {
    const ledgerPath = path.resolve(repoRoot, args.ledger);
    if (!fs.existsSync(ledgerPath)) throw new Error(`Publish ledger not found: ${ledgerPath}`);
    return JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  }

  if (args["ledger-url"] && args["ledger-url"] !== true) {
    return requestJson(String(args["ledger-url"]));
  }

  const localLedger = path.join(repoRoot, "site", "publish-ledger.json");
  if (fs.existsSync(localLedger)) return JSON.parse(fs.readFileSync(localLedger, "utf8"));

  return null;
}

function topicProductId(filePath) {
  const parts = filePath.split("/");
  if (parts.length < 4) return null;
  if (parts[0] !== "products" || parts[2] !== "topics" || !filePath.endsWith(".md")) return null;
  return parts[1];
}

function ledgerKey(productId, releaseName, topicId) {
  return `${productId}\u0000${releaseName}\u0000${topicId}`;
}

function indexLedger(ledger) {
  const byProductReleaseTopic = new Map();
  const byProductTopic = new Map();

  for (const entry of ledger.topics || []) {
    const releaseTopicKey = ledgerKey(entry.product_id, entry.release, entry.topic_id);
    if (!byProductReleaseTopic.has(releaseTopicKey)) byProductReleaseTopic.set(releaseTopicKey, []);
    byProductReleaseTopic.get(releaseTopicKey).push(entry);

    const topicKey = `${entry.product_id}\u0000${entry.topic_id}`;
    if (!byProductTopic.has(topicKey)) byProductTopic.set(topicKey, []);
    byProductTopic.get(topicKey).push(entry);
  }

  return { byProductReleaseTopic, byProductTopic };
}

function selectedPublishedReleaseNames(product, topic) {
  const releaseNames = [];

  for (const release of product.releases.filter(releaseAcceptsUpdates)) {
    const topicIds = release.guides.flatMap((guide) => topicIdsFromSections(guide.manifest.sections));
    if (!topicIds.includes(topic.topicId)) continue;
    if (!lifecycleAppliesToRelease(product, topic.lifecycle, release)) continue;
    releaseNames.push(release.releaseName);
  }

  return releaseNames;
}

function currentTopicForPath(repoRoot, product, filePath) {
  const fullPath = path.join(repoRoot, filePath);
  if (!fs.existsSync(fullPath)) return null;

  const topics = loadTopics(product);
  const relativeTopicPath = normalizePath(filePath.replace(`products/${product.productId}/`, ""));
  return [...topics.values()].find((topic) => topic.relativePath === relativeTopicPath) || null;
}

function readBaseTopic(repoRoot, baseRef, filePath) {
  if (!baseRef) return null;
  try {
    const source = execFileSync("git", ["show", `${baseRef}:${filePath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseTopicDocument(source);
  } catch (_error) {
    return null;
  }
}

function publishedEntriesForTopic(ledgerIndex, productId, topicId) {
  return ledgerIndex.byProductTopic.get(`${productId}\u0000${topicId}`) || [];
}

function enforcePolicy(repoRoot, products, changedFiles, ledger, baseRef) {
  const productMap = new Map(products.map((product) => [product.productId, product]));
  const ledgerIndex = indexLedger(ledger);
  const issues = [];
  const checkedTopicFiles = changedFiles.filter(topicProductId);

  for (const filePath of checkedTopicFiles) {
    const productId = topicProductId(filePath);
    const product = productMap.get(productId);
    if (!product) continue;

    const currentTopic = currentTopicForPath(repoRoot, product, filePath);
    const baseTopic = readBaseTopic(repoRoot, baseRef, filePath);
    const baseTopicId = baseTopic?.frontmatter?.topic_id;

    if (baseTopicId) {
      const publishedBaseEntries = publishedEntriesForTopic(ledgerIndex, productId, baseTopicId);
      if (publishedBaseEntries.length > 0 && (!currentTopic || currentTopic.topicId !== baseTopicId)) {
        const releases = [...new Set(publishedBaseEntries.map((entry) => entry.release))].join(", ");
        issues.push(`${filePath}: published topic_id "${baseTopicId}" was removed or changed in place for ${productId} release(s) ${releases}. Keep the old topic file and create a new topic variant instead.`);
        continue;
      }
    }

    if (!currentTopic) continue;

    const currentHash = topicRenderedContentHash(currentTopic);
    for (const releaseName of selectedPublishedReleaseNames(product, currentTopic)) {
      const ledgerEntries = ledgerIndex.byProductReleaseTopic.get(ledgerKey(productId, releaseName, currentTopic.topicId)) || [];
      if (ledgerEntries.length === 0) continue;

      const changedInPlace = ledgerEntries.some((entry) => entry.content_hash && entry.content_hash !== currentHash);
      if (changedInPlace) {
        issues.push(`${filePath}: topic_id "${currentTopic.topicId}" is already published for ${productId} ${releaseName}, and its rendered content changed in place. Create a new variant with: node scripts/create-topic-variant.js . --product ${productId} --from-topic ${currentTopic.topicId} --release ${releaseName} --update-manifests`);
      }
    }
  }

  return { issues, checkedTopicFiles };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) {
    usage();
    return;
  }

  const repoRoot = path.resolve(args.root || args._[0] || ".");
  const products = loadProducts(repoRoot);
  const changedFiles = readChangedFiles(args, repoRoot, products);
  const ledger = await loadLedger(args, repoRoot);

  if (!ledger) {
    console.log("No published topic ledger found; skipping published topic_id policy enforcement.");
    return;
  }

  if (!Array.isArray(ledger.topics)) {
    throw new Error("Publish ledger is missing a topics array.");
  }

  const baseRef = args.base && args.base !== true ? String(args.base) : null;
  const { issues, checkedTopicFiles } = enforcePolicy(repoRoot, products, changedFiles, ledger, baseRef);

  if (issues.length > 0) {
    console.error("Published topic_id policy failed:");
    for (const issue of issues) console.error(`- ${issue}`);
    console.error("A topic is considered published only when it appears in publish-ledger.json from a successful deployment.");
    process.exit(1);
  }

  console.log(`Published topic_id policy passed for ${checkedTopicFiles.length} changed topic file(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
