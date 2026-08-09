from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .database import SessionLocal
from .models import User


router = APIRouter(prefix="/admin/deployment", tags=["deployment"])

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
FRONTEND_WORKFLOW = "deploy-frontend-cpanel.yml"
BACKEND_WORKFLOW = "deploy-backend-vps.yml"
PUBLIC_FRONTEND_URL = os.getenv("ERP_PUBLIC_FRONTEND_URL", "https://hisbenew.com/")
PUBLIC_API_HEALTH_URL = os.getenv("ERP_PUBLIC_API_HEALTH_URL", "https://api.hisbenew.com/health")
LOCAL_API_HEALTH_URL = os.getenv("ERP_BACKEND_HEALTH_URL", "http://127.0.0.1:8000/health")


class DeploymentActionRequest(BaseModel):
    action: str
    ref: str = "main"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _require_admin_user(request: Request) -> User:
    user_id = getattr(request.state, "user_id", None)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    finally:
        db.close()

    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if user.role not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Only administrators can manage deployment.")
    return user


def _run_command(command: list[str], cwd: Path = REPO_ROOT, timeout: int = 30) -> dict:
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": (completed.stdout or "").strip()[-8000:],
            "stderr": (completed.stderr or "").strip()[-8000:],
            "command": " ".join(command),
        }
    except FileNotFoundError:
        return {
            "ok": False,
            "returncode": None,
            "stdout": "",
            "stderr": f"{command[0]} is not installed or not available on PATH.",
            "command": " ".join(command),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": None,
            "stdout": (exc.stdout or "").strip()[-8000:] if isinstance(exc.stdout, str) else "",
            "stderr": f"Command timed out after {timeout} seconds.",
            "command": " ".join(command),
        }


def _run_git(args: list[str], timeout: int = 20) -> dict:
    return _run_command(["git", *args], timeout=timeout)


def _parse_github_repo(remote_url: str) -> str:
    remote = str(remote_url or "").strip()
    patterns = [
        r"github\.com[:/](?P<repo>[^/]+/[^/.]+)(?:\.git)?$",
        r"github\.com[:/](?P<repo>[^/]+/[^/]+?)(?:\.git)?$",
    ]
    for pattern in patterns:
        match = re.search(pattern, remote)
        if match:
            return match.group("repo")
    return os.getenv("GITHUB_REPOSITORY", "").strip()


def _git_repository_status() -> dict:
    branch = _run_git(["branch", "--show-current"])
    head = _run_git(["rev-parse", "--short=12", "HEAD"])
    head_full = _run_git(["rev-parse", "HEAD"])
    message = _run_git(["log", "-1", "--pretty=%s"])
    remote = _run_git(["config", "--get", "remote.origin.url"])
    status = _run_git(["status", "--porcelain=v1"], timeout=30)
    upstream = _run_git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])

    lines = [line for line in status.get("stdout", "").splitlines() if line.strip()]
    staged = sum(1 for line in lines if line[:1].strip())
    unstaged = sum(1 for line in lines if len(line) > 1 and line[1:2].strip())
    untracked = sum(1 for line in lines if line.startswith("??"))

    repo = _parse_github_repo(remote.get("stdout", ""))
    return {
        "root": str(REPO_ROOT),
        "branch": branch.get("stdout") or None,
        "head": head.get("stdout") or None,
        "head_full": head_full.get("stdout") or None,
        "message": message.get("stdout") or None,
        "remote": remote.get("stdout") or None,
        "github_repository": repo or None,
        "upstream": upstream.get("stdout") if upstream.get("ok") else None,
        "clean": status.get("ok") and not lines,
        "status_counts": {
            "changed": len(lines),
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked,
        },
        "status_preview": lines[:25],
        "git_available": all(
            result.get("ok")
            for result in (branch, head, head_full, message, remote, status)
        ),
    }


