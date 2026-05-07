const fs = require("fs");
const path = require("path");
const {
  applicableReleaseNames,
  lifecycleAppliesToRelease,
  loadProducts,
  loadTopics,
  parseArgs,
  releaseById,
} = require("./common");

function usage() {
  console.error(`Usage:
node scripts/create-topic-variant.js . \\
  --product router-ops \\
  --from-topic ROUTER-SSH-TASK-002 \\
  --release 21.0 \\
  [--releases 21.0,22.0] \\
  [--slug configure-ssh-21-0] \\
  [--update-manifests] \\
  [--dry-run]

Creates a new Approach B topic variant with the next topic_id in the same topic family.`);
}

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function yamlList(values) {
  return `[${values.map(scalar).join(", ")}]`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function releaseSlug(releaseName) {
  return slugify(releaseName.replace(/\./g, "-"));
}

function parseCsv(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function topicIdPrefix(topicId) {
  const match = String(topicId).match(/^(.+)-(\d+)$/);
  if (!match) throw new Error(`Cannot derive numeric suffix from topic_id "${topicId}"`);
  return { prefix: match[1], number: Number(match[2]), width: match[2].length };
}

function nextTopicId(sourceTopic, familyTopics) {
  const { prefix, width } = topicIdPrefix(sourceTopic.topicId);
  let max = 0;
  for (const topic of familyTopics) {
    const match = String(topic.topicId).match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, "0")}`;
}

function frontmatterForVariant(sourceTopic, newTopicId, releaseName, targetReleases) {
  const source = sourceTopic.frontmatter;
  const retrieval = source.retrieval || {};
  const explicitTargets = targetReleases.length > 0;
  const lifecycleLines = explicitTargets
    ? [
        `  introduced_in: ${scalar(releaseName)}`,
        "  removed_in: null",
        "  status: active",
        "  replaced_by: null",
        `  applies_to: ${yamlList(targetReleases)}`,
      ]
    : [
        `  introduced_in: ${scalar(releaseName)}`,
        "  removed_in: null",
        "  status: active",
        "  replaced_by: null",
        "  applies_to:",
        `    from: ${scalar(releaseName)}`,
        "    except: []",
      ];

  return [
    "---",
    `topic_id: ${newTopicId}`,
    `title: ${source.title ? scalar(source.title) : scalar(sourceTopic.title)}`,
    source.summary ? `summary: ${scalar(source.summary)}` : null,
    source.content_type ? `content_type: ${source.content_type}` : null,
    source.owner ? `owner: ${scalar(source.owner)}` : null,
    "lifecycle:",
    ...lifecycleLines,
    "retrieval:",
    `  is_canonical: ${retrieval.is_canonical === false ? "false" : "true"}`,
    `  dedupe_key: ${scalar(retrieval.dedupe_key)}`,
    `  allow_in_ai_results: ${retrieval.allow_in_ai_results === false ? "false" : "true"}`,
    "---",
    "",
  ].filter((line) => line !== null).join("\n");
}

function updateSourceLifecycle(sourceText, sourceTopic, releaseName, newTopicId, product) {
  const currentAppliesTo = applicableReleaseNames(product, sourceTopic);
  const remaining = currentAppliesTo.filter((candidate) => {
    const candidateRelease = releaseById(product, candidate);
    const newRelease = releaseById(product, releaseName);
    if (!candidateRelease || !newRelease) return candidate !== releaseName;
    return candidateRelease.order < newRelease.order;
  });
  const appliesTo = remaining.length > 0
    ? remaining
    : currentAppliesTo.filter((candidate) => candidate === releaseName);
  const status = appliesTo.length === remaining.length && remaining.length > 0
    ? sourceTopic.lifecycle.status || "active"
    : "replaced";

  const replacement = [
    "lifecycle:",
    `  introduced_in: ${scalar(sourceTopic.lifecycle.introduced_in || appliesTo[0] || releaseName)}`,
    "  removed_in: null",
    `  status: ${status}`,
    `  replaced_by: ${newTopicId}`,
    `  applies_to: ${yamlList(appliesTo)}`,
    "retrieval:",
  ].join("\n");

  if (!sourceText.match(/\nlifecycle:\n[\s\S]*?\nretrieval:\n/)) {
    throw new Error(`Could not find lifecycle block in ${sourceTopic.relativePath}`);
  }

  return sourceText.replace(/\nlifecycle:\n[\s\S]*?\nretrieval:\n/, `\n${replacement}\n`);
}

function replaceTopicIdInManifest(source, oldTopicId, newTopicId) {
  return source.replace(new RegExp(`"${oldTopicId}"`, "g"), `"${newTopicId}"`);
}

function plannedManifestUpdates(product, sourceTopic, newTopicId, targetReleaseNames) {
  const updates = [];
  const targetSet = new Set(targetReleaseNames);

  for (const release of product.releases) {
    if (!targetSet.has(release.releaseName)) continue;
    for (const guide of release.guides) {
      const source = fs.readFileSync(guide.manifestPath, "utf8");
      if (!source.includes(`"${sourceTopic.topicId}"`)) continue;
      const next = replaceTopicIdInManifest(source, sourceTopic.topicId, newTopicId);
      if (next !== source) updates.push({ path: guide.manifestPath, source, next });
    }
  }

  return updates;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.root || args._[0] || ".");
  const productId = args.product;
  const fromTopicId = args["from-topic"];
  const releaseName = args.release;
  const dryRun = args["dry-run"] === true;
  const updateManifests = args["update-manifests"] === true;

  if (!productId || !fromTopicId || !releaseName) {
    usage();
    process.exit(1);
  }

  const product = loadProducts(repoRoot).find((candidate) => candidate.productId === productId);
  if (!product) {
    console.error(`Unknown product: ${productId}`);
    process.exit(1);
  }

  const release = releaseById(product, releaseName);
  if (!release) {
    console.error(`Unknown release for ${productId}: ${releaseName}`);
    process.exit(1);
  }

  const topics = loadTopics(product);
  const sourceTopic = topics.get(fromTopicId);
  if (!sourceTopic) {
    console.error(`Unknown source topic for ${productId}: ${fromTopicId}`);
    process.exit(1);
  }
  if (!sourceTopic.retrieval?.dedupe_key) {
    console.error(`${sourceTopic.relativePath} is missing retrieval.dedupe_key`);
    process.exit(1);
  }

  const targetReleases = parseCsv(args.releases);
  const manifestTargets = targetReleases.length > 0 ? targetReleases : [releaseName];
  const unknownTargets = manifestTargets.filter((target) => !releaseById(product, target));
  if (unknownTargets.length > 0) {
    console.error(`Unknown target release(s) for ${productId}: ${unknownTargets.join(", ")}`);
    process.exit(1);
  }

  const familyTopics = [...topics.values()].filter((topic) => topic.retrieval?.dedupe_key === sourceTopic.retrieval.dedupe_key);
  const newTopicId = args["topic-id"] || nextTopicId(sourceTopic, familyTopics);
  if (topics.has(newTopicId)) {
    console.error(`Topic already exists: ${newTopicId}`);
    process.exit(1);
  }

  const outputSlug = args.slug || `${sourceTopic.slug.replace(/-\d+-\d+$/, "")}-${releaseSlug(releaseName)}`;
  const outputPath = path.join(product.topicsDir, `${outputSlug}.md`);
  if (fs.existsSync(outputPath)) {
    console.error(`Topic file already exists: ${path.relative(repoRoot, outputPath)}`);
    process.exit(1);
  }

  const sourceText = fs.readFileSync(sourceTopic.path, "utf8");
  const body = sourceTopic.body.trim();
  const newContent = `${frontmatterForVariant(sourceTopic, newTopicId, releaseName, targetReleases)}${body}\n`;
  const sourceNext = updateSourceLifecycle(sourceText, sourceTopic, releaseName, newTopicId, product);
  const manifestUpdates = updateManifests
    ? plannedManifestUpdates(product, sourceTopic, newTopicId, manifestTargets)
    : [];

  console.log(`Create topic variant:`);
  console.log(`- product: ${productId}`);
  console.log(`- source: ${sourceTopic.topicId} (${sourceTopic.relativePath})`);
  console.log(`- new topic_id: ${newTopicId}`);
  console.log(`- new file: ${path.relative(repoRoot, outputPath)}`);
  console.log(`- dedupe_key: ${sourceTopic.retrieval.dedupe_key}`);
  console.log(`- release: ${releaseName}`);
  if (targetReleases.length > 0) console.log(`- applies_to: ${targetReleases.join(", ")}`);
  if (updateManifests) {
    console.log(`- manifest updates: ${manifestUpdates.length}`);
    for (const update of manifestUpdates) console.log(`  - ${path.relative(repoRoot, update.path)}`);
  }

  if (dryRun) {
    console.log("Dry run only. No files were changed.");
    return;
  }

  fs.writeFileSync(outputPath, newContent, "utf8");
  fs.writeFileSync(sourceTopic.path, sourceNext, "utf8");
  for (const update of manifestUpdates) {
    fs.writeFileSync(update.path, update.next, "utf8");
  }
}

main();
