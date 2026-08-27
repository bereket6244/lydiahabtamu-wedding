# Deploying the invitation to menaincet.com/yeabachris

This repo auto-deploys to `https://menaincet.com/yeabachris` whenever you push to `main`.

## One-time setup

### 1. Rotate your credentials first (they were exposed in chat)
- GitHub: delete the old personal access token, create a fresh one (or use `gh auth login`).
- cPanel → SSH Access → Manage SSH Keys: delete the old key, **generate a new key pair**.
  Authorize the new public key so it can log in.
- cPanel → Manage API Tokens: revoke the old token. Change your cPanel password.

### 2. Create the GitHub repo and push
From this folder:
```bash
git init
git add .
git commit -m "Engagement invitation site"
git branch -M main
git remote add origin https://github.com/<you>/yeabachris.git
git push -u origin main
```
(Create the empty `yeabachris` repo on github.com first, or use `gh repo create`.)

### 3. Add the deploy secrets in GitHub
This host firewalls inbound SSH, so deployment goes over **FTPS** instead.
First create a dedicated FTP account in cPanel → **FTP Accounts**:
- Log In: `deploy`  →  full username becomes `deploy@menaincet.com`
- Directory: `public_html/yeabachris`
- Set a strong password.

Then Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret name    | Value                                    |
|----------------|------------------------------------------|
| `FTP_SERVER`   | `sunrise.hostns.io`                      |
| `FTP_USERNAME` | `deploy@menaincet.com`                   |
| `FTP_PASSWORD` | the FTP account password you just set    |

`FTP_SERVER` uses the shared-server hostname so the TLS certificate matches.
Credentials live only in GitHub's encrypted secrets — never in the repo.
The old `SSH_*` secrets can be deleted.

### 4. Push again (or run the workflow manually)
Any push to `main` now rsyncs the site into `/home/menainpy/public_html/yeabachris/`.
First run also creates that directory.

## Notes
- The site uses relative paths, so it works fine under the `/yeabachris` subpath.
- Fonts (Google Fonts) and the background music (YouTube) load from the internet.
- `.github/workflows/deploy.yml` controls the deploy; `EXCLUDE` keeps repo-only
  files (README, the `.dc.html` source, uploads, etc.) off the live server.
