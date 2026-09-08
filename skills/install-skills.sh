#!/usr/bin/env bash
# Install bundled skills into the current user's Hermes config.
# Run this once after cloning the repo, or add to your setup.

set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES="${HERMES:-hermes}"

for skill_dir in "$SKILLS_DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  name=$(basename "$skill_dir")
  echo "Installing skill: $name"
  "$HERMES" skill install "$skill_dir" || echo "  (already installed or failed)"
done

echo "Done. Run 'hermes skills list' to verify."
