param(
    [string]$InstallDir = "C:\Program Files\cloudflared"
)

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Open PowerShell as Admin and try again."
    exit 1
}

Write-Host "Creating install directory: $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
$out = Join-Path $InstallDir "cloudflared.exe"

Write-Host "Downloading cloudflared from $url ..."
Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing

Write-Host "Download complete: $out"
Write-Host "Verify with: & '$out' --version"
Write-Host "Next steps (run as your regular user):"
Write-Host "  1) Run: & '$out' login    # opens browser to authenticate with Cloudflare"
Write-Host "  2) Create a tunnel: & '$out' tunnel create my-tunnel"
Write-Host "  3) Follow `scripts/setup_tunnel_template.ps1` to create a config and install a service"
