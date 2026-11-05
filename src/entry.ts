// 入口。スマホの画面は上のタブでシーンを切り替える（phone.html と phone.html?scene=people）
export const scene = new URLSearchParams(location.search).get('scene') === 'people' && location.pathname.includes('phone') ? 'people' : 'store';
if (scene === 'people') void import('./people/main');
else void import('./main');
