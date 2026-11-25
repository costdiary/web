/* 주변 상권: 가게 위치 반경 안의 음식점 분포와 추가 공공데이터를 내 매출과 함께 봅니다. */
import { h, api, app, field, numInput, parseNum, n0, busy, toast, errMsg, fill, icon } from './core.js';
import { num } from './ui.js';

const KEY_HELP = h('details', { class: 'more' }, h('summary', null, '운영자용: 공공데이터·지도 키 설정'),
  h('ol', { class: 'plain' },
    h('li', null, '공공데이터포털(data.go.kr)에 가입하고 "소상공인시장진흥공단_상가(상권)정보"를 활용신청합니다(무료).'),
    h('li', null, '주소 → 좌표 변환은 네이버 클라우드 플랫폼의 Maps Geocoding을 신청해 받은 키를 NAVER_MAP_KEY_ID, NAVER_MAP_KEY 에 적습니다.'),
    h('li', null, '받은 일반 인증키를 서버 폴더의 .env 파일에 DATA_GO_KR_KEY=키 로 적고 서버를 다시 켭니다.'),
    h('li', null, '서울 생활인구·상권 추정매출 등은 서울 열린데이터광장(data.seoul.go.kr) 키를 SEOUL_API_KEY 에, 데이터셋의 서비스 이름을 SEOUL_SERVICES 에 적습니다.')));

