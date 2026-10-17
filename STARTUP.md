# Native startup

Start PostgreSQL 17 first and configure the root .env with your PostgreSQL
DATABASE_URL. Do not copy Docker hostnames or container paths into native config.
See [native setup](docs/DEPLOYMENT_NATIVE.md) for Windows, MacBook and Hetzner.

From the repository root in Windows PowerShell, after first-time dependency setup:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\start-feely.bat
```

Open http://127.0.0.1:8000. The launcher builds and serves React with the backend.
Ctrl+C stops the backend. PostgreSQL remains running. No port 5500 is needed.

For frontend development, run the backend and Vite in separate terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
npm run dev --prefix frontend-react
```

Open http://127.0.0.1:5173. Admin: /admin.html. Mail: /webmail.html (requires
configured webmail backend). Public Cloudflare access requires --tunnel.
