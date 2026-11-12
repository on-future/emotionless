// 댓글 본문을 숨기고 그 자리에 이모티콘 + 순화본을 붙인다.
// 바뀐 내용이 없는 댓글은 원문 요소를 그대로 두고 속성 몇 개만 붙여 꾸민다.
import { GROUPS, rankGroups } from "../shared/emotion.js";
import { splitUrls } from "../shared/strip.js";

// 확장에 포함된 큼직한 이모티콘 그림. 그림을 못 불러오면 글자 이모티콘이 대신 보인다.
function emojiEl(group, className = "eml-emoji") {
  const info = GROUPS[group];
  const img = document.createElement("img");
  img.className = className;
  img.alt = info.emoji;
  img.title = info.label;
  img.draggable = false;
  try {
    img.src = chrome.runtime.getURL(`emoji/${group}.png`);
  } catch {}
  return img;
}

const TYPOGRAPHY = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color"];

// 원문에서 잘려 보이는 곳이 있는지 (줄 수 제한, 높이 고정 등)
function isClipped(textEl, item) {
  for (let cur = textEl; cur; cur = cur.parentElement) {
    if (cur.scrollHeight > cur.clientHeight + 1 && getComputedStyle(cur).overflowY !== "visible") return true;
    if (cur === item) break;
  }
  return false;
}

/**
 * 화면을 바꾸기 전에 원문 요소에서 필요한 값을 읽어 둔다.
 * 여러 댓글의 읽기를 먼저 끝내고 쓰기를 몰아서 하면 브라우저가 스타일을 반복 계산하지 않는다.
 */
export function measure(textEl, item) {
  const computed = getComputedStyle(textEl);
  return {
    typography: Object.fromEntries(TYPOGRAPHY.map((prop) => [prop, computed[prop]])),
    inline: computed.display === "inline",
    clipped: isClipped(textEl, item),
  };
}

// 글꼴은 태그나 id 로 지정된 경우가 많아 클래스만으로는 물려받지 못한다. 원문의 실제 값을 옮긴다.
function applyTypography(view, typography) {
  for (const prop of TYPOGRAPHY) view.style[prop] = typography[prop];
}

// 사이트 테마가 바뀌면 원문의 글자색이 달라지므로, 순화본에 옮겨 둔 값을 다시 맞춘다.
export function syncTypography(pairs) {
  const read = pairs.map(({ textEl }) => measure(textEl, textEl).typography);
  pairs.forEach(({ view }, index) => applyTypography(view, read[index]));
}

// 원문 요소와 같은 태그·클래스로 만들어, 사이트가 본문에 준 폭·여백·정렬을 그대로 물려받는다.
function shellLike(textEl, metrics) {
  const tag = textEl.tagName.includes("-") ? "div" : textEl.tagName.toLowerCase();
  const shell = document.createElement(tag);
  shell.className = `${typeof textEl.className === "string" ? textEl.className : ""} eml-view`.trim();
  const inline = textEl.getAttribute("style");
  if (inline) shell.setAttribute("style", inline);
  applyTypography(shell, metrics.typography);
  if (metrics.inline || tag !== textEl.tagName.toLowerCase()) shell.style.display = "block";
  return shell;
}

// 글 속의 주소는 누를 수 있는 링크로 만든다. 원문에 같은 글자의 링크가 있으면 그 주소를 쓴다
// (사이트가 긴 주소를 줄여서 보여 주는 경우 글자만으로는 온전한 주소를 알 수 없다).
function setLinkedText(node, value, originalLinks) {
  node.replaceChildren(
    ...splitUrls(value).map((part) => {
      if (!part.url) return document.createTextNode(part.text);
      const known =
        originalLinks.find((l) => l.text === part.text) ?? originalLinks.find((l) => l.text.startsWith(part.text));
      const link = document.createElement("a");
      link.href = known?.href ?? part.text;
      link.textContent = part.text;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }),
  );
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * @param {Element} textEl 원문 요소
 * @param {{group: string, original: string, cleaned: string, changed: boolean}} data
 * @param {{fold: boolean}} settings
 * @param {ReturnType<typeof measure>} metrics 화면을 바꾸기 전에 읽어 둔 값
 * @param {{forceView?: boolean}} [options] forceView: 원문 요소를 꾸미지 않고 항상 순화본으로 대체
 * @returns {Element|null} 순화본 요소. 원문 요소를 그대로 꾸민 경우 null
 */
export function renderComment(textEl, data, settings, metrics, options = {}) {
  const info = GROUPS[data.group];
  // 지울 것이 없고 접지도 않는 댓글은 원문 요소를 그대로 두고 꾸미기만 한다.
  // 링크, 타임스탬프, "자세히 보기" 같은 사이트 기능이 그대로 살아 있다.
  if (!options.forceView && !data.changed && !(settings.fold && info.fold)) {
    decorateInPlace(textEl, data.group, metrics);
    return null;
  }
  const view = shellLike(textEl, metrics);
  view.dataset.emlGroup = data.group;
  const originalLinks = [...textEl.querySelectorAll("a[href]")]
    .map((a) => ({ text: a.textContent.trim(), href: a.href }))
    .filter((l) => l.text && /^https?:/.test(l.href));

  const state = { folded: settings.fold && info.fold, showOriginal: false };

  const foldBtn = el("button", "eml-fold");
  foldBtn.type = "button";
  foldBtn.append(emojiEl(data.group), el("span", "eml-fold-label", `${info.label} 댓글을 접었습니다 · 눌러서 보기`));

  const row = el("div", "eml-row");
  const body = el("div", "eml-body");
  const text = el("span", "eml-text");
  const actions = el("div", "eml-actions");
  body.append(text, actions);
  row.append(emojiEl(data.group), body);

  const origBtn = el("button", "eml-btn");
  origBtn.type = "button";
  const refoldBtn = el("button", "eml-btn", "다시 접기");
  refoldBtn.type = "button";
  if (data.changed) actions.append(origBtn);
  if (settings.fold && info.fold) actions.append(refoldBtn);

  const update = () => {
    foldBtn.hidden = !state.folded;
    row.hidden = state.folded;
    actions.hidden = state.folded || !actions.childElementCount;
    const shown = state.showOriginal ? data.original : data.cleaned;
    setLinkedText(text, shown || "(감정 표현만 있는 댓글)", originalLinks);
    text.classList.toggle("eml-empty", !shown);
    origBtn.textContent = state.showOriginal ? "순화본 보기" : "원문 보기";
  };

  const stop = (handler) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
    update();
  };
  foldBtn.addEventListener("click", stop(() => (state.folded = false)));
  refoldBtn.addEventListener("click", stop(() => (state.folded = true)));
  origBtn.addEventListener("click", stop(() => (state.showOriginal = !state.showOriginal)));

  view.append(foldBtn, row);
  update();

  textEl.setAttribute("data-eml-hidden", "");
  textEl.after(view);
  return view;
}

