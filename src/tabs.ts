// 上のタブ（スマホだけ）: 店のシーンと人の検知のシーンを切り替える
export function setupTabs(current: 'store' | 'people') {
  if (!location.pathname.includes('phone')) return;
  const nav = document.createElement('nav');
  nav.id = 'tabs'; nav.setAttribute('aria-label', 'シーン');
  for (const t of [{ id: 'store', label: '店', href: '/phone.html' }, { id: 'people', label: '人の検知', href: '/phone.html?scene=people' }]) {
    const a = document.createElement('a');
    a.textContent = t.label; a.href = t.href;
    if (t.id === current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  document.body.prepend(nav);
  document.body.classList.add('has-tabs');
}