def _workflow_status(filename: str) -> dict:
    relative = f".github/workflows/{filename}"
    local_path = WORKFLOWS_DIR / filename
    origin_tree = _run_git(["ls-tree", "-r", "--name-only", "origin/main", "--", relative])
    return {
        "name": filename,
        "local_exists": local_path.exists(),
        "tracked_on_origin_main": relative in origin_tree.get("stdout", "").splitlines(),
        "path": relative,
    }


def _local_frontend_build_status() -> dict:
    index_path = FRONTEND_DIR / "dist" / "index.html"
    asset = None
    updated_at = None
    if index_path.exists():
        try:
            content = index_path.read_text(encoding="utf-8", errors="ignore")
            asset_match = re.search(r'src="/assets/([^"]+\.js)"', content)
            asset = asset_match.group(1) if asset_match else None
            updated_at = datetime.fromtimestamp(index_path.stat().st_mtime, timezone.utc).isoformat()
        except OSError:
            pass

    return {
        "package_json_exists": (FRONTEND_DIR / "package.json").exists(),
        "package_lock_exists": (FRONTEND_DIR / "package-lock.json").exists(),
        "dist_exists": (FRONTEND_DIR / "dist").exists(),
        "index_asset": asset,
        "index_updated_at": updated_at,
    }


def _http_probe(url: str, parse_asset: bool = False, timeout: int = 8) -> dict:
    started_at = datetime.now(timezone.utc)
    request = urllib_request.Request(
        url,
        headers={
            "User-Agent": "HisbenewERP-Deployment/1.0",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    try:
        with urllib_request.urlopen(request, timeout=timeout) as response:
            raw = response.read(200000)
            text = raw.decode("utf-8", errors="ignore")
            elapsed_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
            asset = None
            if parse_asset:
                asset_match = re.search(r'src="/assets/([^"]+\.js)"', text)
                asset = asset_match.group(1) if asset_match else None
            return {
                "ok": 200 <= int(response.status) < 400,
                "status_code": int(response.status),
                "elapsed_ms": elapsed_ms,
                "url": url,
                "asset": asset,
                "content_length": len(raw),
            }
    except urllib_error.HTTPError as exc:
        return {
            "ok": False,
            "status_code": exc.code,
            "elapsed_ms": int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000),
            "url": url,
            "error": str(exc),
        }
    except Exception as exc:
        return {
            "ok": False,
            "status_code": None,
            "elapsed_ms": int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000),
            "url": url,
            "error": str(exc),
        }


def _github_token() -> str:
    return (
        os.getenv("GITHUB_DEPLOY_TOKEN")
        or os.getenv("GITHUB_TOKEN")
        or os.getenv("GH_TOKEN")
        or ""
    ).strip()


def _github_api(repo: str, path: str, method: str = "GET", payload: dict | None = None) -> dict:
    token = _github_token()
    if not token:
        return {
            "ok": False,
            "configured": False,
            "status_code": None,
            "error": "Set GITHUB_DEPLOY_TOKEN on the backend server to use GitHub Actions controls from ERP.",
        }
    if not repo:
        return {
            "ok": False,
            "configured": True,
            "status_code": None,
            "error": "GitHub repository could not be detected from remote.origin.url.",
        }

    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    request = urllib_request.Request(
        f"https://api.github.com/repos/{repo}{path}",
        data=body,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "HisbenewERP-Deployment/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib_request.urlopen(request, timeout=20) as response:
            raw = response.read()
            parsed = json.loads(raw.decode("utf-8")) if raw else None
            return {
                "ok": 200 <= int(response.status) < 300,
                "configured": True,
                "status_code": int(response.status),
                "data": parsed,
            }
    except urllib_error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="ignore")
        return {
            "ok": False,
            "configured": True,
            "status_code": exc.code,
            "error": raw or str(exc),
        }
    except Exception as exc:
        return {
            "ok": False,
            "configured": True,
            "status_code": None,
            "error": str(exc),
        }


