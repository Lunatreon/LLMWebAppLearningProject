@echo off
setlocal
cd /d "%~dp0"
set "ACTION=%~1"
if not defined ACTION set "ACTION=start"
if "%ACTION%"=="start" goto validate
if "%ACTION%"=="stop" goto validate
if "%ACTION%"=="status" goto validate
if "%ACTION%"=="logs" goto validate
if "%ACTION%"=="check" goto validate
echo Usage: feely.bat [start^|stop^|status^|logs^|check]
exit /b 1

:validate
where docker >nul 2>&1
if errorlevel 1 (
  echo Docker is missing. Install Docker Desktop with Linux containers.
  exit /b 1
)
docker info --format "{{.OSType}}" | findstr /x "linux" >nul
if errorlevel 1 (
  echo Docker Linux engine is unavailable. Open Docker Desktop and wait for the engine.
  exit /b 1
)
if exist ".env.docker" goto configured
if "%ACTION%"=="start" goto setup
if "%ACTION%"=="check" goto setup
echo No .env.docker found. Run feely.bat start first.
exit /b 1

:setup
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" scripts\setup_docker_env.py
) else (
  docker run --rm --mount "type=bind,source=%CD%,target=/workspace" --workdir /workspace python:3.13.14-slim-bookworm python scripts/setup_docker_env.py
)
if errorlevel 1 exit /b 1

:configured
set "COMPOSE=docker compose --env-file .env.docker -f compose.yml --profile app"
%COMPOSE% config --quiet
if errorlevel 1 exit /b 1
goto %ACTION%

:start
%COMPOSE% up -d --build --wait --wait-timeout 180
if errorlevel 1 exit /b 1
echo FeelY started. Default URLs:
echo App: http://127.0.0.1:5173
echo Test email: http://127.0.0.1:8025
echo If you changed ports in .env.docker, use those ports.
echo Stop with feely.bat stop. Your database and prompts are kept.
exit /b 0

:stop
%COMPOSE% down
exit /b %ERRORLEVEL%

:status
%COMPOSE% ps
exit /b %ERRORLEVEL%

:logs
%COMPOSE% logs --follow --tail 100
exit /b %ERRORLEVEL%

:check
echo Docker engine and Compose configuration are ready.
exit /b 0
