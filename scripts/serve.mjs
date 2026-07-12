import { createReadStream, existsSync, statSync } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const portValue = portIndex >= 0 ? Number(args[portIndex + 1]) : 4173;
const shouldOpen = args.includes("--open");
const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 4173;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

function toFilePath(urlPathname) {
  const safePath = decodeURIComponent(urlPathname.split("?")[0]);
  const relativePath = safePath === "/" ? "index.html" : safePath.replace(/^\/+/, "");
  const absolutePath = path.resolve(rootDir, relativePath);
  return absolutePath.startsWith(rootDir) ? absolutePath : null;
}

async function resolveFile(absolutePath) {
  if (!absolutePath || !existsSync(absolutePath)) {
    return null;
  }

  const stats = statSync(absolutePath);
  if (stats.isDirectory()) {
    const indexPath = path.join(absolutePath, "index.html");
    return existsSync(indexPath) ? indexPath : null;
  }

  return absolutePath;
}

function openBrowser(targetUrl) {
  if (process.platform === "win32") {
    exec(`start "" "${targetUrl}"`);
    return;
  }

  if (process.platform === "darwin") {
    exec(`open "${targetUrl}"`);
    return;
  }

  exec(`xdg-open "${targetUrl}"`);
}

const server = http.createServer(async (request, response) => {
  try {
    const requestPath = toFilePath(request.url ?? "/");
    const filePath = await resolveFile(requestPath);

    if (!filePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(extension) ?? "application/octet-stream";
    const fileStats = await fs.stat(filePath);

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": fileStats.size,
      "Content-Type": contentType
    });

    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  const targetUrl = `http://127.0.0.1:${port}`;
  console.log(`Serving ${rootDir} at ${targetUrl}`);
  if (shouldOpen) {
    openBrowser(targetUrl);
  }
});
