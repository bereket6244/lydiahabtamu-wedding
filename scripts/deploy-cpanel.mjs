import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const required = ["CPANEL_HOST", "CPANEL_USER", "CPANEL_TOKEN", "CPANEL_TARGET_DIR"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const host = process.env.CPANEL_HOST;
const user = process.env.CPANEL_USER;
const token = process.env.CPANEL_TOKEN;
const targetDir = process.env.CPANEL_TARGET_DIR.replace(/\/+$/, "");
const sourceDir = path.resolve(process.env.DEPLOY_SOURCE_DIR || ".");
const authHeader = `cpanel ${user}:${token}`;

const rootFiles = new Set(["index.html", "support.js", "flower-petal.png"]);
const rootDirs = new Set(["assets"]);
const galleryApiFiles = new Set(["api/gallery-lib.php", "api/gallery.php"]);
const skipDirs = new Set([
  ".git",
  ".github",
  ".claude",
  "node_modules",
  "dist",
  "export",
  "uploads",
]);

function shouldUpload(localFile) {
  const relative = path.relative(sourceDir, localFile).replaceAll(path.sep, "/");
  const [first] = relative.split("/");
  return rootFiles.has(relative) || rootDirs.has(first) || galleryApiFiles.has(relative);
}

async function cpanelApi2(module, func, params = {}) {
  const url = new URL(`https://${host}:2083/json-api/cpanel`);
  url.searchParams.set("cpanel_jsonapi_user", user);
  url.searchParams.set("cpanel_jsonapi_apiversion", "2");
  url.searchParams.set("cpanel_jsonapi_module", module);
  url.searchParams.set("cpanel_jsonapi_func", func);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    throw new Error(`${module}/${func} failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const event = payload.cpanelresult?.event;
  if (event?.result !== 1) {
    const reason = event?.reason || payload.cpanelresult?.error || "unknown cPanel error";
    throw new Error(`${module}/${func} failed: ${reason}`);
  }

  return payload;
}

async function ensureDir(remoteDir) {
  if (!remoteDir || remoteDir === "/" || remoteDir === ".") return;

  const parent = path.posix.dirname(remoteDir);
  const name = path.posix.basename(remoteDir);

  if (parent && parent !== remoteDir) {
    await ensureDir(parent);
  }

  await cpanelApi2("Fileman", "mkdir", { path: parent, name, permissions: "0755" }).catch((error) => {
    if (!String(error.message).toLowerCase().includes("exists")) throw error;
  });
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const relative = path.relative(sourceDir, fullPath).replaceAll(path.sep, "/");
      if (skipDirs.has(relative) || skipDirs.has(entry.name)) continue;
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile() && shouldUpload(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function uploadFile(localFile) {
  const relative = path.relative(sourceDir, localFile).replaceAll(path.sep, "/");
  const remoteDir = `${targetDir}/${path.posix.dirname(relative)}`.replace(/\/\.$/, "");
  await ensureDir(remoteDir);

  const payload = await curlJson([
    "-sS",
    "-X",
    "POST",
    "-H",
    `Authorization: ${authHeader}`,
    "-F",
    `dir=${remoteDir}`,
    "-F",
    "overwrite=1",
    "-F",
    `file-1=@${localFile};filename=${path.posix.basename(relative)}`,
    `https://${host}:2083/execute/Fileman/upload_files`,
  ]);

  if (payload.status !== 1) {
    const failures = payload.data?.uploads
      ?.flatMap((upload) => upload.errors || [])
      ?.filter(Boolean)
      ?.join("; ");
    const message = failures || payload.errors?.join("; ") || payload.messages?.join("; ") || "unknown cPanel error";
    throw new Error(`Upload failed for ${relative}: ${message}`);
  }

  console.log(`Uploaded ${relative}`);
}

function curlJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exited with ${code}: ${stderr.trim()}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Could not parse cPanel response: ${error.message}`));
      }
    });
  });
}

await ensureDir(targetDir);

const files = await listFiles(sourceDir);
// Publish dependencies first; switch the invitation only after the read-only
// gallery and image processing have passed a live smoke test.
files.sort((a, b) => {
  const rank = file => {
    const relative = path.relative(sourceDir, file).replaceAll(path.sep, "/");
    if (relative === "api/gallery-lib.php") return 0;
    if (relative === "api/gallery.php") return 1;
    if (relative === "index.html") return 3;
    return 2;
  };
  return rank(a) - rank(b);
});
for (const file of files) {
  if (path.relative(sourceDir, file) === "index.html") {
    const base = new URL(process.env.SITE_URL || "https://menaincet.com/yeabsrachristian/");
    const response = await fetch(new URL("api/gallery.php", base));
    if (!response.ok) throw new Error(`Gallery check failed: HTTP ${response.status}. Invitation was not switched.`);
    const listing = await response.json();
    if (!Array.isArray(listing.photos)) throw new Error("Invalid gallery response. Invitation was not switched.");
    if (listing.photos[0]) {
      const preview = await fetch(new URL(listing.photos[0].previewSrc, base));
      if (!preview.ok || !preview.headers.get("content-type")?.startsWith("image/")) {
        throw new Error("Preview check failed. Invitation was not switched.");
      }
      const bytes = new Uint8Array(await preview.arrayBuffer());
      if (bytes.length < 100 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Invalid JPEG preview.");
    }
    console.log(`Gallery smoke test passed: ${listing.photos.length} public photos.`);
  }
  await uploadFile(file);
}

console.log(`Deployment complete: ${files.length} files uploaded to ${targetDir}`);
