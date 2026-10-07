# Rollbacks

A migration in `../migrations/` that drops or truncates data needs a file here with the same name that restores the previous state (DECISIONS §10, §25). `scripts/check-migrations.sh` enforces it in CI.
