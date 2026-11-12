// dist/ 에 압축 해제 상태로 불러올 수 있는 확장을 만든다.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const MODEL_SRC = new URL("./models/kote/", import.meta.url).pathname;
const ORT_SRC = new URL("./node_modules/@huggingface/transformers/dist/", import.meta.url).pathname;
const OUT = new URL("./dist/", import.meta.url).pathname;

if (!existsSync(`${MODEL_SRC}onnx/model_quantized.onnx`)) {
  throw new Error(`모델 파일이 없습니다: ${MODEL_SRC}onnx/model_quantized.onnx\n먼저 scripts/prepare-model.sh 를 실행하세요.`);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}models/kote/onnx`, { recursive: true });
await mkdir(`${OUT}ort`, { recursive: true });

const common = { bundle: true, target: "chrome120", logLevel: "info", legalComments: "none" };
await Promise.all([
  build({ ...common, entryPoints: ["src/content/index.js"], outfile: `${OUT}content.js`, format: "iife" }),
  build({ ...common, entryPoints: ["src/popup.js"], outfile: `${OUT}popup.js`, format: "iife" }),
  build({ ...common, entryPoints: ["src/background.js"], outfile: `${OUT}background.js`, format: "esm" }),
  build({
    ...common,
    entryPoints: ["src/offscreen.js"],
    outfile: `${OUT}offscreen.js`,
    format: "esm",
    platform: "browser",
    minify: true,
  }),
]);

// 스토어 정책상 원격 코드를 불러올 여지가 없어야 한다. 라이브러리에 기본값으로 들어 있는
// CDN 주소(실제로는 쓰지 않음)를 번들에서 지운다.
const offscreenPath = `${OUT}offscreen.js`;
const bundled = await readFile(offscreenPath, "utf8");
const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@";
if (!bundled.includes(CDN)) throw new Error("번들에서 CDN 기본 주소를 찾지 못했습니다. 라이브러리 버전을 확인하세요.");
await writeFile(offscreenPath, bundled.replaceAll(CDN, "chrome-extension://invalid/"));

await cp("static", OUT, { recursive: true });
await cp("THIRD_PARTY_NOTICES.md", `${OUT}THIRD_PARTY_NOTICES.md`);
for (const file of ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]) {
  await cp(`${MODEL_SRC}${file}`, `${OUT}models/kote/${file}`);
}
await cp(`${MODEL_SRC}onnx/model_quantized.onnx`, `${OUT}models/kote/onnx/model_quantized.onnx`);
for (const file of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  await cp(`${ORT_SRC}${file}`, `${OUT}ort/${file}`);
}
console.log(`빌드 완료: ${OUT}`);