export async function render(box) {
  const canWrite = app.me.plan.writable;
  const body = h('div', { class: 'stack', 'aria-live': 'polite' });

  async function load(refresh = false) {
    const [a, s] = await Promise.all([api(`/api/area${refresh ? '?refresh=true' : ''}`), api('/api/sales')]);
    paint(a, s);
  }

  async function saveLoc(body) {
    await api('/api/area/location', { method: 'PUT', body });
    await load();
  }

  function paint(a, s) {
    const loc = a.location;
    const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
    const addr = h('input', { class: 'input', type: 'text', maxLength: 100, placeholder: '예: 경기도 성남시 분당구 불정로 6', 'aria-label': '가게 주소', disabled: !canWrite });
    const found = h('div', { 'aria-live': 'polite' });
    const radius = loc ? loc.radius_m : 500;

    // 주소로 찾기 -> 맞는 주소를 누르면 바로 저장하고 상권을 불러옵니다(위도·경도는 사장님이 몰라도 됩니다).
    const findBtn = h('button', { class: 'btn', type: 'button', disabled: !canWrite, onclick: () => busy(findBtn, async () => {
      err.hidden = true;
      fill(found);
      try {
        const r = await api(`/api/area/geocode?q=${encodeURIComponent(addr.value.trim())}`);
        if (!r.results.length) { fill(found, h('p', { class: 'small muted' }, '찾지 못했습니다. 도로명 주소(예: 불정로 6)나 건물 이름까지 적어 보세요.')); return; }
        fill(found, h('p', { class: 'small muted' }, '우리 가게 주소를 눌러 주세요.'),
          h('ul', { class: 'plain pick' }, r.results.map((x) => h('li', null, h('button', { class: 'btn ghost', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
            try { await saveLoc({ lat: x.lat, lon: x.lon, radius_m: radius, label: (x.road || x.jibun).slice(0, 100) }); toast('주소를 저장했습니다.'); } catch (er) { err.textContent = errMsg(er); err.hidden = false; }
          }) }, x.road || x.jibun, x.jibun && x.road ? h('span', { class: 'xs muted' }, ` (${x.jibun})`) : null)))));
      } catch (e) { err.textContent = errMsg(e); err.hidden = false; }
    }) }, icon('search', 18), '주소 찾기');
    addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findBtn.click(); } });

    const radii = [[300, '300m'], [500, '500m'], [1000, '1km'], [2000, '2km']];
    const radiusRow = loc ? h('div', { class: 'seg', role: 'group', 'aria-label': '살펴볼 거리' }, radii.map(([m, t]) => h('button', {
      class: `btn sm ${m === loc.radius_m ? '' : 'ghost'}`, type: 'button', 'aria-pressed': String(m === loc.radius_m), disabled: !canWrite,
      onclick: (e) => busy(e.currentTarget, () => saveLoc({ lat: loc.lat, lon: loc.lon, radius_m: m, label: loc.label })),
    }, t))) : null;

    // 좌표를 이미 알고 있거나 주소 검색을 쓸 수 없을 때만 쓰는 직접 입력
    const coord = (v, ph, lb) => h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: v, placeholder: ph, 'aria-label': lb, disabled: !canWrite }); // 소수점 자리를 줄이지 않으려고 숫자 입력칸을 쓰지 않습니다
    const lat = coord(loc ? String(loc.lat) : '', '37.5665', '위도');
    const lon = coord(loc ? String(loc.lon) : '', '126.9780', '경도');
    const manualSave = h('button', { class: 'btn ghost sm', type: 'button', disabled: !canWrite, onclick: () => busy(manualSave, async () => {
      err.hidden = true;
      try { await saveLoc({ lat: parseFloat(lat.value.replace(',', '.')), lon: parseFloat(lon.value.replace(',', '.')), radius_m: radius, label: loc ? loc.label : '' }); toast('위치를 저장했습니다.'); } catch (e) { err.textContent = errMsg(e); err.hidden = false; }
    }) }, '좌표로 저장');
    const manual = h('details', { class: 'more' }, h('summary', null, '위도·경도를 직접 입력'),
      h('p', { class: 'hint' }, '지도앱에서 가게를 길게 누르면 나오는 숫자입니다. 주소로 찾으면 필요 없습니다.'),
      h('div', { class: 'two' }, field('위도', lat), field('경도', lon)), h('div', { class: 'btn-row' }, manualSave));

    const st = a.stores;
    const summary = loc && a.sources.semas ? (st ? h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, `반경 ${loc.radius_m}m 안 상가`),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: (e) => busy(e.currentTarget, () => load(true)) }, '새로 불러오기')),
      h('div', { class: 'be-big' },
        h('div', null, h('span', { class: 'small muted' }, '음식점'), num(n0(st.food_total), '곳')),
        h('div', null, h('span', { class: 'small muted' }, '전체 상가'), num(n0(st.total), '곳')),
        s.total ? h('div', null, h('span', { class: 'small muted' }, `내 ${s.month.slice(5)}월 매출`), num(n0(s.total), '원')) : null),
      h('p', { class: 'xs muted' }, `소상공인시장진흥공단 상가(상권)정보 · 불러온 시각 ${a.stores_at ? a.stores_at.slice(0, 16).replace('T', ' ') : ''} (UTC). 자료는 분기마다 갱신되어 지금 영업 중인지와 다를 수 있습니다.`),
      st.food_by_mid.length ? h('div', null, h('h3', null, '음식점 종류'), h('ul', { class: 'plain' }, st.food_by_mid.map((m) => h('li', null, `${m.name} ${n0(m.count)}곳`)))) : null,
      st.food_nearest.length ? h('details', { class: 'more' }, h('summary', null, `가까운 음식점 ${st.food_nearest.length}곳`),
        h('ul', { class: 'plain' }, st.food_nearest.map((f) => h('li', null, `${f.dist}m · ${f.name || '이름 없음'} (${f.scls || f.mcls})`)))) : null) : null) : null;

    const extras = (a.extra || []).map((e) => h('section', { class: 'sheet' },
      h('h2', null, `서울 열린데이터광장 · ${e.service}`),
      h('p', { class: 'xs muted' }, `전체 ${e.total ?? '?'}건 중 ${e.rows.length}건`),
      h('div', { class: 'tscroll', tabindex: 0, role: 'region', 'aria-label': `${e.service} 표` },
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, e.columns.map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', null, e.rows.map((r) => h('tr', null, e.columns.map((c) => h('td', null, String(r[c] ?? '')))))))))); 

    fill(body,
      h('section', { class: 'sheet' },
        h('h2', null, '우리 가게 위치'),
        err,
        loc ? h('p', null, h('b', null, loc.label || '저장한 위치'), h('span', { class: 'small muted' }, ` · 반경 ${loc.radius_m}m`)) : null,
        loc ? h('div', null, h('p', { class: 'small muted' }, '얼마나 멀리까지 볼까요?'), radiusRow) : null,
        a.sources.geocode ? h('div', { style: 'margin-top:10px' }, field(loc ? '주소 바꾸기' : '가게 주소', addr, '"주소 찾기"를 누를 때만 입력한 주소가 네이버 지도 서버로 전달되고, 위치는 내 계정에만 저장됩니다.'), h('div', { class: 'btn-row' }, findBtn), found)
          : h('p', { class: 'small muted' }, '주소 검색은 아직 켜져 있지 않습니다. 아래에서 위도·경도를 직접 넣어 주세요.'),
        a.sources.geocode ? h('div', { style: 'margin-top:8px' }, manual) : h('div', { open: true }, manual)),
      !a.sources.semas ? h('div', { class: 'banner info', role: 'status' }, h('div', null, h('b', null, '주변 상가 자료는 아직 연결 전이에요. '), '운영자가 공공데이터 키를 넣으면 반경 안 음식점 분포가 여기에 보입니다.')) : null,
      loc && a.sources.semas && !st && !a.errors.length ? h('p', { class: 'small muted' }, '불러오는 중이거나 이 반경에 자료가 없습니다.') : null,
      a.errors.length ? h('div', { class: 'banner', role: 'alert' }, h('div', null, a.errors.map((e) => h('div', null, e)))) : null,
      summary, ...extras,
      !a.sources.semas || !a.sources.seoul || !a.sources.geocode ? KEY_HELP : null,
      h('p', { class: 'xs muted' }, '유동인구·추정매출은 서울 데이터만 연결할 수 있습니다. 내 매출은 ', h('a', { href: '#/sales' }, '여기'), '에서 입력하면 위 숫자와 함께 보입니다.'));
  }

  box.append(
    h('div', { class: 'page-h' }, h('a', { class: 'btn ghost sm back-more', href: '#/more' }, icon('back', 18), '전체 메뉴'), h('h1', { style: 'font-size:1.125rem' }, '주변 상권')),
    body);
  await load();
}