function decorateInPlace(textEl, group, metrics) {
  if (metrics.inline) textEl.setAttribute("data-eml-block", "");
  textEl.setAttribute("data-eml-inplace", "");
  textEl.setAttribute("data-eml-group", group);
  try {
    textEl.style.setProperty("--eml-emoji", `url("${chrome.runtime.getURL(`emoji/${group}.png`)}")`);
  } catch {}
}

export function removeView(textEl, view) {
  view?.remove();
  if (textEl.hasAttribute("data-eml-inplace")) {
    for (const attr of ["data-eml-inplace", "data-eml-group", "data-eml-block", "data-eml-tight"]) {
      textEl.removeAttribute(attr);
    }
    textEl.style.removeProperty("--eml-emoji");
  }
  textEl.removeAttribute("data-eml-hidden");
  textEl.removeAttribute("data-eml-pending");
}

/**
 * 원문 요소를 꾸미면서 생긴 여백 때문에 글이 잘리게 된 댓글을 바로잡는다.
 * 먼저 위아래 여백을 없애 보고, 그래도 잘리면 fallback 을 불러 순화본 방식으로 바꾼다.
 * @param {{textEl: Element, item: Element, wasClipped: boolean, fallback: () => void}[]} list
 */
export function fixClipping(list) {
  const newlyClipped = (entries) =>
    entries.map((e) => !e.wasClipped && isClipped(e.textEl, e.item)).flatMap((bad, i) => (bad ? [entries[i]] : []));
  const tight = newlyClipped(list);
  for (const { textEl } of tight) textEl.setAttribute("data-eml-tight", "");
  for (const { fallback } of newlyClipped(tight)) fallback();
}

let pill = null;

/**
 * 화면 오른쪽 아래에 떠 있는 반응 요약. 누르면 접히고 다시 누르면 펼쳐진다.
 * @param {Record<string, number>} counts 그룹별 댓글 수
 * @param {boolean} collapsed 접힌 상태 여부
 * @param {() => void} onToggle
 */
export function renderPill(counts, collapsed, onToggle) {
  // 댓글이 많은 감정부터 보여 준다.
  const groups = rankGroups(counts);
  const total = groups.reduce((sum, group) => sum + counts[group], 0);
  if (!total) {
    pill?.remove();
    pill = null;
    return;
  }
  if (!pill || !pill.isConnected) {
    pill = el("button", "eml-pill");
    pill.type = "button";
    document.documentElement.append(pill);
  }
  pill.onclick = onToggle;
  pill.classList.toggle("eml-pill-collapsed", collapsed);
  const summaryText = groups.map((group) => `${GROUPS[group].label} ${counts[group]}`).join(", ");
  pill.title = `emotionless · 지금까지 본 댓글 ${total}개 (${summaryText})\n누르면 ${collapsed ? "펼칩니다" : "접습니다"}`;
  pill.setAttribute("aria-label", pill.title);

  const bar = el("span", "eml-pill-bar");
  for (const group of groups) {
    const seg = el("span", "eml-seg");
    seg.dataset.emlGroup = group;
    seg.style.flexGrow = String(counts[group]);
    bar.append(seg);
  }
  const chips = el("span", "eml-pill-chips");
  if (collapsed) {
    // 접힌 상태에서는 가장 많은 감정 하나와 전체 수만 보여 준다.
    const top = groups[0];
    const chip = el("span", "eml-chip");
    chip.append(emojiEl(top, "eml-emoji-sm"), el("span", null, String(total)));
    chips.append(chip);
  } else {
    for (const group of groups) {
      const chip = el("span", "eml-chip");
      chip.append(emojiEl(group, "eml-emoji-sm"), el("span", null, String(counts[group])));
      chips.append(chip);
    }
  }
  pill.replaceChildren(chips, bar);
}
