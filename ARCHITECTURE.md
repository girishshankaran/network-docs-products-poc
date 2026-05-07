# Architecture

This POC generalizes the single-product docs model into a product-aware model.

```text
network-docs-products-poc/
  products.yml
  products/
    router-ops/
      product.yml
      topics/
      releases/
    switch-manager/
      product.yml
      topics/
      releases/
    security-cloud/
      product.yml
      topics/
      releases/
  scripts/
  site/
```

## Shared Build Engine

The scripts do the same work for every product:

1. Load the product registry.
2. Load each product's release metadata.
3. Build a release registry keyed by release ID.
4. Validate topic lifecycle and topic-family metadata against that registry.
5. Render release outputs from manifests and topic metadata.
6. Detect changed-file impacts at product and release granularity.

## Release Sequence

The `order` field is the release sequence within a product. It is not a public version number and does not need to be globally unique.

Examples:

```yml
release: "20.0"
order: 2000
```

```yml
release: "5.0"
order: 500
```

```yml
release: "2.0"
order: 200
```

Approach B does not use inline version annotations. The builder uses release order for lifecycle ranges and validation, while manifests select the exact topic variant for each release.

```yml
lifecycle:
  introduced_in: "20.0"
  applies_to:
    from: "20.0"
    except: []
```

## Approach B Topic Families

Meaningful updates create a new topic file and a new `topic_id`.

```text
products/router-ops/topics/configure-ssh-19-0.md
  topic_id: ROUTER-SSH-TASK-001
  dedupe_key: router-configure-ssh
  applies_to: 19.0

products/router-ops/topics/configure-ssh-20-0.md
  topic_id: ROUTER-SSH-TASK-002
  dedupe_key: router-configure-ssh
  applies_to: 20.0+
```

The shared `dedupe_key` is the topic-family identity. It prevents AI retrieval and release assembly from treating related variants as unrelated content.

Release manifests select variants explicitly:

```text
19.0 manifest -> ROUTER-SSH-TASK-001
20.0 manifest -> ROUTER-SSH-TASK-002
21.0 manifest -> ROUTER-SSH-TASK-002
```

The build does not render conditional content inside a topic. It renders the topic file selected by the manifest after lifecycle validation.

## Impact Detection

The impact detector returns product-aware output:

```json
{
  "impacts": [
    {
      "product": "router-ops",
      "releases": ["19.0", "20.0", "21.0"]
    }
  ]
}
```

That shape is suitable for a CI matrix where each product/release output can be built independently.
