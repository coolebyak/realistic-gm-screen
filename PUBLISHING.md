# Publishing

This module is ready to publish as a GitHub-hosted Foundry VTT module.

## One-time setup

Create a public GitHub repository. The recommended repository name is:

```text
realistic-gm-screen
```

Put the contents of this module folder at the root of that repository, so `module.json` is directly in the repository root.

## Build release files

From the workspace root, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\realistic-gm-screen\tools\build-release.ps1 -Owner coolebyak -Repo realistic-gm-screen
```

This creates:

```text
realistic-gm-screen\dist\module.json
realistic-gm-screen\dist\realistic-gm-screen-v0.11.0.zip
```

## GitHub Release

Create a GitHub Release with:

```text
Tag: v0.11.0
Title: Realistic GM Screen v0.11.0
```

Upload both files from `dist` as release assets:

```text
module.json
realistic-gm-screen-v0.11.0.zip
```

Users can then install the module in Foundry with this manifest URL:

```text
https://github.com/coolebyak/realistic-gm-screen/releases/latest/download/module.json
```

## Foundry package listing

After the GitHub release works, submit the manifest URL above to Foundry's package submission flow.
