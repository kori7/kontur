# Working together

Use `main` as the shared baseline. Create a separate branch for each change and
review it through a pull request before merging.

## Start a change

```powershell
git switch main
git pull --ff-only
git switch -c feature/short-description
```

Avoid editing the same files at the same time. Agree on ownership in a GitHub
issue or the pull request description.

## Validate and share

```powershell
& ".\scripts\check.ps1"
git add path/to/changed-file
git diff --cached
git commit -m "Describe the change"
git push -u origin feature/short-description
```

Open a pull request into `main`, describe the behavior and include verification
results. Ask the other contributor to review it.

## Local files

Never commit API keys, `.env`, databases, certificates, downloaded models,
runtime binaries, virtual environments or `node_modules`. Each contributor
prepares these locally using the instructions in `README.md` and the scripts.

Organizer materials retain their source metadata. Keep the repository private
unless permission to publish those materials has been confirmed.

## Current scope

The inspection MVP is implemented. Offline integration remains incomplete:
reference series need API/UI integration, phone access needs LAN/HTTPS setup,
and local model accuracy needs broader validation. Some README and coverage
notes still describe the earlier cloud adapter; current vision code uses the
local llama.cpp endpoint. See `docs/superpowers/plans/2026-11-13-offline-extension.md`.
