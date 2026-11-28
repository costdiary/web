/* 메뉴 탭 아래의 하위 탭: 메뉴 목록 · 프렙 레시피 · 재료 연결표 · 메뉴 추천 */
import { h } from './core.js';

const TABS = [
  ['#/menus', '메뉴'],
  ['#/preps', '프렙 레시피'],
  ['#/menus/map', '재료 연결표'],
  ['#/menus/ideas', '메뉴 추천'],
];

export function menuTabs(current) {
  return h('nav', { class: 'subtabs', 'aria-label': '메뉴 화면' },
    TABS.map(([href, label]) => h('a', { class: 'subtab', href, 'aria-current': href === current ? 'page' : null }, label)));
}
