#!/bin/sh
# Protege `main` según specs/001-plataforma-base (T047, I2): checks obligatorios, 1 revisión,
# historial lineal y solo "Rebase and merge". Idempotente. Requiere `gh` con permisos de admin.
# Uso: scripts/github/protect-main.sh [owner/repo]
set -eu
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

echo "Repositorio: $REPO"

# 1. Métodos de merge: solo rebase (sin merge commits ni squash) y borrar ramas integradas.
gh api -X PATCH "repos/$REPO" \
  -F allow_merge_commit=false \
  -F allow_squash_merge=false \
  -F allow_rebase_merge=true \
  -F delete_branch_on_merge=true >/dev/null
echo "✓ Solo 'Rebase and merge' habilitado"

# 2. Protección de la rama main.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "lint",
      "typecheck",
      "commitlint",
      "secrets",
      "test-node",
      "test-python",
      "migrations",
      "build (api)",
      "build (analytics)",
      "build (web)",
      "e2e-smoke"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
echo "✓ main protegida: checks obligatorios, 1 revisión, historial lineal"
