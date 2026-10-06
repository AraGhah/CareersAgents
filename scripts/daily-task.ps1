# The daily careers run, as Windows Task Scheduler starts it at 9:00 (registered by scripts/register-daily-task.ps1):
# makes sure Docker and the desk's database are up, then runs `scripts/daily.ts --until 15:00`, which finds new companies,
# reads every careers board, and fills forms (college postings first) until 15:00 or until the Claude tokens are
# finished. Nothing is submitted without your approval on /approvals (PORTAL_SUBMIT=approve).
# Output: applications\_daily\daily-YYYY-MM-DD.log

param([string]$Until = "15:00")

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$logDir = Join-Path $repo "applications\_daily"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("daily-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

function Say([string]$line) {
  ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $line) | Out-File -FilePath $log -Append -Encoding utf8
}

Say "daily careers run: starting (until $Until)"

# Docker Desktop and the database container (restart: unless-stopped brings it back once Docker runs).
$dockerOk = $false
for ($i = 0; $i -lt 36; $i++) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break }
  if ($i -eq 0) {
    $desktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $desktop) { Say "starting Docker Desktop"; Start-Process $desktop }
  }
  Start-Sleep -Seconds 5
}
if (-not $dockerOk) { Say "Docker did not start in 3 minutes: no run today"; exit 1 }

docker start internship-desk-db *> $null
$dbOk = $false
for ($i = 0; $i -lt 24; $i++) {
  $health = docker inspect -f "{{.State.Health.Status}}" internship-desk-db 2>$null
  if ($health -eq "healthy") { $dbOk = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $dbOk) { Say "the database container is not healthy: no run today"; exit 1 }

Say "database up: running scripts/daily.ts --until $Until"
cmd /c "npx tsx scripts/daily.ts --until $Until >> `"$log`" 2>&1"
Say ("daily careers run: finished (exit " + $LASTEXITCODE + ")")
