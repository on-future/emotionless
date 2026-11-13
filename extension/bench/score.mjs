// 확장과 같은 토크나이저·모델로 문장을 판정해 본다. 판정 기준을 손볼 때 쓴다.
// onnxruntime-node 는 개발용 의존성(@huggingface/transformers)에 딸려 설치된다.
// 사용: node bench/score.mjs "문장1" "문장2" ...   (인자가 없으면 표준 입력에서 한 줄에 한 문장)
import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-node";
import { classify, LABELS } from "../src/shared/emotion.js";
import { createTokenizer } from "../src/shared/wordpiece.js";

const DIR = new URL("../models/student/", import.meta.url);
const tokenizer = createTokenizer(readFileSync(new URL("vocab.txt", DIR), "utf8"));
const session = await ort.InferenceSession.create(new URL("onnx/model_quantized.onnx", DIR).pathname);
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** @returns {Promise<Record<string, number>>} 라벨별 점수 */
export async function scoreText(text) {
  const { ids } = tokenizer.encode(text, 128);
  const shape = [1, ids.length];
  const out = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
    attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
    token_type_ids: new ort.Tensor("int64", new BigInt64Array(ids.length), shape),
  });
  return Object.fromEntries(LABELS.map((label, i) => [label, sigmoid(out.emotion.data[i])]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const texts = process.argv.length > 2 ? process.argv.slice(2) : readFileSync(0, "utf8").split("\n").filter(Boolean);
  for (const text of texts) {
    const scores = await scoreText(text);
    const top = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, v]) => `${label} ${v.toFixed(2)}`)
      .join(", ");
    console.log(`${classify(scores).padEnd(9)} ${text.slice(0, 50)}\n          ${top}`);
  }
}
