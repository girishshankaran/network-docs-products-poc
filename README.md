# network-docs-products-poc

Proof of concept for scaling one documentation build system across many products.

The important idea is that product differences are modeled as data:

- `products/<product>/product.yml` describes the product.
- `products/<product>/topics/` stores canonical topics for that product.
- `products/<product>/releases/<release>/assets/release-metadata.yml` describes each release.
- `order` in release metadata gives the build engine a product-specific release sequence.
- `products/<product>/releases/<release>/manifests/*.yml` assembles guides for that release.
- `scripts/` contains shared validation, impact detection, and static site generation.

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

Then a topic can use version annotations without relying on numeric release names:

```md
:::version from="5.0"
Use the redesigned workflow.
:::
```

The shared build engine evaluates that as:

```text
include this block for Switch Manager releases whose order is >= 5.0.order
```

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
node scripts/detect-impacts.js . --files products/router-ops/topics/configure-ssh.md --json
node scripts/detect-impacts.js . --files products/switch-manager/topics/configure-vlan.md --json
```

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