def _github_actions_status(repo: str) -> dict:
    token_configured = bool(_github_token())
    result = {
        "token_configured": token_configured,
        "repository": repo or None,
        "workflows": None,
        "runs": None,
        "error": None,
    }
    if not token_configured or not repo:
        return result

    workflows = _github_api(repo, "/actions/workflows")
    runs = _github_api(repo, "/actions/runs?per_page=8")
    if workflows.get("ok"):
        result["workflows"] = [
            {
                "name": item.get("name"),
                "path": item.get("path"),
                "state": item.get("state"),
                "html_url": item.get("html_url"),
            }
            for item in workflows.get("data", {}).get("workflows", [])
        ]
    else:
        result["error"] = workflows.get("error")
    if runs.get("ok"):
        result["runs"] = [
            {
                "name": item.get("name"),
                "event": item.get("event"),
                "head_branch": item.get("head_branch"),
                "head_sha": item.get("head_sha"),
                "status": item.get("status"),
                "conclusion": item.get("conclusion"),
                "created_at": item.get("created_at"),
                "html_url": item.get("html_url"),
            }
            for item in runs.get("data", {}).get("workflow_runs", [])
        ]
    elif not result["error"]:
        result["error"] = runs.get("error")
    return result


def _deployment_capabilities(repo: dict) -> dict:
    return {
        "frontend_build": (FRONTEND_DIR / "package.json").exists(),
        "trigger_github_workflows": bool(_github_token()) and bool(repo.get("github_repository")),
        "local_backend_deploy": _truthy(os.getenv("ERP_ENABLE_LOCAL_DEPLOY_ACTIONS")),
    }


def _deployment_status() -> dict:
    repo = _git_repository_status()
    local_build = _local_frontend_build_status()
    live_frontend = _http_probe(PUBLIC_FRONTEND_URL, parse_asset=True)
    local_api = _http_probe(LOCAL_API_HEALTH_URL)
    public_api = _http_probe(PUBLIC_API_HEALTH_URL)
    workflows = {
        "frontend": _workflow_status(FRONTEND_WORKFLOW),
        "backend": _workflow_status(BACKEND_WORKFLOW),
    }
    actions = _github_actions_status(repo.get("github_repository") or "")

    checklist = [
        {
            "key": "frontend_workflow",
            "label": "Frontend GitHub workflow committed",
            "ok": workflows["frontend"]["tracked_on_origin_main"],
            "help": "Commit .github/workflows/deploy-frontend-cpanel.yml to main.",
        },
        {
            "key": "backend_workflow",
            "label": "Backend VPS workflow committed",
            "ok": workflows["backend"]["tracked_on_origin_main"],
            "help": "Commit backend workflow after the self-hosted Windows VPS runner is ready.",
        },
        {
            "key": "github_token",
            "label": "ERP can trigger GitHub Actions",
            "ok": actions["token_configured"],
            "help": "Set GITHUB_DEPLOY_TOKEN on the backend server for in-ERP workflow trigger buttons.",
        },
        {
            "key": "live_frontend",
            "label": "Live frontend matches latest local build",
            "ok": bool(local_build["index_asset"] and live_frontend.get("asset") == local_build["index_asset"]),
            "help": "Run the frontend workflow or fix cPanel FTP settings until the live bundle changes.",
        },
        {
            "key": "public_api",
            "label": "Public API health is reachable",
            "ok": public_api.get("ok"),
            "help": "Check api.hisbenew.com reverse proxy and backend service.",
        },
    ]

    return {
        "generated_at": _utc_now(),
        "repository": repo,
        "workflows": workflows,
        "github_actions": actions,
        "local_frontend": local_build,
        "live_frontend": live_frontend,
        "health": {
            "local_api": local_api,
            "public_api": public_api,
        },
        "capabilities": _deployment_capabilities(repo),
        "settings": {
            "public_frontend_url": PUBLIC_FRONTEND_URL,
            "public_api_health_url": PUBLIC_API_HEALTH_URL,
            "local_api_health_url": LOCAL_API_HEALTH_URL,
            "local_backend_deploy_enabled": _truthy(os.getenv("ERP_ENABLE_LOCAL_DEPLOY_ACTIONS")),
            "required_github_secrets": [
                "CPANEL_FTP_SERVER",
                "CPANEL_FTP_USERNAME",
                "CPANEL_FTP_PASSWORD",
            ],
            "required_github_variables": [
                {"name": "VITE_API_BASE_URL", "value": "https://api.hisbenew.com"},
                {"name": "CPANEL_FTP_PROTOCOL", "value": "ftps"},
                {"name": "CPANEL_PUBLIC_HTML_DIR", "value": "public_html/"},
            ],
            "backend_environment": [
                {
                    "name": "GITHUB_DEPLOY_TOKEN",
                    "purpose": "Allows ERP buttons to trigger GitHub Actions workflows.",
                    "configured": bool(_github_token()),
                },
                {
                    "name": "ERP_ENABLE_LOCAL_DEPLOY_ACTIONS",
                    "purpose": "Allows the VPS to run scripts/deploy-backend.ps1 from ERP.",
                    "configured": _truthy(os.getenv("ERP_ENABLE_LOCAL_DEPLOY_ACTIONS")),
                },
                {
                    "name": "ERP_BACKEND_HEALTH_URL",
                    "purpose": "Overrides the local FastAPI health check URL.",
                    "configured": bool(os.getenv("ERP_BACKEND_HEALTH_URL")),
                },
                {
                    "name": "ERP_PUBLIC_API_HEALTH_URL",
                    "purpose": "Overrides the public API health check URL.",
                    "configured": bool(os.getenv("ERP_PUBLIC_API_HEALTH_URL")),
                },
            ],
        },
        "checklist": checklist,
    }


