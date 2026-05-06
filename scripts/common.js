const fs = require("fs");
const path = require("path");

const defaultManifestFile = "admin-guide.yml";

function parseArgs(argv) {
  const args = { _: [], files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    if (key === "files") {
      args.files.push(next);
    } else {
      args[key] = next;
    }
    index += 1;
  }
  return args;
}

function parseScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return JSON.parse(trimmed.replace(/'/g, '"'));
  }
  return trimmed;
}

function parseYamlBlock(lines, startIndex, currentIndent) {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const indent = line.match(/^ */)[0].length;
    if (indent < currentIndent) break;
    if (indent > currentIndent) throw new Error(`Unexpected indentation near: ${line}`);

    const trimmed = line.trim();
    const keyValue = trimmed.match(/^([^:]+):(.*)$/);
    if (!keyValue) throw new Error(`Unsupported YAML line: ${line}`);

    const key = keyValue[1].trim();
    const rest = keyValue[2].trim();

    if (!rest) {
      const nextLine = lines[index + 1] || "";
      const nextTrimmed = nextLine.trim();
      const nextIndent = nextLine.match(/^ */)[0].length;

      if (nextTrimmed.startsWith("- ")) {
        const listResult = [];
        index += 1;
        while (index < lines.length) {
          const listLine = lines[index];
          const listIndent = listLine.match(/^ */)[0].length;
          const listTrimmed = listLine.trim();
          if (!listTrimmed) {
            index += 1;
            continue;
          }
          if (listIndent < currentIndent + 2 || !listTrimmed.startsWith("- ")) break;

          const itemValue = listTrimmed.slice(2).trim();
          if (itemValue.includes(":")) {
            const item = {};
            const firstMatch = itemValue.match(/^([^:]+):(.*)$/);
            if (!firstMatch) throw new Error(`Unsupported YAML list item: ${listLine}`);
            item[firstMatch[1].trim()] = parseScalar(firstMatch[2].trim());
            index += 1;
            while (index < lines.length) {
              const nestedLine = lines[index];
              const nestedIndent = nestedLine.match(/^ */)[0].length;
              const nestedTrimmed = nestedLine.trim();
              if (!nestedTrimmed) {
                index += 1;
                continue;
              }
              if (nestedIndent <= listIndent) break;
              const nestedMatch = nestedTrimmed.match(/^([^:]+):(.*)$/);
              if (!nestedMatch) throw new Error(`Unsupported YAML line: ${nestedLine}`);
              item[nestedMatch[1].trim()] = parseScalar(nestedMatch[2].trim());
              index += 1;
            }
            listResult.push(item);
            continue;
          }

          listResult.push(parseScalar(itemValue));
          index += 1;
        }
        result[key] = listResult;
        continue;
      }

      if (nextIndent > currentIndent) {
        const nested = parseYamlBlock(lines, index + 1, currentIndent + 2);
        result[key] = nested.value;
        index = nested.nextIndex;
        continue;
      }

      result[key] = {};
      index += 1;
      continue;
    }

    result[key] = parseScalar(rest);
    index += 1;
  }

  return { value: result, nextIndex: index };
}

function parseYaml(source) {
  return parseYamlBlock(source.split(/\r?\n/), 0, 0).value;
}

function readYaml(filePath) {
  return parseYaml(fs.readFileSync(filePath, "utf8"));
}

