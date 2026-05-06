---
topic_id: ROUTER-SSH-TASK-001
title: Configure SSH access
summary: Enable secure shell access for router administrators.
content_type: task
owner: Router Docs
lifecycle:
  introduced_in: "19.0"
  removed_in: null
  status: active
  applies_to:
    from: "19.0"
    except: []
retrieval:
  is_canonical: true
  dedupe_key: router-configure-ssh
---

# Configure SSH access

Use this procedure to enable SSH access on managed routers.

## Steps

:::version only="19.0"
1. Open **Configuration > Device Settings**.
2. Enable **SSH Server**.
3. Save the running configuration.
:::

:::version from="20.0"
1. Open **Configuration > Security > Access**.
2. Turn on **SSH Access**.
3. Apply the access policy.
:::

## Verification

Confirm that SSH access is enabled in the router access summary.
