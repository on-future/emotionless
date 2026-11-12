// 사용자가 고쳐 준 판정을 다음 판정에 반영한다.
// 분류 모델이 낸 44개 점수가 비슷한 댓글은 같은 감정일 가능성이 높으므로,
// 고친 사례와 점수가 가까운 댓글은 그 사례의 감정을 따른다. 모델을 다시 학습하지 않아 바로 적용된다.

// 점수는 0~100 정수로 저장한다. 이 거리 안에 든 사례만 참고한다
// (같은 성격의 댓글끼리는 대체로 30~80, 긍정과 부정처럼 다른 댓글은 190 이상 떨어져 있다).
export const RADIUS = 50;
// 사례 하나만 있어도 따른다. 공유 묶음의 사례는 서버에서 이미 여러 사람이 같은 의견을 낸 것만 추린 것이다.
// 내가 직접 고친 것과 공유 사례가 엇갈리면 내 것을 따르도록 내 사례에 더 무게를 둔다.
export const OWN_WEIGHT = 3;
export const SHARED_WEIGHT = 2;
const MIN_WEIGHT = 2;
const MIN_SHARE = 0.6;

/** 댓글을 가리키는 열쇠. 공백 차이는 무시하고, 아주 긴 글은 앞부분만 쓴다. */
export const textKey = (text) => text.replace(/\s+/g, " ").trim().slice(0, 300);

export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/**
 * 가까운 사례들이 가리키는 감정. 참고할 사례가 부족하거나 의견이 갈리면 null.
 * @param {number[]} vector 이 댓글의 점수 (0~100 정수 44개)
 * @param {{v: number[], g: string, w: number}[]} examples 고친 사례
 */
export function learnedGroup(vector, examples, radius = RADIUS) {
  const votes = {};
  let total = 0;
  for (const example of examples) {
    if (example.v.length !== vector.length || distance(vector, example.v) > radius) continue;
    votes[example.g] = (votes[example.g] ?? 0) + example.w;
    total += example.w;
  }
  if (total < MIN_WEIGHT) return null;
  const [group, weight] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return weight / total >= MIN_SHARE ? group : null;
}

/** 내 수정 목록에 하나를 더한다. 같은 글을 다시 고치면 바꿔 넣고, 너무 많아지면 오래된 것부터 버린다. */
export function addFix(fixes, fix, limit = 500) {
  const rest = fixes.filter((f) => f.t !== fix.t);
  return [...rest, fix].slice(-limit);
}
