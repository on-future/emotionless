// 오프스크린 문서: 확장에 포함된 KOTE 모델로 감정을 분류한다. 외부로 나가는 요청이 없다.
import { pipeline, env } from "@huggingface/transformers";
import { classify, toVector } from "./shared/emotion.js";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL("models/");
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/");
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let classifier = null;
const getClassifier = () => (classifier ??= pipeline("text-classification", "kote", { dtype: "q8", device: "wasm" }));

// 요청이 겹치지 않도록 한 줄로 세운다.
let queue = Promise.resolve();

async function run(texts) {
  const clf = await getClassifier();
  const started = performance.now();
  // 한 문장씩 돌린다. 묶어서 돌리면 가장 긴 문장 길이에 맞춰 채우느라 오히려 느리다.
  // 감정 그룹과 함께 44개 점수도 돌려준다. 사용자가 고친 사례와 견주는 데 쓴다.
  const results = [];
  for (const text of texts) {
    const labels = await clf(text, { top_k: null });
    const scores = Object.fromEntries(labels.map((l) => [l.label, l.score]));
    results.push({ group: classify(scores), v: toVector(scores) });
  }
  return { results, ms: Math.round(performance.now() - started), threads: env.backends.onnx.wasm.numThreads };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "classify") return false;
  queue = queue
    .then(() => run(msg.texts))
    .then(sendResponse, (err) => sendResponse({ error: String(err?.message ?? err) }));
  return true;
});
