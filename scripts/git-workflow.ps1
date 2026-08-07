param(
  [switch]$NoPush,
  [string]$Message = "Update"
)

$repo = Resolve-Path "."
Set-Location $repo

Write-Host "Checking repository status..."
git status --short --branch

Write-Host "Staging changes..."
git add -A

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Creating commit..."
git commit -m $Message

if ($LASTEXITCODE -ne 0) {
  Write-Host "No changes to commit."
  exit 0
}

if (-not $NoPush) {
  Write-Host "Pushing to GitHub..."
  git push origin HEAD:main
}
