// The staff app's language. The pages are written in Chinese; in English mode a small translator
// swaps each piece of Chinese on screen (text, placeholders, labels, pop-up questions) for its
// English from the shared dictionary as React draws it. Switching language reloads the page so
// nothing has to be swapped back.
import { english, type Lang, langFromPreferences } from '../shared/i18n';

const KEY = 'lang';
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;

function stored(): Lang | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'en' || v === 'zh' ? v : null;
  } catch {
    return null;
  }
}

/** The saved choice on this device, else the browser's language. */
export function currentLang(): Lang {
  return stored() ?? langFromPreferences(navigator.languages?.length ? navigator.languages : [navigator.language ?? '']);
}

/** Saves the choice and reloads into it. */
export function switchLang(lang: Lang): void {
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // Storage blocked (private mode): nothing to remember the choice in, so stay as we are.
    return;
  }
  window.location.reload();
}

const HAS_CHINESE = /[　-〿一-鿿＀-￯]/;

function translateNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    // A textarea's text is what someone typed or will save: never change it.
    if (node.parentElement?.closest('textarea, [contenteditable], [data-no-translate]')) return;
    const v = node.nodeValue ?? '';
    if (HAS_CHINESE.test(v)) {
      const en = english(v);
      if (en !== null && en !== v) node.nodeValue = en;
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (el.closest('textarea, [contenteditable], [data-no-translate]')) return;
  // An element can carry its own English (a menu item says "Partners" where a column says "Partner").
  const own = el.getAttribute('data-en');
  if (own !== null && el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE) {
    if (el.firstChild!.nodeValue !== own) el.firstChild!.nodeValue = own;
    return;
  }
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && HAS_CHINESE.test(v)) {
      const en = english(v);
      if (en !== null && en !== v) el.setAttribute(a, en);
    }
  }
  for (const child of Array.from(el.childNodes)) translateNode(child);
}

/** Starts translating `root` into English; returns a function that stops it. */
export function translateToEnglish(root: HTMLElement): () => void {
  document.documentElement.lang = 'en';
  document.title = 'Toh’s Sign Partner admin';
  translateNode(root);
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateNode(r.target.parentElement?.hasAttribute('data-en') ? r.target.parentElement : r.target);
      else if (r.type === 'attributes') translateNode(r.target);
      else r.addedNodes.forEach(translateNode);
    }
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  // Pop-up questions are not on the page, so they are translated as they are asked.
  const ask = window.confirm;
  const tell = window.alert;
  window.confirm = (msg?: string) => ask.call(window, msg === undefined ? msg : (english(msg) ?? msg));
  window.alert = (msg?: unknown) => tell.call(window, typeof msg === 'string' ? (english(msg) ?? msg) : msg);
  return () => {
    obs.disconnect();
    window.confirm = ask;
    window.alert = tell;
  };
}
