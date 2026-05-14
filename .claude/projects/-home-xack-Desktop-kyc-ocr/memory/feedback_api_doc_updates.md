---
name: feedback-api-doc-updates
description: Always update API docs (src/api/openapi.ts and docs/) after any code changes
metadata:
  type: feedback
---

Always update the OpenAPI spec (src/api/openapi.ts) and any docs/ markdown files after making changes to: extraction modes, prompts, request/response shapes, new endpoints, config options, or strategy behaviour.

**Why:** User explicitly requested this after the prompt separation refactor was committed without updating the API docs. Keeping docs in sync with code is a hard requirement for this project.

**How to apply:** After any commit that changes extraction behaviour, modes, or API shape — immediately update src/api/openapi.ts and relevant docs/ files in the same commit or as the very next step.
