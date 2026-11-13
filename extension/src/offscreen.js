// 오프스크린 문서: 확장에 포함된 작은 모델로 댓글을 판정한다. 댓글은 밖으로 나가지 않는다.
// 모델 한 번으로 두 가지를 낸다: 감정 44개(문장마다), 토큰마다 남김·지움·바꿀 말.
// 서버에서 받아 검증해 둔 개선 모델이 있으면 그것을 쓰고, 없거나 문제가 있으면 확장에 든 기본 모델을 쓴다.
import * as ort from "onnxruntime-web/wasm";
import { classify, toVector, LABELS } from "./shared/emotion.js";
import { createTokenizer } from "./shared/wordpiece.js";
import { compatibleMeta, dropStoredModel, loadStoredModel, sha256Hex } from "./shared/model-store.js";
import { editSpans } from "./shared/edits.js";

const MODEL_DIR = chrome.runtime.getURL("models/student/");
const MAX_TOKENS = 128;

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
// 여러 스레드는 페이지가 격리된 경우에만 쓸 수 있다. 코어가 적은 기기를 고려해 최대 4개까지만 쓴다.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;

let ready = null;

async function createSession(source) {
  return ort.InferenceSession.create(source, { executionProviders: ["wasm"] });
}

async function load() {
  const [vocab, bundledMeta] = await Promise.all([
    fetch(`${MODEL_DIR}vocab.txt`).then((r) => r.text()),
    fetch(`${MODEL_DIR}emotionless.json`).then((r) => r.json()),
  ]);
  // 모델의 감정 라벨 순서가 확장의 순서와 같은지 확인한다 (다르면 감정이 엉뚱하게 붙는다).
  if (JSON.stringify(bundledMeta.labels) !== JSON.stringify(LABELS)) throw new Error("모델의 감정 라벨 순서가 확장과 다릅니다");
  const tokenizer = createTokenizer(vocab);
  const vocabSha256 = await sha256Hex(new TextEncoder().encode(vocab));

  const stored = await loadStoredModel();
  const bundledVersion = bundledMeta.version ?? 1;
  if (stored && stored.version > bundledVersion && compatibleMeta(stored.meta, { labels: LABELS, vocabSha256 })) {
    try {
      const session = await createSession(stored.bytes);
      return { tokenizer, session, tags: stored.meta.tags, version: stored.version };
    } catch {
      // 받은 모델을 열 수 없으면 버리고 기본 모델로 돌아간다. 다음 확인 때 다시 받는다.
      await dropStoredModel();
    }
  }
  const session = await createSession(`${MODEL_DIR}onnx/model_quantized.onnx`);
  return { tokenizer, session, tags: bundledMeta.tags ?? ["keep", "delete"], version: bundledVersion };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// 요청이 겹치지 않도록 한 줄로 세운다.
let queue = Promise.resolve();

// 같은 글은 다시 계산하지 않는다. 이 문서는 탭이 바뀌어도 살아 있으므로 다른 페이지·다시 방문에도 쓰인다.
const CACHE_LIMIT = 5000;
const cache = new Map();
function remember(text, result) {
  cache.delete(text);
  cache.set(text, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function run(texts) {
  ready ??= load();
  const { tokenizer, session, tags, version } = await ready;
  const started = performance.now();
  // 한 문장씩 돌린다. 묶으면 가장 긴 문장 길이에 맞춰 채우느라 짧은 댓글이 많을 때 오히려 느리다.
  const results = [];
  for (const text of texts) {
    const known = cache.get(text);
    if (known) {
      results.push(known);
      continue;
    }
    const { ids, offsets } = tokenizer.encode(text, MAX_TOKENS);
    const shape = [1, ids.length];
    const output = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
      token_type_ids: new ort.Tensor("int64", new BigInt64Array(ids.length), shape),
    });
    const emotion = output.emotion.data;
    const scores = Object.fromEntries(LABELS.map((label, i) => [label, sigmoid(emotion[i])]));
    const { del, rep } = editSpans(offsets, output.tags.data, tags);
    const result = { group: classify(scores), v: toVector(scores), del, rep };
    remember(text, result);
    results.push(result);
  }
  return { results, ms: Math.round(performance.now() - started), threads: ort.env.wasm.numThreads, model: version };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return false;
  if (msg.type === "warm") {
    ready ??= load();
    ready.catch(() => (ready = null));
    return false;
  }
  // 새 모델을 받았으면 다음 요청부터 그 모델로 판정한다. 예전 모델의 결과는 버린다.
  if (msg.type === "reload-model") {
    queue = queue.then(() => {
      ready = null;
      cache.clear();
    });
    return false;
  }
  if (msg.type !== "classify") return false;
  queue = queue
    .then(() => run(msg.texts))
    .then(sendResponse, (err) => {
      // 불러오기에 실패했으면 다음 요청 때 다시 시도한다.
      ready = null;
      sendResponse({ error: String(err?.message ?? err) });
    });
  return true;
});
