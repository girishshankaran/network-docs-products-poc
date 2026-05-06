const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  lifecycleAppliesToRelease,
  loadProducts,
  loadTopics,
  normalizePath,
  parseArgs,
  releaseAcceptsUpdates,
  topicIdsFromSections,
} = require("./common");

function readChangedFiles(args, repoRoot) {
  const files = [];

  for (const value of args.files || []) {
    files.push(...String(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean));
  }

  if (args["changed-files"]) {
    files.push(...fs.readFileSync(path.resolve(repoRoot, args["changed-files"]), "utf8").split(/\r?\n/).filter(Boolean));
  }

  if (args.base && args.head) {
    const output = execFileSync("git", ["diff", "--name-only", args.base, args.head], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    files.push(...output.split(/\r?\n/).filter(Boolean));
  }

  return [...new Set(files.map(normalizePath))].sort();
}

function allProductReleases(product) {
  return product.releases
    .filter(releaseAcceptsUpdates)
    .map((release) => release.releaseName);
}

function manifestsContainingTopic(product, topicId) {
  const releases = [];
  for (const release of product.releases) {
    const topicIds = release.guides.flatMap((guide) => topicIdsFromSections(guide.manifest.sections));
    if (topicIds.includes(topicId)) releases.push(release);
  }
  return releases;
}

function topicImpacts(product, topic) {
  return manifestsContainingTopic(product, topic.topicId)
    .filter(releaseAcceptsUpdates)
    .filter((release) => lifecycleAppliesToRelease(product, topic.lifecycle, release))
    .map((release) => release.releaseName);
}

function addImpacts(impactMap, productId, releaseNames) {
  if (!impactMap.has(productId)) impactMap.set(productId, new Set());
  const releaseSet = impactMap.get(productId);
  for (const releaseName of releaseNames) releaseSet.add(releaseName);
}

function detectImpacts(repoRoot, changedFiles, products) {
  const productMap = new Map(products.map((product) => [product.productId, product]));
  const impactMap = new Map();

  for (const filePath of changedFiles) {
    if (filePath === "products.yml" || filePath.startsWith("scripts/")) {
      for (const product of products) addImpacts(impactMap, product.productId, allProductReleases(product));
      continue;
    }

    if (!filePath.startsWith("products/")) continue;

    const [, productId, area, releaseName] = filePath.split("/");
    const product = productMap.get(productId);
    if (!product) {
      for (const candidate of products) addImpacts(impactMap, candidate.productId, allProductReleases(candidate));
      continue;
    }

    if (area === "product.yml") {
      addImpacts(impactMap, product.productId, allProductReleases(product));
      continue;
    }

    if (area === "topics") {
      const topics = loadTopics(product);
      const relativeTopicPath = normalizePath(filePath.replace(`products/${productId}/`, ""));
      const topic = [...topics.values()].find((candidate) => candidate.relativePath === relativeTopicPath);
      if (!topic) {
        addImpacts(impactMap, product.productId, allProductReleases(product));
        continue;
      }
      addImpacts(impactMap, product.productId, topicImpacts(product, topic));
      continue;
    }

    if (area === "releases") {
      const release = product.releases.find((candidate) => candidate.releaseName === releaseName);
      if (release && releaseAcceptsUpdates(release)) {
        addImpacts(impactMap, product.productId, [release.releaseName]);
      } else if (!release) {
        addImpacts(impactMap, product.productId, allProductReleases(product));
      }
    }
  }

  return [...impactMap.entries()]
    .map(([product, releaseSet]) => ({
      product,
      releases: [...releaseSet].sort((left, right) => {
        const productConfig = productMap.get(product);
        const leftRelease = productConfig.releases.find((release) => release.releaseName === left);
        const rightRelease = productConfig.releases.find((release) => release.releaseName === right);
        return (leftRelease?.order || 0) - (rightRelease?.order || 0);
      }),
    }))
    .filter((impact) => impact.releases.length > 0)
    .sort((left, right) => left.product.localeCompare(right.product));
}

function writeGitHubOutput(impacts) {
  if (!process.env.GITHUB_OUTPUT) return;
  const hasImpacts = impacts.length > 0 ? "true" : "false";
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_impacts=${hasImpacts}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `impact_matrix=${JSON.stringify(impacts)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.root || args._[0] || ".");
  const products = loadProducts(repoRoot);
  const changedFiles = args.all ? ["scripts/build-site.js"] : readChangedFiles(args, repoRoot);
  const impacts = args.all
    ? products.map((product) => ({ product: product.productId, releases: allProductReleases(product) }))
    : detectImpacts(repoRoot, changedFiles, products);

  writeGitHubOutput(impacts);

  if (args.json) {
    console.log(JSON.stringify({ changedFiles, impacts }, null, 2));
    return;
  }

  console.log(`Changed files: ${changedFiles.length > 0 ? changedFiles.join(", ") : "(none)"}`);
  if (impacts.length === 0) {
    console.log("Impacted product release outputs: (none)");
    return;
  }
  console.log("Impacted product release outputs:");
  for (const impact of impacts) {
    console.log(`- ${impact.product}: ${impact.releases.join(", ")}`);
  }
}

main();
