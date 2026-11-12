// 판정을 고치는 작은 말풍선들: 감정 고르기, 표현 지우기/남기기, 보내기 동의.
// 한 번에 하나만 뜨고, 바깥을 누르거나 Esc 를 누르거나 스크롤하면 닫힌다.
import { GROUPS, GROUP_ORDER } from "../shared/emotion.js";

let pop = null;
let cleanup = null;

export function closePopover() {
  cleanup?.();
  cleanup = null;
  pop?.remove();
  pop = null;
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function show(node, x, y) {
  closePopover();
  pop = node;
  pop.classList.add("eml-pop");
  document.documentElement.append(pop);
  // 가리킨 곳 바로 위에 놓되, 화면 밖으로 나가지 않게 한다.
  const { width, height } = pop.getBoundingClientRect();
  const left = Math.max(8, Math.min(x - width / 2, innerWidth - width - 8));
  const top = y - height - 10 >= 8 ? y - height - 10 : Math.min(y + 18, innerHeight - height - 8);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;

  const onDown = (event) => {
    if (!pop?.contains(event.target)) closePopover();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closePopover();
  };
  // 방금 이 말풍선을 띄운 클릭에 바로 닫히지 않도록 다음 틱부터 듣는다.
  const timer = setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", closePopover, { capture: true, passive: true, once: true });
  });
  cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", closePopover, true);
  };
}

function faceUrl(group) {
  try {
    return chrome.runtime.getURL(`emoji/${group}.png`);
  } catch {
    return "";
  }
}

/** 얼굴 여덟 개 가운데 맞는 감정을 고른다. */
export function openEmotionPicker({ x, y, current, onPick }) {
  const node = el("div", "eml-pop-faces");
  node.setAttribute("role", "listbox");
  node.setAttribute("aria-label", "맞는 감정 고르기");
  for (const group of GROUP_ORDER) {
    const button = el("button", "eml-pop-face");
    button.type = "button";
    button.title = GROUPS[group].label;
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", GROUPS[group].label);
    button.setAttribute("aria-selected", String(group === current));
    const img = el("img");
    img.src = faceUrl(group);
    img.alt = "";
    img.draggable = false;
    button.append(img);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
      if (group !== current) onPick(group);
    });
    node.append(button);
  }
  show(node, x, y);
}

/** 드래그해 고른 표현을 어떻게 할지 고른다. @param {{id: string, label: string}[]} actions */
export function openWordMenu({ x, y, actions, onPick }) {
  const node = el("div", "eml-pop-menu");
  for (const action of actions) {
    const button = el("button", "eml-pop-action", action.label);
    button.type = "button";
    button.addEventListener("mousedown", (event) => event.preventDefault()); // 선택 영역이 풀리지 않게
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
      onPick(action.id);
    });
    node.append(button);
  }
  show(node, x, y);
}

/** 처음 고쳤을 때 한 번, 고친 내용을 개선에 보낼지 묻는다. */
export function openConsent({ x, y, onAnswer }) {
  const node = el("div", "eml-pop-consent");
  node.setAttribute("role", "dialog");
  node.append(
    el("p", "eml-pop-title", "고친 내용을 보내 줄까요?"),
    el("p", "eml-pop-text", "댓글 글과 고른 내용만 보내고, 모두의 판정을 더 정확하게 만드는 데 써요. 나중에 설정에서 바꿀 수 있어요."),
  );
  const buttons = el("div", "eml-pop-buttons");
  for (const [label, value, primary] of [
    ["내 기기에만", false, false],
    ["보내기", true, true],
  ]) {
    const button = el("button", `eml-pop-action${primary ? " eml-pop-primary" : ""}`, label);
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
      onAnswer(value);
    });
    buttons.append(button);
  }
  node.append(buttons);
  show(node, x, y);
}