@router.get("/status")
def get_deployment_status(request: Request):
    _require_admin_user(request)
    return _deployment_status()


@router.post("/actions")
def run_deployment_action(payload: DeploymentActionRequest, request: Request):
    _require_admin_user(request)
    action = payload.action.strip().lower()
    ref = payload.ref.strip() or "main"

    if action == "frontend_build":
        npm = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
        result = _run_command([npm, "run", "build"], cwd=FRONTEND_DIR, timeout=240)
        return {
            "ok": result["ok"],
            "action": action,
            "message": "Frontend build completed." if result["ok"] else "Frontend build failed.",
            "result": result,
            "status": _deployment_status(),
        }

    repo = _git_repository_status().get("github_repository") or ""
    if action in {"trigger_frontend_deploy", "trigger_backend_deploy"}:
        workflow = FRONTEND_WORKFLOW if action == "trigger_frontend_deploy" else BACKEND_WORKFLOW
        result = _github_api(
            repo,
            f"/actions/workflows/{workflow}/dispatches",
            method="POST",
            payload={"ref": ref},
        )
        if not result.get("ok"):
            return {
                "ok": False,
                "action": action,
                "message": result.get("error") or "GitHub workflow dispatch failed.",
                "result": result,
                "status": _deployment_status(),
            }
        return {
            "ok": True,
            "action": action,
            "message": f"{workflow} was triggered on {ref}.",
            "result": result,
            "status": _deployment_status(),
        }

    if action == "local_backend_deploy":
        if not _truthy(os.getenv("ERP_ENABLE_LOCAL_DEPLOY_ACTIONS")):
            return {
                "ok": False,
                "action": action,
                "message": "Local backend deploy is disabled. Set ERP_ENABLE_LOCAL_DEPLOY_ACTIONS=true on the VPS to enable it.",
                "status": _deployment_status(),
            }
        script = REPO_ROOT / "scripts" / "deploy-backend.ps1"
        if not script.exists():
            return {
                "ok": False,
                "action": action,
                "message": "scripts/deploy-backend.ps1 was not found.",
                "status": _deployment_status(),
            }
        powershell = shutil.which("powershell.exe") or shutil.which("pwsh") or "powershell.exe"
        result = _run_command(
            [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
            cwd=REPO_ROOT,
            timeout=420,
        )
        return {
            "ok": result["ok"],
            "action": action,
            "message": "Local backend deploy completed." if result["ok"] else "Local backend deploy failed.",
            "result": result,
            "status": _deployment_status(),
        }

    raise HTTPException(status_code=400, detail="Unknown deployment action.")
