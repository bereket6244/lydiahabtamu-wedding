# Deploying the invitation to menaincet.com/yeabsrachristian

This repo auto-deploys to `https://menaincet.com/yeabsrachristian` whenever you push to `main`.

## One-time setup

### 1. Keep credentials in GitHub Actions secrets
Do not commit cPanel or GitHub tokens to the repo. Store deployment credentials only as repository secrets.

### 2. Create the GitHub repo and push
From this folder:
```bash
git init
git add .
git commit -m "Engagement invitation site"
git branch -M main
git remote add origin https://github.com/<you>/yeabachris-wedding.git
git push -u origin main
```
(Create the empty repo on github.com first, or use `gh repo create`.)

### 3. Add the deploy secrets in GitHub
Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret name    | Value                                    |
|----------------|------------------------------------------|
| `CPANEL_HOST`  | `menaincet.com`                         |
| `CPANEL_USER`  | cPanel username                          |
| `CPANEL_TOKEN` | cPanel API token                         |
| `CPANEL_TARGET_DIR` | `/home/menainpy/public_html/yeabsrachristian` |

Credentials live only in GitHub's encrypted secrets — never in the repo.
The old `FTP_*` and `SSH_*` secrets can be deleted if this repo no longer uses them.

### 4. Push again (or run the workflow manually)
Any push to `main` now uploads the public site files into `/home/menainpy/public_html/yeabsrachristian/`.
First run also creates missing directories.

## Notes
- The site uses relative paths, so it works fine under the `/yeabsrachristian` subpath.
- `.github/workflows/deploy.yml` controls the deploy.
- `scripts/deploy-cpanel.mjs` uploads `index.html`, `support.js`, `flower-petal.png`, `assets/**`, and the two read-only gallery files `api/gallery.php` and `api/gallery-lib.php`.
- The existing server `api/config.php`, `api/photos.php`, database, and original uploads are never replaced. The gallery uses the same database configuration and public visibility rules.
- Gallery previews require PHP GD (with EXIF for rotated JPEGs) or Imagick. Previews are cached outside the web root; visibility is checked before serving each image. Originals are returned unchanged only when selected.
- Dependencies deploy first. A live gallery/preview smoke test must succeed before `index.html` is uploaded last. A failed check leaves the previous invitation in place.

## Gallery checks

- Run `php tests/gallery-preview.php` with GD and EXIF enabled to verify dimensions, compression, orientation, transparency, and original preservation.
- Run `node tests/gallery-api.mjs` with PHP GD/EXIF/PDO SQLite to test the real request handler against an isolated temporary database, including more than 80 photos and cached-image visibility. Set `PHP_BINARY` and JSON-array `PHP_TEST_ARGS` if PHP is not on PATH.
- For browser testing, set `GALLERY_TEST_OUTPUT` to a temporary directory, run the preview test to generate images, then `node tests/serve-gallery.mjs`. This localhost fixture server never forwards writes to production.
