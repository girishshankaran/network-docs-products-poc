---
topic_id: ROUTER-SSH-TASK-003
title: "Configure policy-based SSH access"
summary: "Enable SSH access through an access policy that limits administrative sessions to approved operator groups."
content_type: task
owner: "Router Docs"
lifecycle:
  introduced_in: "21.0"
  removed_in: null
  status: active
  replaced_by: null
  applies_to:
    from: "21.0"
    except: []
retrieval:
  is_canonical: true
  dedupe_key: "router-configure-ssh"
  allow_in_ai_results: true
---
# Configure policy-based SSH access

Use this procedure to enable SSH access through a reusable access policy. In Router Operations Manager 21.0, SSH access is controlled by policy scope, operator group, and session enforcement settings instead of a simple global toggle.

## Steps

1. Open **Configuration > Security > Access Policies**.
2. Select **Create policy**.
3. Enter a policy name that identifies the router group and administrative purpose.
4. Add the approved operator group to **Allowed administrators**.
5. Set **Protocol** to **SSH**.
6. Select the router group that should receive the policy.
7. Enable **Session logging**.
8. Set the idle timeout and maximum session duration.
9. Review the affected routers.
10. Select **Deploy policy**.

## Verification

Confirm that the access policy shows **Deployed** for each router in the group. Open the session audit view and verify that SSH sessions are logged with the operator name, router name, and policy name.
