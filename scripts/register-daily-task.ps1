# Registers (or updates) the Windows scheduled task that runs the daily careers run every day at 9:00, for the signed-in
# user, until 15:00 or until the Claude tokens are finished (scripts/daily-task.ps1). A PC asleep at 9:00 runs it when it
# wakes, still stopping at 15:00.
#   powershell -ExecutionPolicy Bypass -File scripts\register-daily-task.ps1            # 9:00 → 15:00
#   powershell -ExecutionPolicy Bypass -File scripts\register-daily-task.ps1 -At 08:30 -Until 16:00
#   Unregister-ScheduledTask -TaskName "InternshipDesk Daily Careers Run" -Confirm:$false   # remove it

param([string]$At = "09:00", [string]$Until = "15:00")

$script = Join-Path $PSScriptRoot "daily-task.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"" + $script + "`" -Until " + $Until) `
  -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "InternshipDesk Daily Careers Run" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Internship Desk: new companies, careers boards, forms filled for approval ($At to $Until or until the Claude tokens run out)." -Force | Out-Null
Get-ScheduledTask -TaskName "InternshipDesk Daily Careers Run" | Select-Object TaskName, State, @{ n = "Next run"; e = { (Get-ScheduledTaskInfo $_).NextRunTime } }
