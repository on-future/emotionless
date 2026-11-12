// 실험용 정적 서버. 페이지가 보내는 결과를 results.jsonl / status.json 에 기록한다.
import { createServer } from "node:http";
import { readFile, appendFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 5179);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/result") {
      await appendFile(join(ROOT, "results.jsonl"), (await readBody(req)) + "\n");
      res.writeHead(204).end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/status") {
      await writeFile(join(ROOT, "status.json"), await readBody(req));
      res.writeHead(204).end();
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}/`));
