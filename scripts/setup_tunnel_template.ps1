param(
    [string]$TunnelName = "feely-backend",
    [string]$LocalUrl = "http://127.0.0.1:8000",
    [string]$Hostname = "api.example.com"
)

Write-Host "This is a template helper. It does not run cloudflared commands automatically."
Write-Host "Follow these manual steps to create a persistent system service tunnel."

Write-Host "Step 1: Authenticate (runs in your user session)"
Write-Host "  cloudflared login"

Write-Host "Step 2: Create a named tunnel"
Write-Host "  cloudflared tunnel create $TunnelName"
Write-Host "  # note the returned tunnel id (GUID)"

Write-Host "Step 3: Create a config file (example path: C:\Program Files\cloudflared\config.yml)"
@"
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\<YOUR-USER>\.cloudflared\<TUNNEL-ID>.json
ingress:
  - hostname: $Hostname
    service: $LocalUrl
  - service: http_status:404
"@ | Out-File -Encoding utf8 -FilePath .\cloudflared-config-template.yml

Write-Host "A template config was written to .\cloudflared-config-template.yml — edit it with the real tunnel id, credentials path, and hostname."

Write-Host "Step 4: Route DNS"
Write-Host "  cloudflared tunnel route dns $TunnelName $Hostname"

Write-Host "Step 5: Test run"
Write-Host "  cloudflared tunnel run $TunnelName --config \"C:\Program Files\cloudflared\config.yml\""

Write-Host "Step 6: (Administrator) Install a Windows service to run the tunnel persistently"
Write-Host "  sc.exe create cloudflared binPath= \"\"C:\Program Files\cloudflared\cloudflared.exe\" tunnel run $TunnelName --config \"C:\Program Files\cloudflared\config.yml\"\" start= auto"
Write-Host "  sc.exe start cloudflared"

Write-Host "Notes: The credentials file created by `cloudflared tunnel create` lives under your user profile (\"%USERPROFILE%\\.cloudflared\"). When installing a service that runs as SYSTEM, set `credentials-file` to an absolute path the service can access (copy the credentials json into a system-wide folder and update the config)."