function parseTopicDocument(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("Missing frontmatter");
  return {
    frontmatter: parseYaml(match[1]),
    body: match[2].trim(),
    bodyStartLine: match[1].split(/\r?\n/).length + 3,
  };
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function listDirectories(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((entryName) => fs.statSync(path.join(dirPath, entryName)).isDirectory())
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function manifestFiles(releaseRoot) {
  const manifestsDir = path.join(releaseRoot, "manifests");
  if (!fs.existsSync(manifestsDir)) return [];
  return fs.readdirSync(manifestsDir)
    .filter((fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"))
    .sort((left, right) => {
      if (left === defaultManifestFile) return -1;
      if (right === defaultManifestFile) return 1;
      return left.localeCompare(right);
    });
}

function loadProducts(repoRoot) {
  const productsRoot = path.join(repoRoot, "products");
  return listDirectories(productsRoot).map((productId) => {
    const productRoot = path.join(productsRoot, productId);
    const configPath = path.join(productRoot, "product.yml");
    const config = readYaml(configPath);
    const releases = loadReleases(productRoot);
    const releaseMap = new Map(releases.map((release) => [release.releaseName, release]));
    return {
      productId,
      productRoot,
      configPath,
      config,
      topicsDir: path.join(productRoot, "topics"),
      releasesDir: path.join(productRoot, "releases"),
      releases,
      releaseMap,
    };
  });
}

function loadReleases(productRoot) {
  const releasesDir = path.join(productRoot, "releases");
  return listDirectories(releasesDir).map((releaseName) => {
    const releaseRoot = path.join(releasesDir, releaseName);
    const metadataPath = path.join(releaseRoot, "assets", "release-metadata.yml");
    const metadata = readYaml(metadataPath);
    const guides = manifestFiles(releaseRoot).map((manifestFile) => {
      const manifestPath = path.join(releaseRoot, "manifests", manifestFile);
      return {
        manifestFile,
        manifestPath,
        isDefault: manifestFile === defaultManifestFile,
        manifest: readYaml(manifestPath),
      };
    });

    return {
      releaseName,
      releaseRoot,
      metadataPath,
      metadata,
      order: Number(metadata.order),
      guides,
    };
  }).sort((left, right) => left.order - right.order);
}

function loadTopics(product) {
  const topics = new Map();
  if (!fs.existsSync(product.topicsDir)) return topics;

  for (const fileName of fs.readdirSync(product.topicsDir).filter((name) => name.endsWith(".md")).sort()) {
    const fullPath = path.join(product.topicsDir, fileName);
    const topicDocument = parseTopicDocument(fs.readFileSync(fullPath, "utf8"));
    const topicId = topicDocument.frontmatter.topic_id;
    topics.set(topicId, {
      ...topicDocument,
      fileName,
      path: fullPath,
      relativePath: normalizePath(path.relative(product.productRoot, fullPath)),
      topicId,
      slug: fileName.replace(/\.md$/, ""),
      title: topicDocument.frontmatter.title || topicId,
      summary: topicDocument.frontmatter.summary || "",
      contentType: topicDocument.frontmatter.content_type || "",
      lifecycle: topicDocument.frontmatter.lifecycle || {},
    });
  }

  return topics;
}

function topicIdsFromSections(sections) {
  return (sections || []).flatMap((section) => section.topics || []);
}

function releaseById(product, releaseId) {
  return product.releaseMap.get(releaseId) || null;
}

function compareByOrder(product, leftReleaseId, rightReleaseId) {
  const left = releaseById(product, leftReleaseId);
  const right = releaseById(product, rightReleaseId);
  if (!left || !right) return null;
  if (left.order < right.order) return -1;
  if (left.order > right.order) return 1;
  return 0;
}

function parseVersionAttrs(rawAttrs) {
  const attrs = {};
  const pattern = /([a-z_]+)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(rawAttrs)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function versionBlocks(topic) {
  const blocks = [];
  const lines = topic.body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const open = line.match(/^:::version\s+(.+)$/);
    if (!open) continue;
    const closingIndex = lines.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate === ":::");
    blocks.push({
      lineNumber: topic.bodyStartLine + index,
      attrs: parseVersionAttrs(open[1]),
      rawAttrs: open[1],
      content: closingIndex === -1 ? "" : lines.slice(index + 1, closingIndex).join("\n").trim(),
      missingClose: closingIndex === -1,
    });
    if (closingIndex !== -1) index = closingIndex;
  }
  return blocks;
}

function versionBlockRefs(block) {
  return ["only", "from", "until"]
    .map((key) => block.attrs[key])
    .filter(Boolean);
}

function releaseMatchesVersionBlock(product, release, block) {
  const attrs = block.attrs;
  if (attrs.only) return release.releaseName === attrs.only;

  if (attrs.from) {
    const from = releaseById(product, attrs.from);
    if (!from || release.order < from.order) return false;
  }

  if (attrs.until) {
    const until = releaseById(product, attrs.until);
    if (!until || release.order > until.order) return false;
  }

  return Boolean(attrs.from || attrs.until);
}

function lifecycleRefs(lifecycle) {
  const refs = [];
  if (lifecycle.introduced_in) refs.push(lifecycle.introduced_in);
  if (lifecycle.removed_in) refs.push(lifecycle.removed_in);

  const appliesTo = lifecycle.applies_to;
  if (Array.isArray(appliesTo)) refs.push(...appliesTo);
  if (appliesTo && typeof appliesTo === "object" && !Array.isArray(appliesTo)) {
    if (appliesTo.only) refs.push(appliesTo.only);
    if (appliesTo.from) refs.push(appliesTo.from);
    if (appliesTo.until) refs.push(appliesTo.until);
    if (Array.isArray(appliesTo.except)) refs.push(...appliesTo.except);
  }

  return refs.filter(Boolean);
}

function lifecycleAppliesToRelease(product, lifecycle, release) {
  const appliesTo = lifecycle.applies_to;

  if (Array.isArray(appliesTo)) {
    return appliesTo.includes(release.releaseName);
  }

  if (appliesTo && typeof appliesTo === "object") {
    if (appliesTo.only) return release.releaseName === appliesTo.only;
    if (Array.isArray(appliesTo.except) && appliesTo.except.includes(release.releaseName)) return false;

    const fromId = appliesTo.from || lifecycle.introduced_in;
    if (fromId) {
      const from = releaseById(product, fromId);
      if (!from || release.order < from.order) return false;
    }

    if (appliesTo.until) {
      const until = releaseById(product, appliesTo.until);
      if (!until || release.order > until.order) return false;
    }

    if (lifecycle.removed_in) {
      const removed = releaseById(product, lifecycle.removed_in);
      if (removed && release.order >= removed.order) return false;
    }

    return true;
  }

  if (lifecycle.introduced_in) {
    const introduced = releaseById(product, lifecycle.introduced_in);
    if (!introduced || release.order < introduced.order) return false;
    if (lifecycle.removed_in) {
      const removed = releaseById(product, lifecycle.removed_in);
      if (removed && release.order >= removed.order) return false;
    }
    return true;
  }

  return false;
}

function applicableReleaseNames(product, topic) {
  return product.releases
    .filter((release) => lifecycleAppliesToRelease(product, topic.lifecycle, release))
    .map((release) => release.releaseName);
}

function releaseAcceptsUpdates(release) {
  return release.metadata.publish !== false;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

module.exports = {
  applicableReleaseNames,
  compareByOrder,
  defaultManifestFile,
  escapeHtml,
  lifecycleAppliesToRelease,
  lifecycleRefs,
  loadProducts,
  loadTopics,
  normalizePath,
  parseArgs,
  parseTopicDocument,
  parseVersionAttrs,
  readYaml,
  releaseAcceptsUpdates,
  releaseById,
  releaseMatchesVersionBlock,
  slugify,
  topicIdsFromSections,
  versionBlockRefs,
  versionBlocks,
};
