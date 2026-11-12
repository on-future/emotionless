import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createTokenizer } from "../src/shared/wordpiece.js";

const VOCAB = new URL("../models/student/vocab.txt", import.meta.url);

test("wordpiece: 원본 토크나이저와 같은 토큰을 낸다", { skip: !existsSync(VOCAB) && "모델 파일이 없음" }, () => {
  const tokenizer = createTokenizer(readFileSync(VOCAB, "utf8"));
  const rows = JSON.parse(readFileSync(new URL("./fixtures/tokenizer-parity.json", import.meta.url)));
  const mismatches = rows.filter((row) => JSON.stringify(tokenizer.encode(row.text).ids) !== JSON.stringify(row.ids));
  assert.equal(mismatches.length, 0, mismatches.slice(0, 3).map((m) => m.text).join(" / "));
});

test("wordpiece: 토큰마다 원문의 자리를 돌려준다", { skip: !existsSync(VOCAB) && "모델 파일이 없음" }, () => {
  const tokenizer = createTokenizer(readFileSync(VOCAB, "utf8"));
  const text = "와 배송 2주 걸렸는데ㅋㅋㅋ 😀 최악!!";
  const { ids, offsets } = tokenizer.encode(text);
  assert.equal(ids.length, offsets.length);
  assert.deepEqual(offsets[0], [0, 0]);
  assert.deepEqual(offsets.at(-1), [0, 0]);
  const middle = offsets.slice(1, -1);
  // 자리는 앞에서 뒤로 겹치지 않게 이어지고, 이어 붙이면 공백을 뺀 원문이 된다.
  for (let i = 1; i < middle.length; i++) assert.ok(middle[i][0] >= middle[i - 1][1]);
  assert.equal(middle.map(([s, e]) => text.slice(s, e)).join(""), text.replace(/\s/g, ""));
});
