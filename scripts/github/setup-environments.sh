#!/bin/sh
# Crea los GitHub Environments `staging` y `production` (T053). Idempotente.
# - production: revisores obligatorios y despliegue solo desde main y tags v*.
# - Cada Environment recibe el secret RAILWAY_TOKEN y las variables BASE_URL y API_URL.
#
# Uso:
#   STAGING_RAILWAY_TOKEN=… PRODUCTION_RAILWAY_TOKEN=… \
#   STAGING_BASE_URL=https://… STAGING_API_URL=https://… \
#   PRODUCTION_BASE_URL=https://… PRODUCTION_API_URL=https://… \
#   scripts/github/setup-environments.sh [owner/repo] [revisor]
set -eu
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
REVIEWER="${2:-$(gh api user -q .login)}"
REVIEWER_ID=$(gh api "users/$REVIEWER" -q .id)

echo "Repositorio: $REPO · revisor de production: $REVIEWER"

# staging: sin aprobación.
gh api -X PUT "repos/$REPO/environments/staging" >/dev/null
echo "✓ Environment staging"

# production: aprobación manual y política de ramas personalizada.
gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null <<JSON
{
  "reviewers": [{ "type": "User", "id": $REVIEWER_ID }],
  "prevent_self_review": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
JSON
for pattern in main; do
  gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" \
    -f name="$pattern" -f type=branch >/dev/null 2>&1 || true
done
gh api -X POST "repos/$REPO/environments/production/deployment-branch-policies" \
  -f name='v*' -f type=tag >/dev/null 2>&1 || true
echo "✓ Environment production (revisor obligatorio; solo main y tags v*)"

set_env() {
  env_name="$1"; token="$2"; base_url="$3"; api_url="$4"
  printf '%s' "$token" | gh secret set RAILWAY_TOKEN --repo "$REPO" --env "$env_name"
  gh variable set BASE_URL --repo "$REPO" --env "$env_name" --body "$base_url"
  gh variable set API_URL --repo "$REPO" --env "$env_name" --body "$api_url"
  echo "✓ $env_name: RAILWAY_TOKEN, BASE_URL=$base_url, API_URL=$api_url"
}

set_env staging "$STAGING_RAILWAY_TOKEN" "$STAGING_BASE_URL" "$STAGING_API_URL"
set_env production "$PRODUCTION_RAILWAY_TOKEN" "$PRODUCTION_BASE_URL" "$PRODUCTION_API_URL"
