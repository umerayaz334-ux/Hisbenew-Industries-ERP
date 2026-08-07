Hisbenew ERP portable folder notes
==================================

Use this folder as the ERP home folder. Keep it on D: when you want ERP data,
uploads, logs, temp files, and package caches to grow on D: instead of C:.

Start ERP:
  Start-Hisbenew-Erp-Mobile.cmd

First run after copying to another PC:
  1. Install Python 3.12+ and Node.js if they are not already installed.
  2. Run Setup-Hisbenew-Erp-Portable.cmd once if backend venv or frontend
     node_modules do not work on that PC.
  3. Start ERP with Start-Hisbenew-Erp-Mobile.cmd.

Important local data kept inside this folder:
  backend\hisbenew_industries.db        ERP database
  backend\.secret_key                   login token secret
  backend\website_settings.json         website settings
  backend\email_settings.json           email/API mail settings
  backend\static\uploads                product, label, and fulfillment files
  tmp\startup                           backend/frontend startup logs
  tmp\portable                          temp, npm, pip, Python, and tool caches

Copying to another PC:
  Copy the whole "Hisbenew Industries ERP" folder, including backend, frontend,
  data, tmp, and node_modules/venv when present.

Note:
  This launcher keeps ERP runtime growth inside this folder. Windows, VS Code,
  browser profiles, and Codex/editor history may still write their own caches to
  C: because they are separate applications outside the ERP.
