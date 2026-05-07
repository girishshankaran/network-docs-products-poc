# network-docs-products-poc

Proof of concept for scaling one documentation build system across many products.

The important idea is that product differences are modeled as data:

- `products/<product>/product.yml` describes the product.
- `products/<product>/topics/` stores canonical topics for that product.
- `products/<product>/releases/<release>/assets/release-metadata.yml` describes each release.
- `order` in release metadata gives the build engine a product-specific release sequence.
- `products/<product>/releases/<release>/manifests/*.yml` assembles guides for that release.
- `scripts/` contains shared validation, impact detection, and static site generation.

This POC uses Approach B from the topic-ID handling proposal:

- meaningful topic updates create a new topic file and a new `topic_id`
- related variants share the same `retrieval.dedupe_key`
- release manifests select the correct topic variant for each release
- inline version annotations are disallowed

This repo intentionally includes three products with different release numbering ranges:

| Product | Release style | Example releases |
| --- | --- | --- |
| Router Operations Manager | numeric | `19.0`, `20.0`, `21.0` |
| Switch Manager | numeric | `4.0`, `5.0`, `6.0` |
| Security Cloud | numeric | `1.0`, `2.0`, `3.0` |

## Why `order` Exists

Release names are product-owned strings. The shared build engine should not assume that all products share one global release sequence. For example, Security Cloud `3.0`, Switch Manager `6.0`, and Router Operations Manager `21.0` are separate product timelines.

Each release declares an internal sequence:

```yml
release: "5.0"
display_name: "Switch Manager 5.0"
publish_path: "/switch-manager/5.0/"
order: 500
latest: false
publish: true
```

Then topic lifecycle can use sequence-based applicability without relying on one global release sequence:

```yml
lifecycle:
  introduced_in: "5.0"
  applies_to:
    from: "5.0"
    except: []
```

The shared build engine evaluates that within the product:

```text
include this topic variant for Switch Manager releases whose order is >= 5.0.order
```

## Approach B Topic Variants

A meaningful workflow change creates a new topic variant.

```text
products/switch-manager/topics/configure-vlan-4-0.md
  topic_id: SWITCH-VLAN-TASK-001
  dedupe_key: switch-configure-vlans
  applies_to: ["4.0"]

products/switch-manager/topics/configure-vlan-5-0.md
  topic_id: SWITCH-VLAN-TASK-002
  dedupe_key: switch-configure-vlans
  applies_to: from "5.0"
```

Release manifests choose the variant:

```yml
# products/switch-manager/releases/4.0/manifests/admin-guide.yml
topics: ["SWITCH-VLAN-TASK-001"]
```

```yml
# products/switch-manager/releases/5.0/manifests/admin-guide.yml
topics: ["SWITCH-VLAN-TASK-002"]
```

The `dedupe_key` groups the variants for retrieval and governance, while `topic_id` identifies the exact release-specific topic file.

## Commands

Validate all products:

```sh
npm run validate
```

Build the complete static site:

```sh
npm run build
```

Build one product:

```sh
node scripts/build-site.js . --product switch-manager
```

Detect impacts from changed files:

```sh
node scripts/detect-impacts.js . --files products/router-ops/topics/configure-ssh-20-0.md --json
node scripts/detect-impacts.js . --files products/switch-manager/topics/configure-vlan-5-0.md --json
```

## Automatic Publishing

The workflow in `.github/workflows/publish.yml` runs on pushes to `main` and manual dispatches.

It performs the production path:

```text
validate all products
detect impacted product/release outputs
skip publish when no generated output is impacted
build the complete static site into site/ when output is impacted
upload the complete Pages artifact
deploy with GitHub Pages
```

GitHub Pages artifact deployments replace the previous site, so the workflow still uploads a complete `site/` artifact when any product/release output is impacted. Impact detection controls whether publishing is needed and records which product/release outputs caused the publish.

## Applicability Model

Each topic still owns lifecycle metadata. The POC supports both explicit release lists and sequence-based lifecycle ranges.

Explicit:

```yml
lifecycle:
  status: active
  applies_to: ["1.0", "2.0", "3.0"]
```

Sequence-based:

```yml
lifecycle:
  introduced_in: "4.0"
  removed_in: null
  status: active
  applies_to:
    from: "4.0"
    except: []
```

The release manifest still controls guide placement. A topic appears only when:

1. The release manifest includes the topic ID.
2. The topic lifecycle applies to that release.

Validation also enforces Approach B rules:

- every topic must have `retrieval.dedupe_key`
- topic variants sharing a `dedupe_key` must not overlap in the same release
- a release guide must not include multiple variants with the same `dedupe_key`
- `lifecycle.replaced_by` must point to an existing topic in the same topic family
- `:::version` annotations are rejected

## Scaling Pattern

For 100 products, this model keeps one shared build engine and adds product-owned metadata:

```text
one script set
many product folders
many release registries
product-aware validation
product-aware impact detection
matrix-friendly build output
```

The build system scales because products differ by configuration, release metadata, manifests, and content, not by custom build logic.
