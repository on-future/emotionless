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

function show(node, x, y, onDismiss = null) {
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
    if (event.isTrusted && !pop?.contains(event.target)) closePopover();
  };
  const onKey = (event) => {
    if (event.isTrusted && event.key === "Escape") closePopover();
  };
  // 방금 이 말풍선을 띄운 클릭에 바로 닫히지 않도록 다음 틱부터 듣는다.
  const timer = setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", closePopover, { capture: true, passive: true, once: true });
  });
  cleanup = () => {
    onDismiss?.();
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
      if (!event.isTrusted) return; // 페이지 스크립트가 대신 누른 것은 무시한다
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
      if (!event.isTrusted) return; // 페이지 스크립트가 대신 누른 것은 무시한다
      closePopover();
      onPick(action.id);
    });
    node.append(button);
  }
  show(node, x, y);
}

/**
 * 처음 고쳤을 때 한 번, 고친 내용을 개선에 보낸다는 것을 알리고 끌 수 있게 한다.
 * @param {{x: number, y: number, onClose: (keepSharing: boolean) => void}} options
 *   onClose: "보내지 않기"를 고르면 false, 확인하거나 그냥 닫으면 true
 */
export function openShareNotice({ x, y, onClose }) {
  const node = el("div", "eml-pop-consent");
  node.setAttribute("role", "dialog");
  node.append(
    el("p", "eml-pop-title", "고친 내용은 개선에 쓰여요"),
    el("p", "eml-pop-text", "고친 댓글의 글과 고른 내용만 보내, 모두의 판정을 더 정확하게 만드는 데 써요. 설정에서 언제든 끌 수 있어요."),
  );
  let answered = false;
  const answer = (keepSharing) => {
    if (answered) return;
    answered = true;
    onClose(keepSharing);
  };
  const buttons = el("div", "eml-pop-buttons");
  for (const [label, value, primary] of [
    ["보내지 않기", false, false],
    ["확인", true, true],
  ]) {
    const button = el("button", `eml-pop-action${primary ? " eml-pop-primary" : ""}`, label);
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted) return; // 페이지 스크립트가 대신 누른 것은 무시한다
      answer(value);
      closePopover();
    });
    buttons.append(button);
  }
  node.append(buttons);
  // 바깥을 눌러 닫은 경우도 안내를 본 것으로 친다.
  show(node, x, y, () => answer(true));
}
