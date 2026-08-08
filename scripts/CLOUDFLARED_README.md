# Cloudflared helper scripts

These scripts help install and configure `cloudflared` on Windows for a
persistent system-wide Cloudflare Tunnel.

Important prerequisites
- You must have a Cloudflare account and a domain (or access to a zone) in
  Cloudflare to create a persistent named tunnel and route DNS.
- The `cloudflared login` step opens a browser and requires you to authenticate.
- Administrator privileges are required for system-wide installation and
  creating a Windows service.

Files
- `install_cloudflared.ps1` — downloads `cloudflared.exe` into
  `C:\Program Files\cloudflared` (run as Administrator).
- `setup_tunnel_template.ps1` — template and instructions to create a tunnel,
  write a config, route DNS, and install a Windows service.

Quick next steps

1. Create a Cloudflare account and add your domain to Cloudflare.
2. From your regular user PowerShell session run:

```powershell
"C:\Program Files\cloudflared\cloudflared.exe" login
```

3. Create a tunnel:

```powershell
"C:\Program Files\cloudflared\cloudflared.exe" tunnel create feely-backend
```

4. Edit the generated config template in `scripts/cloudflared-config-template.yml` and copy it to `C:\Program Files\cloudflared\config.yml` (adjust paths & hostname).

5. Install the Windows service as Administrator (example):

```powershell
sc.exe create cloudflared binPath= '"C:\Program Files\cloudflared\cloudflared.exe" tunnel run feely-backend --config "C:\Program Files\cloudflared\config.yml"' start= auto
sc.exe start cloudflared
```

If you want, I can: download and install `cloudflared` now (requires Administrator), or walk you through registering a Cloudflare account and creating the tunnel interactively.
