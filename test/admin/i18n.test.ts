import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentLang, translateToEnglish } from '../../src/admin/i18n';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = '';
  localStorage.setItem('lang', 'zh');
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('staff app language', () => {
  it('uses the saved choice, else the browser language', () => {
    localStorage.setItem('lang', 'en');
    expect(currentLang()).toBe('en');
    localStorage.removeItem('lang');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN']);
    expect(currentLang()).toBe('zh');
    vi.restoreAllMocks();
  });

  it('turns Chinese on the page into English, now and as it changes', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<h1>伙伴</h1><input placeholder="搜索编号、姓名、公司、电话"><p>陈先生</p>';
    document.body.append(root);
    stop = translateToEnglish(root);
    expect(root.querySelector('h1')!.textContent).toBe('Partner');
    expect(root.querySelector('input')!.getAttribute('placeholder')).toBe('Search ID, name, company, phone');
    expect(root.querySelector('p')!.textContent).toBe('陈先生');
    const added = document.createElement('span');
    added.textContent = '载入中…';
    root.append(added);
    root.querySelector('h1')!.firstChild!.nodeValue = '案件';
    await tick();
    expect(added.textContent).toBe('Loading…');
    expect(root.querySelector('h1')!.textContent).toBe('Case');
  });

  it('uses the element own English where one word needs a different form', () => {
    const root = document.createElement('div');
    root.innerHTML = '<a data-en="Partners">伙伴</a><span>伙伴</span>';
    document.body.append(root);
    stop = translateToEnglish(root);
    expect(root.querySelector('a')!.textContent).toBe('Partners');
    expect(root.querySelector('span')!.textContent).toBe('Partner');
  });

  it('never changes what is typed in a text box, or the language switch', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<textarea>营业执照</textarea><div data-no-translate>伙伴</div>';
    document.body.append(root);
    stop = translateToEnglish(root);
    expect(root.querySelector('textarea')!.value).toBe('营业执照');
    expect(root.querySelector('[data-no-translate]')!.textContent).toBe('伙伴');
  });

  it('asks pop-up questions in English', () => {
    const original = window.confirm;
    const ask = vi.fn(() => true);
    window.confirm = ask;
    stop = translateToEnglish(document.createElement('div'));
    expect(window.confirm('确定退出登录？')).toBe(true);
    expect(ask).toHaveBeenCalledWith('Sign out now?');
    stop();
    stop = undefined;
    expect(window.confirm).toBe(ask);
    window.confirm = original;
  });
});
