// KOTE 전체 라벨 점수를 fixtures 로 저장한다 (라벨 묶음 기준 조정용).
import { pipeline, env } from "@huggingface/transformers";
import { writeFileSync } from "node:fs";
import { SAMPLES } from "../model-eval/samples.js";
env.localModelPath = new URL("../../extension/models/", import.meta.url).pathname;
env.allowRemoteModels = false;
const clf = await pipeline("text-classification", "kote", { dtype: "q8" });
const out = [];
for (const s of SAMPLES) {
  const all = await clf(s.text, { top_k: null });
  out.push({ id: s.id, kind: s.kind, text: s.text, scores: Object.fromEntries(all.map((r) => [r.label, +r.score.toFixed(3)])) });
}
writeFileSync(new URL("./kote-scores.json", import.meta.url), JSON.stringify(out, null, 1));
for (const o of out) console.log(o.id, Object.entries(o.scores).filter(([, v]) => v >= 0.4).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", "));
