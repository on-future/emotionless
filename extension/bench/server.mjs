// 속도 측정용 서버. 여러 스레드를 쓰려면 페이지가 격리 상태여야 해서 관련 헤더를 붙여 준다.
// 사용: node bench/server.mjs  (extension 폴더에서)
import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT || 5187);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".onnx": "application/octet-stream" };

createServer(async (req, res) => {
  const headers = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "same-origin" };
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/result") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await appendFile(join(ROOT, "bench/results.jsonl"), Buffer.concat(chunks).toString("utf8") + "\n");
      res.writeHead(204, headers).end();
      return;
    }
    const file = normalize(join(ROOT, decodeURIComponent(url.pathname.slice(1))));
    if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return res.writeHead(403, headers).end();
    // 파일을 먼저 읽은 뒤에 응답을 시작한다 (없는 파일이면 아래에서 404 로 답한다).
    const body = await readFile(file);
    res.writeHead(200, { ...headers, "content-type": MIME[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, headers).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}/bench/bench.html`));
