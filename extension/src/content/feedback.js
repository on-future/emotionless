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
 * 고른 표현을 바꿀 말을 적는다. 규칙에 맞는 순한 말이 있으면 미리 채워 둔다.
 * @param {{x: number, y: number, phrase: string, suggestion: string, onSubmit: (to: string) => void}} options
 */
export function openReplaceInput({ x, y, phrase, suggestion, onSubmit }) {
  const node = el("form", "eml-pop-replace");
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-label", "바꿀 말 적기");
  const from = el("p", "eml-pop-text");
  from.append("‘", el("strong", null, phrase), "’ 을(를)");
  const input = el("input", "eml-pop-input");
  input.type = "text";
  input.maxLength = 40;
  input.value = suggestion || "";
  input.placeholder = "바꿀 말 (비우면 지워요)";
  input.setAttribute("aria-label", "바꿀 말");
  const buttons = el("div", "eml-pop-buttons");
  const cancel = el("button", "eml-pop-action", "취소");
  cancel.type = "button";
  const apply = el("button", "eml-pop-action eml-pop-primary", "바꾸기");
  apply.type = "submit";
  buttons.append(cancel, apply);
  node.append(from, input, buttons);
  // 이 입력은 사람이 직접 하는 것만 받는다 (페이지 스크립트가 대신 제출하는 것은 무시).
  let typedByPerson = false;
  input.addEventListener("keydown", (event) => {
    if (event.isTrusted) typedByPerson = true;
  });
  apply.addEventListener("click", (event) => {
    if (event.isTrusted) typedByPerson = true;
  });
  cancel.addEventListener("click", (event) => {
    event.preventDefault();
    if (event.isTrusted) closePopover();
  });
  node.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!typedByPerson) return;
    const to = input.value.replace(/\s+/g, " ").trim().slice(0, 40);
    closePopover();
    onSubmit(to);
  });
  for (const type of ["keydown", "keyup", "keypress", "input"]) node.addEventListener(type, (event) => event.stopPropagation());
  show(node, x, y);
  input.focus();
  input.select();
}

/**
 * 처음 고쳤을 때 한 번, 고친 내용을 개선에 보낸다는 것을 알리고 고를 수 있게 한다.
 * @param {{x: number, y: number, onClose: (keepSharing: boolean | null) => void}} options
 *   onClose: "보내기"를 고르면 true, "보내지 않기"를 고르면 false, 답하지 않고 닫으면 null
 */
export function openShareNotice({ x, y, onClose }) {
  const node = el("div", "eml-pop-consent");
  node.setAttribute("role", "dialog");
  node.append(
    el("p", "eml-pop-title", "고친 내용을 보내 개선에 쓸까요?"),
    el(
      "p",
      "eml-pop-text",
      "보내면 고친 댓글의 글과 고친 내용만 Emotionless 서버로 가, 판정 모델을 다시 학습하는 데 쓰여요. 품질 확인을 위해 운영자가 볼 수 있어요. 계정·방문 기록은 보내지 않고, 설정에서 언제든 바꿀 수 있어요.",
    ),
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
    ["보내기", true, true],
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
  // 답하지 않고 닫은 것은 동의가 아니다. 보내지 않고 다음에 다시 묻는다.
  show(node, x, y, () => answer(null));
}
