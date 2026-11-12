// 페이지가 처음 그려질 때부터 댓글을 흐리게 해 두는 장치.
// 댓글 위치는 사이트마다 다르므로, 한 번 처리한 사이트에서 댓글 본문의 위치(CSS 선택자)를 기억해 두었다가
// 다음 방문 때 페이지를 읽기 시작하자마자 스타일로 흐리게 한다. 스크립트가 댓글을 찾기 전에도 원문이 보이지 않는다.
// 처리가 끝나면 그 요소에는 표시가 붙어 흐림이 풀린다. 확장이 멈춰도 몇 초 뒤에는 스스로 풀린다.

const STYLE_ID = "eml-prehide";
// 처리되지 않더라도 이 시간이 지나면 흐림을 푼다 (확장이 멈추거나, 기억한 위치가 댓글이 아닌 경우를 대비).
const REVEAL_AFTER_S = 3;
const MAX_SELECTORS = 4;

// 처리를 마쳤거나(순화본으로 바꿈, 그대로 꾸밈, 숨김) 처리할 필요가 없는 요소
const SETTLED = ":not([data-eml-done]):not([data-eml-inplace]):not([data-eml-hidden]):not([data-eml-gone]):not(.eml-view)";

function isValid(selector) {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** 기억해 둔 위치들로 흐림 스타일을 건다. 이미 걸려 있으면 바꾼다. */
export function installPrehide(selectors) {
  const valid = selectors.filter(isValid).slice(0, MAX_SELECTORS);
  let style = document.getElementById(STYLE_ID);
  if (!valid.length) {
    style?.remove();
    return [];
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head ?? document.documentElement).append(style);
  }
  style.textContent = `
:is(${valid.join(", ")})${SETTLED} {
  filter: blur(5px);
  animation: eml-reveal 0s linear ${REVEAL_AFTER_S}s forwards;
}
@keyframes eml-reveal { to { filter: none; } }`;
  return valid;
}

export function removePrehide() {
  document.getElementById(STYLE_ID)?.remove();
}

/** 흐리게 걸어 둔 위치에 해당하지만 댓글이 아니었던 요소의 흐림을 바로 푼다. */
export function settleOthers(selectors, isTracked) {
  if (!selectors.length) return;
  let matches;
  try {
    matches = document.querySelectorAll(selectors.join(","));
  } catch {
    return;
  }
  for (const el of matches) if (!isTracked(el)) el.setAttribute("data-eml-done", "");
}

const keyOf = (el) => {
  const tag = el.tagName.toLowerCase();
  if (tag.includes("-") && el.id) return `${tag}#${CSS.escape(el.id)}`;
  if (el.classList[0]) return `${tag}.${CSS.escape(el.classList[0])}`;
  if (el.id) return `${tag}#${CSS.escape(el.id)}`;
  return null;
};

/** 댓글 본문 요소 하나를 가리키는 선택자. 본문 요소에 이름이 없으면 댓글 항목을 붙여 좁힌다. */
export function selectorFor(item, textEl) {
  const own = keyOf(textEl);
  if (own && (textEl.classList[0] || textEl.id)) return own;
  const parent = keyOf(item);
  return parent ? `${parent} ${textEl.tagName.toLowerCase()}` : null;
}

/** 이 페이지에서 처리한 댓글들로 기억할 위치를 고른다. 댓글 두 개 이상에 들어맞는 것만, 많이 쓰인 순서로. */
export function learnSelectors(pairs) {
  const counts = new Map();
  for (const { item, textEl } of pairs) {
    const selector = selectorFor(item, textEl);
    if (selector) counts.set(selector, (counts.get(selector) ?? 0) + 1);
  }
  return [...counts]
    .filter(([selector, count]) => count >= 2 && isValid(selector))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SELECTORS)
    .map(([selector]) => selector);
}
