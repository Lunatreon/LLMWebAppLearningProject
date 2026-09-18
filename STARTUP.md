```powershell
# Run each block in a separate VS Code PowerShell terminal, from the FeelY folder.
# Terminal 1: Ollama (quit the Ollama tray app first if it is already running)
$env:OLLAMA_KEEP_ALIVE = "300"
ollama serve
```

```powershell
# Terminal 2: backend with colored logs
# Load models only when needed and release them after five idle minutes.
# Current configuration: qwen3.5:4b on CPU and qwen3.5:2b on GPU.
$env:OLLAMA_PREWARM = "false"
$env:OLLAMA_KEEP_ALIVE = "300"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --use-colors --proxy-headers --forwarded-allow-ips 127.0.0.1 --no-server-header
```

```powershell
# Terminal 3: website (also builds a complete page for static preview servers)
.\.venv\Scripts\python.exe scripts\build_frontend.py
.\.venv\Scripts\python.exe -m uvicorn app.website:app --host 127.0.0.1 --port 5500 --proxy-headers --forwarded-allow-ips 127.0.0.1 --no-server-header
```

```powershell
# Terminal 4: Cloudflare tunnel
& "C:\Program Files\cloudflared\cloudflared.exe" tunnel --config .\scripts\cloudflared-public.yml run
```

```powershell
# Terminal 5: inspect loaded models (an empty list before the first chat is normal), then open the website
ollama ps
Start-Process "http://127.0.0.1:5500"
```

```powershell
# Alternative to terminals 2-4: start backend, website, and tunnel together
# Start Ollama in terminal 1 first. Do not also run the individual servers above.
.\start-feely.bat --color
```
