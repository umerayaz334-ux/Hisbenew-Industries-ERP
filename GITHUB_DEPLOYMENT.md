# GitHub automatic production deployment

Production deployment is controlled by GitHub Actions after changes are committed and pushed to `main`.

```text
Codex / VS Code
  -> local commit
  -> git push origin main
  -> GitHub Actions validates
  -> frontend deploys to cPanel
  -> backend deploys on the Windows VPS runner
```

## Frontend: cPanel

Workflow: `.github/workflows/deploy-frontend-cpanel.yml`

On every `main` push that touches `frontend/**`, GitHub runs:

```text
npm ci
npm run build
upload frontend/dist/ to cPanel
verify https://hisbenew.com/
```

Add these GitHub repository secrets:

```text
CPANEL_FTP_SERVER
CPANEL_FTP_USERNAME
CPANEL_FTP_PASSWORD
```

Add these GitHub repository variables:

```text
VITE_API_BASE_URL=https://api.hisbenew.com
CPANEL_FTP_PROTOCOL=ftps
CPANEL_PUBLIC_HTML_DIR=public_html/
```

If the frontend install or build fails, the upload step does not run.

## Backend: Windows VPS self-hosted runner

Workflow: `.github/workflows/deploy-backend-vps.yml`

Install a GitHub self-hosted runner on the Windows VPS and give it this label:

```text
hisbenew-vps
```

The runner must have access to:

```text
C:\HisbenewERP
```

That folder should be a clean clone of this repository on the `main` branch, and it must be able to run `git fetch origin main` without an interactive prompt. The backend workflow refuses to deploy if tracked local changes exist on the VPS checkout.

The Windows service or scheduled task that runs FastAPI should be named:

```text
Hisbenew ERP Backend
```

The deployment script supports overriding defaults with GitHub repository variables:

```text
ERP_ROOT=C:\HisbenewERP
ERP_BACKEND_VENV=C:\HisbenewERP\backend\venv
ERP_BACKEND_SERVICE_NAME=Hisbenew ERP Backend
ERP_BACKEND_HEALTH_URL=http://127.0.0.1:8000/health
ERP_PUBLIC_API_HEALTH_URL=https://api.hisbenew.com/health
```

On every `main` push that touches `backend/**`, GitHub runs backend unit tests first. If they pass, the VPS runner runs:

```text
git pull --ff-only origin main
python -m pip install -r backend\requirements.txt
restart "Hisbenew ERP Backend"
verify http://127.0.0.1:8000/health
verify https://api.hisbenew.com/health
```

## First deployment checklist

Before enabling automatic deployment, clean tracked runtime artifacts from the repository history or at least from the production checkout. Runtime files such as virtual environments, SQLite databases, logs, uploads, and `tmp/` are already ignored by `.gitignore`, but any copy that was committed in the past can still block `git pull`.

Use the manual GitHub Actions `workflow_dispatch` button for the first frontend and backend deploys. After both workflows pass, normal pushes to `main` become the production deployment trigger.
