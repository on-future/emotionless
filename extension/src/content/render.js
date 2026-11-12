// 댓글 본문을 숨기고 그 자리에 이모티콘 + 순화본을 붙인다. 원문 요소는 수정하지 않는다.
import { GROUPS, GROUP_ORDER } from "../shared/emotion.js";

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

// 원문 요소와 같은 태그·클래스로 만들어, 사이트가 본문에 준 폭·여백·정렬을 그대로 물려받는다.
function shellLike(textEl) {
  const tag = textEl.tagName.includes("-") ? "div" : textEl.tagName.toLowerCase();
  const shell = document.createElement(tag);
  shell.className = `${typeof textEl.className === "string" ? textEl.className : ""} eml-view`.trim();
  const inline = textEl.getAttribute("style");
  if (inline) shell.setAttribute("style", inline);
  return shell;
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
 */
export function renderComment(textEl, data, settings) {
  const info = GROUPS[data.group];
  const view = shellLike(textEl);
  view.dataset.emlGroup = data.group;

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
    text.textContent = shown || "(감정 표현만 있는 댓글)";
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

export function removeView(textEl, view) {
  view?.remove();
  textEl.removeAttribute("data-eml-hidden");
  textEl.removeAttribute("data-eml-pending");
}

let pill = null;

/**
 * 화면 오른쪽 아래에 떠 있는 반응 요약. 누르면 접히고 다시 누르면 펼쳐진다.
 * @param {Record<string, number>} counts 그룹별 댓글 수
 * @param {boolean} collapsed 접힌 상태 여부
 * @param {() => void} onToggle
 */
export function renderPill(counts, collapsed, onToggle) {
  const groups = GROUP_ORDER.filter((group) => counts[group] > 0);
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
    const top = groups.reduce((a, b) => (counts[b] > counts[a] ? b : a));
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
