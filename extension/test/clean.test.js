import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, tidy } from "../src/shared/clean.js";

const spansOf = (text, ...parts) => parts.map((p) => [text.indexOf(p), text.indexOf(p) + p.length]);

test("cleanText: 모델이 고른 부분을 지운다", () => {
  const text = "오리지널 팬들도 손절하는마당이라 파이이동만 의심되는 기적의 엔씨";
  assert.equal(cleanText(text, spansOf(text, "기적의 ")), "오리지널 팬들도 손절하는마당이라 파이이동만 의심되는 엔씨");
});

test("cleanText: 낱말 중간에서 자르지 않는다", () => {
  const text = "내놓은 거냐? 개발자들 제정신임?? 렉 때문에";
  // 모델이 "들 제정신임??" 만 골라도 "개발자들"은 통째로 남는다 (4글자 중 1글자만 지움)
  assert.equal(cleanText(text, spansOf(text, "들 제정신임??")), "내놓은 거냐? 개발자들 렉 때문에");
  // 낱말 글자의 절반 이상을 지웠으면 낱말 전체를 지운다
  const other = "이건 개쓰레기 패치";
  assert.equal(cleanText(other, spansOf(other, "개쓰레")), "이건 패치");
  // 낱말에 붙은 ㅋㅋ·문장 부호는 글자 단위로 지운다
  const glued = "다시는 안 산다!!!";
  assert.equal(cleanText(glued, spansOf(glued, "!!!")), "다시는 안 산다");
});

test("cleanText: 모델이 놓쳐도 욕설·ㅋㅋ·이모지는 지운다", () => {
  assert.equal(cleanText("살좀 빠졌니 ㅋㅋㅋ !"), "살좀 빠졌니!");
  assert.equal(cleanText("이건 좀 병신같은 패치임 😡"), "이건 좀 패치임");
});

test("cleanText: 주소와 남기라고 한 표현은 지우지 않는다", () => {
  const text = "진짜 사나이 재방송 https://example.com/a?b=1 대박";
  const spans = spansOf(text, "진짜 ", "example", " 대박");
  assert.equal(cleanText(text, spans, { keep: ["진짜 사나이"] }), "진짜 사나이 재방송 https://example.com/a?b=1");
});

test("cleanText: 사용자가 지우라고 한 표현을 더 지운다", () => {
  assert.equal(cleanText("이 게임 갓겜임 인정", [], { remove: ["갓겜임"] }), "이 게임 인정");
});

test("cleanText: 감정 표현뿐인 글은 빈 문자열이 된다", () => {
  const text = "헐 대박!!!";
  assert.equal(cleanText(text, spansOf(text, "헐 대박")), "");
  assert.equal(cleanText("ㅋㅋㅋㅋ"), "");
});

test("tidy: 공백과 반복된 문장 부호를 정리한다", () => {
  assert.equal(tidy("  이번엔   실망 ..  알이 작아요 !!!  "), "이번엔 실망. 알이 작아요!");
  assert.equal(tidy(", . 남은 글"), "남은 글");
  assert.equal(tidy("소수점 3.5점은 그대로"), "소수점 3.5점은 그대로");
});
