// 두 머리(감정 + 지움/남김) 작은 모델의 속도 측정. ?threads=1&batch=1
import { AutoTokenizer, env } from "@huggingface/transformers";
import * as ort from "onnxruntime-web/wasm";

const params = new URLSearchParams(location.search);
const threads = Number(params.get("threads") ?? 1);
const batchSize = Number(params.get("batch") ?? 1);
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${location.origin}/models/`;
ort.env.wasm.wasmPaths = `${location.origin}/node_modules/onnxruntime-web/dist/`;
ort.env.wasm.numThreads = threads;

const TEXTS = [
  "살좀 빠졌니 ㅋㅋㅋ !",
  "내일 오후 3시에 회의실 B에서 주간 회의가 있습니다.",
  "와~~안개 대박 넘어지신데는 괜찮아요?",
  "미쳤다 이번 OST 진짜 미쳤음... 작곡가님 제발 계속 해주세요ㅠㅠ",
  "와 배송 2주 걸렸는데 박스는 다 찌그러져서 옴ㅋㅋㅋ 다시는 여기서 안 산다 진짜 최악",
  "아니 진짜 이걸 지금 업데이트라고 내놓은 거냐? 개발자들 제정신임?? 렉 때문에 게임을 할 수가 없는데 ㅋㅋㅋ",
  "이번 패치로 로딩 시간이 30초에서 10초로 줄었습니다. 다만 일부 기기에서 튕김 현상이 보고되고 있습니다.",
  "환불 요청한 지 열흘이 지났는데 아직도 답변이 없습니다. 고객센터 전화는 연결도 안 되고요. 정말 너무 화가 나고 실망스럽습니다. 당장 처리해 주세요.",
  "솔직히 이 선수 연봉 값 못하는 거 팩트 아님? 올 시즌 타율 2할 1푼인데 감독은 왜 계속 쓰는지 이해가 안 됨. 답답해 죽겠네",
  "경찰 국과수 못믿는다 그알에서 밝혀달라 이제는 그알도 매수 당했다 유튜버만 믿는다???? 유튜버가 제일 파렴치한데? 쟤들 사건 과정 동기 범인 이딴거 중요치도 않음 구독자 늘리고 후원금 받고 광고조회수 팍팍 늘리면 그만인 애들인데ㅋㅋㅋㅋ",
];

const out = document.getElementById("out");
try {
  const t0 = performance.now();
  const tokenizer = await AutoTokenizer.from_pretrained("student");
  const session = await ort.InferenceSession.create(`${location.origin}/models/student/onnx/model_quantized.onnx`, { executionProviders: ["wasm"] });
  const loadMs = performance.now() - t0;
  const run = async (texts) => {
    const enc = tokenizer(texts, { padding: true, truncation: true, max_length: 128 });
    const feeds = {};
    for (const name of ["input_ids", "attention_mask", "token_type_ids"]) {
      feeds[name] = new ort.Tensor("int64", enc[name].data, enc[name].dims);
    }
    return session.run(feeds);
  };
  for (let i = 0; i < 3; i++) await run([TEXTS[i]]);
  const times = [];
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < TEXTS.length; i += batchSize) {
      const batch = TEXTS.slice(i, i + batchSize);
      const t = performance.now();
      await run(batch);
      // 댓글 하나당 시간으로 환산한다
      const per = (performance.now() - t) / batch.length;
      for (const _ of batch) times.push(per);
    }
  }
  times.sort((a, b) => a - b);
  const at = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))];
  const result = { model: "student(2 heads)", threads, batch: batchSize, isolated: self.crossOriginIsolated, loadMs: Math.round(loadMs), median: +at(0.5).toFixed(1), p90: +at(0.9).toFixed(1), max: +times.at(-1).toFixed(1) };
  out.textContent = JSON.stringify(result);
  await fetch("/result", { method: "POST", body: JSON.stringify(result) });
} catch (err) {
  out.textContent = "오류: " + String(err?.stack ?? err).slice(0, 600);
}
document.title = "done";
