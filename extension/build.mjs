// dist/ 에 압축 해제 상태로 불러올 수 있는 확장을 만든다.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// 모델은 비공개 학습 저장소에서 만들어 이 폴더에 넣는다 (vocab.txt, emotionless.json, onnx/model_quantized.onnx).
const MODEL_SRC = new URL("./models/student/", import.meta.url).pathname;
const ORT_SRC = new URL("./node_modules/onnxruntime-web/dist/", import.meta.url).pathname;
const OUT = new URL("./dist/", import.meta.url).pathname;

if (!existsSync(`${MODEL_SRC}onnx/model_quantized.onnx`)) {
  throw new Error(`모델 파일이 없습니다: ${MODEL_SRC}onnx/model_quantized.onnx`);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}models/student/onnx`, { recursive: true });
await mkdir(`${OUT}ort`, { recursive: true });

// 피드백 서버 주소. config.json 에 적어 두고, 시험할 때는 환경 변수로 바꿔 넣는다.
// 비어 있으면 서버와 통신하는 기능(수정 내용 보내기, 공유 묶음 받기)이 꺼진다.
const config = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
const apiBase = (process.env.EMOTIONLESS_API ?? config.apiBase ?? "").replace(/\/+$/, "");
console.log(`피드백 서버: ${apiBase || "(없음)"}`);

const common = {
  bundle: true,
  target: "chrome120",
  logLevel: "info",
  legalComments: "none",
  define: { __API_BASE__: JSON.stringify(apiBase) },
};
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

// 스토어 정책상 원격 코드를 불러올 여지가 없어야 한다. 번들에 외부 스크립트 주소가 섞여 있지 않은지 확인한다.
for (const file of ["offscreen.js", "content.js", "background.js", "popup.js"]) {
  const code = await readFile(`${OUT}${file}`, "utf8");
  const remote = code.match(/https?:\/\/[^"'`\s]*\.(?:m?js|wasm)\b/);
  if (remote) throw new Error(`${file} 에 외부 스크립트 주소가 있습니다: ${remote[0]}`);
}

await cp("static", OUT, { recursive: true });
await cp("THIRD_PARTY_NOTICES.md", `${OUT}THIRD_PARTY_NOTICES.md`);
for (const file of ["vocab.txt", "emotionless.json", "onnx/model_quantized.onnx"]) {
  await cp(`${MODEL_SRC}${file}`, `${OUT}models/student/${file}`);
}
for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await cp(`${ORT_SRC}${file}`, `${OUT}ort/${file}`);
}
console.log(`빌드 완료: ${OUT}`);
