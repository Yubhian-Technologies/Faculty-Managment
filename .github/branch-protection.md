# Branch Protection Rules for `main`

Use these settings in GitHub for the `main` branch.

## Required protections

- Require a pull request before merging
- Require at least 1 approval
- Dismiss stale approvals when new commits are pushed
- Require conversation resolution before merging
- Restrict direct pushes to `main`

## Required status checks

Require these checks from [.github/workflows/ci.yml](workflows/ci.yml):

- `Lint`
- `Type check`
- `Build`

## Optional protections

- Require linear history
- Require signed commits
- Restrict force pushes

## Notes

- Do not require `Run tests` yet unless a real `test` script is added to [package.json](../package.json) and test files exist.
- If this repository is managed under an organization, a GitHub ruleset can enforce the same policy across multiple branches.
