---
topic_id: SECURITY-API-KEYS-TASK-003
title: "Manage owned API keys"
summary: "Create API keys with an assigned owner, expiration date, and rotation record for Security Cloud integrations."
content_type: task
owner: "Security Cloud Docs"
lifecycle:
  introduced_in: "1.0"
  removed_in: null
  status: active
  replaced_by: null
  applies_to: ["1.0"]
retrieval:
  is_canonical: true
  dedupe_key: "security-cloud-api-keys"
  allow_in_ai_results: true
---
# Manage owned API keys

Use this procedure to create API keys for integrations that require an assigned owner and an expiration date. Security Cloud 1.0 now rejects keys that do not have an owner, scope, and rotation record.

## Steps

1. Open **Integrations > API keys**.
2. Select **Create key**.
3. Choose the required integration scope.
4. Select the service owner who is responsible for the integration.
5. Set an expiration date that is no more than 90 days from the creation date.
6. Enter the rotation ticket or change request ID.
7. Select **Create key**.
8. Copy the generated key and store it in the approved secrets vault.
9. Record the vault reference in the integration configuration.

## Verification

Confirm that the integration can authenticate with the new key. In **Integrations > API keys**, verify that the key shows an owner, expiration date, and rotation record.
