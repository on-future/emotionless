// 설정의 기본값과 읽는 방법. 콘텐츠 스크립트와 팝업이 함께 쓴다.

// 걸러 보는 정도 (약한 것부터)
//  label: 감정만 표시하고 글은 그대로 둔다
//  clean: 욕설과 과한 표현을 지운다
//  fold : 지우고, 분노·비난 댓글은 한 줄로 접는다
//  hide : 지우고, 분노·비난 댓글은 아예 숨긴다
export const LEVELS = ["label", "clean", "fold", "hide"];

export const DEFAULTS = {
  enabled: true,
  level: "fold",
  showPill: true,
  pillCollapsed: false,
  disabledHosts: [],
  selectors: {},
};

// chrome.storage 에서 읽어 올 키. "fold" 는 단계 설정이 생기기 전의 옛 설정이다.
export const STORAGE_KEYS = [...Object.keys(DEFAULTS), "fold"];

/**
 * 저장된 값을 온전한 설정으로 만든다. 빠진 값은 기본값으로 채우고,
 * 옛 "접기" 스위치만 저장돼 있으면 그에 맞는 단계로 옮긴다.
 */
export function normalize(stored = {}) {
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (stored[key] !== undefined) settings[key] = stored[key];
  if (!LEVELS.includes(stored.level)) settings.level = stored.fold === false ? "clean" : DEFAULTS.level;
  return settings;
}
