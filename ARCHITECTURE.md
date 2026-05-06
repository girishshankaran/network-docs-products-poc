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
4. Validate topic lifecycle and version annotations against that registry.
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

Version annotations use release IDs, and the builder compares their `order` values.

```md
:::version from="20.0"
Applies to 20.0 and later router releases.
:::
```

```md
:::version from="5.0" until="6.0"
Applies to a Switch Manager release window.
:::
```

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
