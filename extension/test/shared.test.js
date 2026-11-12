import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strip, isUnchanged, hasProfanity } from "../src/shared/strip.js";
import { classify } from "../src/shared/emotion.js";

test("strip: 욕설·ㅋㅋ·강조어를 지우고 사실은 남긴다", () => {
  assert.equal(
    strip("와 배송 2주 걸렸는데 박스는 다 찌그러져서 옴ㅋㅋㅋ 다시는 여기서 안 산다 진짜 최악"),
    "배송 2주 걸렸는데 박스는 다 찌그러져서 옴. 다시는 여기서 안 산다.",
  );
  assert.equal(
    strip("헐 대박 드디어 나왔다!!! 3년 기다렸는데 눈물남ㅠㅠㅠ 12월 5일 발매래 다들 예약 고고"),
    "드디어 나왔다. 3년 기다렸는데. 12월 5일 발매래 다들 예약 고고.",
  );
  assert.equal(
    strip("이딴 걸 3만원 받고 팔아? 양심 어디갔냐 ㅅㅂ 양은 쥐꼬리만하고 다 식어서 왔음"),
    "이런 걸 3만원 받고 팔아? 양심 어디갔냐. 양은 쥐꼬리만하고 다 식어서 왔음.",
  );
});

test("strip: 서술어는 지우지 않는다", () => {
  assert.equal(
    strip("미쳤다 이 집 국물 진짜 미쳤음... 인생 라멘 등극ㅠㅠ 사장님 제발 망하지 마세요"),
    "이 집 국물 미쳤음. 인생 라멘 등극. 사장님 망하지 마세요.",
  );
  assert.equal(
    strip("제발 좀!!! 층간소음 때문에 미쳐버릴 것 같아요. 새벽 2시에 쿵쿵거리는 게 말이 됩니까?"),
    "층간소음 때문에 미쳐버릴 것 같아요. 새벽 2시에 쿵쿵거리는 게 말이 됩니까?",
  );
});

test("strip: 중립 문장은 그대로 둔다", () => {
  for (const text of [
    "이번 패치로 로딩 시간이 30초에서 10초로 줄었습니다. 다만 일부 기기에서 튕김 현상이 보고되고 있습니다.",
    "내일 오후 3시에 회의실 B에서 주간 회의가 있습니다",
  ]) {
    assert.ok(isUnchanged(text, strip(text)), strip(text));
  }
});

test("strip: 감정 표현뿐인 글은 빈 문자열이 된다", () => {
  assert.equal(strip("ㅋㅋㅋㅋㅋㅋ"), "");
  assert.equal(strip("헐 대박!!!"), "");
});

test("strip: 욕설에 붙은 말까지 지워 조각을 남기지 않는다", () => {
  assert.equal(strip("병신년 ㅋ"), "");
  assert.equal(strip("저 병신같은 운영 때문에 접는다"), "저 운영 때문에 접는다.");
});

test("hasProfanity: 욕설과 초성 욕을 찾는다", () => {
  assert.equal(hasProfanity("병신년 ㅋ"), true);
  assert.equal(hasProfanity("ㅅㅂ 또 점검이네"), true);
  assert.equal(hasProfanity("이번 패치는 괜찮은 것 같습니다"), false);
});

test("strip: 단어 일부로 쓰인 말은 지우지 않는다", () => {
  assert.equal(strip("아니라고 생각합니다"), "아니라고 생각합니다.");
  assert.equal(strip("참여 신청은 내일까지입니다"), "참여 신청은 내일까지입니다.");
});

test("classify: 샘플 문장의 KOTE 점수를 기대한 그룹으로 묶는다", () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/kote-scores.json", import.meta.url)));
  const expected = {
    "anger-update": "anger",
    "anger-delivery": "complaint",
    "news-clickbait": "anger",
    "sarcasm-tax": "blame",
    "positive-ramen": "positive",
    "profanity-food": "anger",
    "noise-complaint": "complaint",
    "neutral-patch": "neutral",
    "sports-opinion": "complaint",
    "pure-insult": "blame",
    "refund-request": "complaint",
    "neutral-meeting": "neutral",
    "excited-release": "positive",
  };
  const actual = Object.fromEntries(fixtures.map((f) => [f.id, classify(f.scores)]));
  assert.deepEqual(actual, expected);
});

test("classify: 점수가 전부 낮으면 중립", () => {
  assert.equal(classify({ "놀람": 0.3, "기쁨": 0.2 }), "neutral");
  assert.equal(classify({}), "neutral");
});
