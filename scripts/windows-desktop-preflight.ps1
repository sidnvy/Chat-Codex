# Read-only preflight; run inside an authenticated Windows user session.
# Never installs services, changes firewall policy, or prints credentials.
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$sessionId = (Get-Process -Id $PID).SessionId
$sessionName = $env:SESSIONNAME
$explorerSessions = @(
  Get-Process -Name explorer -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty SessionId -Unique
)
$ssh = Get-Service -Name sshd -ErrorAction SilentlyContinue
$rdp = Get-Service -Name TermService -ErrorAction SilentlyContinue
$winapp = Get-Command winapp -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue
$interactiveUser = [Environment]::UserInteractive
$interactiveDesktop = $interactiveUser -and ($sessionId -gt 0) -and ($explorerSessions -contains $sessionId)
$status = [ordered]@{
  schema_version = 1
  platform = "windows"
  computer_name = $env:COMPUTERNAME
  os_caption = $os.Caption
  os_build = $os.BuildNumber
  process_session_id = $sessionId
  session_name = $sessionName
  process_user_interactive = $interactiveUser
  explorer_in_same_session = ($explorerSessions -contains $sessionId)
  desktop_session_candidate = $interactiveDesktop
  ssh_service = if ($null -eq $ssh) { "not_installed" } else { [string]$ssh.Status }
  rdp_service = if ($null -eq $rdp) { "not_installed" } else { [string]$rdp.Status }
  winapp_installed = ($null -ne $winapp)
  node_installed = ($null -ne $node)
  note = "Interactive session is only a candidate. GUI readiness and UIA permissions still require actual Windows acceptance."
}
$status | ConvertTo-Json -Depth 5
