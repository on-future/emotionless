// KOTE 44개 감정 라벨 점수를 화면에 쓰는 감정 그룹 하나로 묶는다.
// 기준값은 샘플 13문장으로 잡은 초기값이다.

export const GROUPS = {
  anger: { emoji: "😡", label: "분노", fold: true },
  blame: { emoji: "🙄", label: "비난", fold: true },
  complaint: { emoji: "😤", label: "불만", fold: false },
  positive: { emoji: "😀", label: "긍정", fold: false },
  sad: { emoji: "😢", label: "슬픔", fold: false },
  fear: { emoji: "😨", label: "불안", fold: false },
  surprise: { emoji: "😮", label: "놀람", fold: false },
  neutral: { emoji: "😐", label: "중립", fold: false },
};

// 분류 모델이 내는 44개 감정 라벨 (모델의 출력 순서 그대로)
export const LABELS = [
  "불평/불만", "환영/호의", "감동/감탄", "지긋지긋", "고마움", "슬픔", "화남/분노", "존경", "기대감",
  "우쭐댐/무시함", "안타까움/실망", "비장함", "의심/불신", "뿌듯함", "편안/쾌적", "신기함/관심", "아껴주는",
  "부끄러움", "공포/무서움", "절망", "한심함", "역겨움/징그러움", "짜증", "어이없음", "없음", "패배/자기혐오",
  "귀찮음", "힘듦/지침", "즐거움/신남", "깨달음", "죄책감", "증오/혐오", "흐뭇함(귀여움/예쁨)", "당황/난처",
  "경악", "부담/안_내킴", "서러움", "재미없음", "불쌍함/연민", "놀람", "행복", "불안/걱정", "기쁨", "안심/신뢰",
];

/** 라벨별 점수를 LABELS 순서의 0~100 정수 배열로 바꾼다. 저장하고 서로 견주기 위한 형태다. */
export const toVector = (scores) => LABELS.map((label) => Math.round((scores[label] ?? 0) * 100));

// 감정을 늘어놓는 기본 순서 (개수가 같을 때의 순서)
export const GROUP_ORDER = ["complaint", "anger", "blame", "sad", "fear", "surprise", "positive", "neutral"];

/**
 * 댓글이 있는 감정을 많은 순서로 늘어놓는다. 개수가 같으면 GROUP_ORDER 순서를 따른다.
 * 맨 앞만 봐도 어떤 반응이 많은지 알 수 있게 하려는 것이다.
 * @param {Record<string, number>} counts
 * @returns {string[]}
 */
export function rankGroups(counts) {
  return GROUP_ORDER.filter((group) => counts[group] > 0).sort((a, b) => counts[b] - counts[a]);
}

const SOFT = {
  positive: [
    "환영/호의", "감동/감탄", "고마움", "존경", "기대감", "뿌듯함", "편안/쾌적", "아껴주는",
    "즐거움/신남", "흐뭇함(귀여움/예쁨)", "행복", "기쁨", "안심/신뢰",
  ],
  sad: ["슬픔", "절망", "서러움", "힘듦/지침", "불쌍함/연민", "패배/자기혐오"],
  fear: ["공포/무서움", "불안/걱정"],
  surprise: ["놀람", "경악", "신기함/관심"],
};

const max = (scores, labels) => Math.max(0, ...labels.map((l) => scores[l] ?? 0));

export function classify(scores) {
  const s = (label) => scores[label] ?? 0;
  if (s("없음") >= 0.6) return "neutral";

  const anger = s("화남/분노");
  const hate = s("증오/혐오");
  // 깎아내림: 한심해하면서 혐오가 섞인 글
  if (s("한심함") >= 0.8 && hate >= 0.6) return "blame";
  // 강한 분노: 화와 어이없음이 함께 높거나, 화와 혐오가 함께 높은 글
  if (anger >= 0.9 && (s("어이없음") >= 0.88 || hate >= 0.75)) return "anger";
  if (Math.max(s("불평/불만"), s("짜증"), anger) >= 0.7) return "complaint";

  let best = "neutral";
  let bestScore = 0.6;
  for (const [group, labels] of Object.entries(SOFT)) {
    const score = max(scores, labels);
    if (score > bestScore) {
      best = group;
      bestScore = score;
    }
  }
  return best;
}
