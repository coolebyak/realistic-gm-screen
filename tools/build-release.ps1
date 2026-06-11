param(
  [Parameter(Mandatory = $true)]
  [string]$Owner,

  [Parameter(Mandatory = $false)]
  [string]$Repo = "realistic-gm-screen"
)

$ErrorActionPreference = "Stop"

$moduleRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $moduleRoot "module.json"
$distPath = Join-Path $moduleRoot "dist"

$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$id = $manifest.id
$version = $manifest.version
$tag = "v$version"
$zipName = "$id-$tag.zip"

if (-not (Test-Path $distPath)) {
  New-Item -ItemType Directory -Path $distPath | Out-Null
}

$releaseManifest = $manifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$releaseManifest | Add-Member -Force -NotePropertyName "url" -NotePropertyValue "https://github.com/$Owner/$Repo"
$releaseManifest | Add-Member -Force -NotePropertyName "manifest" -NotePropertyValue "https://github.com/$Owner/$Repo/releases/latest/download/module.json"
$releaseManifest | Add-Member -Force -NotePropertyName "download" -NotePropertyValue "https://github.com/$Owner/$Repo/releases/download/$tag/$zipName"
$releaseManifest | Add-Member -Force -NotePropertyName "bugs" -NotePropertyValue "https://github.com/$Owner/$Repo/issues"

$distManifestPath = Join-Path $distPath "module.json"
$manifestJson = $releaseManifest | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($distManifestPath, $manifestJson + [Environment]::NewLine, $utf8NoBom)

$stagingRoot = Join-Path $distPath "staging"
$stagingModule = Join-Path $stagingRoot $id
if (Test-Path $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingModule | Out-Null

$exclude = @("dist", ".git", ".gitignore")
Get-ChildItem -LiteralPath $moduleRoot -Force | Where-Object {
  $exclude -notcontains $_.Name
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $stagingModule -Recurse -Force
}

Copy-Item -LiteralPath $distManifestPath -Destination (Join-Path $stagingModule "module.json") -Force

$zipPath = Join-Path $distPath $zipName
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stagingModule "*") -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Output "Created release manifest: $distManifestPath"
Write-Output "Created release zip: $zipPath"
Write-Output "Manifest URL: https://github.com/$Owner/$Repo/releases/latest/download/module.json"
