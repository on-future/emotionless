// 모델이 토큰마다 고른 값(남김·지움·바꿀 말)을 글자 자리로 모은다.

// 남김이 아닐 확률이 이보다 높은 토큰을 지우거나 바꾼다.
const EDIT_THRESHOLD = 0.5;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * 토큰마다 고른 값을 지울 자리와 바꿀 자리로 모은다.
 * logits 는 토큰마다 tags 길이만큼의 값이다: [남김, 지움, 바꿀 말 1, 바꿀 말 2, ...]
 * 바꿀 말이 붙은 토큰부터 바로 이어지는 지움 토큰까지를 한 자리로 보고 그 말로 바꾼다.
 * @returns {{del: [number, number][], rep: [number, number, string][]}}
 */
export function editSpans(offsets, logits, tags) {
  const width = tags.length;
  const del = [];
  const rep = [];
  let open = null; // 지금 이어 붙이는 자리: { list, span }
  for (let t = 0; t < offsets.length; t++) {
    const [start, end] = offsets[t];
    if (end <= start) continue;
    const row = logits.subarray(t * width, (t + 1) * width);
    let tag = 0;
    if (width === 2) {
      tag = sigmoid(row[1] - row[0]) >= EDIT_THRESHOLD ? 1 : 0;
    } else {
      // 소프트맥스: 남김이 아닐 확률이 기준을 넘으면, 남김이 아닌 것 가운데 가장 높은 것을 고른다.
      const top = Math.max(...row);
      const exp = Array.from(row, (v) => Math.exp(v - top));
      const sum = exp.reduce((a, b) => a + b, 0);
      if (1 - exp[0] / sum >= EDIT_THRESHOLD) {
        tag = 1;
        for (let k = 2; k < width; k++) if (exp[k] > exp[tag]) tag = k;
      }
    }
    if (tag === 0) {
      open = null;
      continue;
    }
    const touching = open && start - open.span[1] <= 1;
    if (tag === 1) {
      // 지움은 앞의 자리(지움이든 바꿈이든)에 이어 붙인다.
      if (touching) open.span[1] = end;
      else {
        const span = [start, end];
        del.push(span);
        open = { list: del, span };
      }
      continue;
    }
    const to = tags[tag];
    // 같은 말로 바꾸라는 토큰이 이어지면(낱말 하나가 여러 토큰인 경우) 한 자리로 본다.
    if (touching && open.list === rep && open.span[2] === to) {
      open.span[1] = end;
      continue;
    }
    const span = [start, end, to];
    rep.push(span);
    open = { list: rep, span };
  }
  return { del, rep };
}

