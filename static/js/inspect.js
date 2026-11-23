/**
 * 원가다이어리 DOM Inspector (개발용)
 * localhost 또는 ?inspect=1 쿼리스트링일 때만 활성화됩니다.
 * 프로덕션에는 절대 노출되지 않습니다.
 */

const IS_DEV = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  || new URLSearchParams(location.search).has('inspect');

if (!IS_DEV) {
  // 개발 환경이 아니면 아무것도 안 함
} else {
  initInspector();
}

function initInspector() {
  let active = false;
  let hovered = null;
  let pinned = null;

  /* ── 스타일 ── */
  const style = document.createElement('style');
  style.textContent = `
    #__insp-btn {
      position: fixed; bottom: 18px; right: 18px; z-index: 99999;
      width: 40px; height: 40px; border-radius: 50%;
      background: #1a1a2e; color: #d8ef79; font-size: 18px;
      border: 2px solid #d8ef79; cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s, background .15s;
      font-family: system-ui, sans-serif;
    }
    #__insp-btn.on { background: #d8ef79; color: #1a1a2e; }
    #__insp-btn:hover { transform: scale(1.12); }

    .__insp-hl {
      outline: 2px solid #3b82f6 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    .__insp-pin {
      outline: 2px solid #d8ef79 !important;
      outline-offset: 2px !important;
    }

    #__insp-panel {
      position: fixed; bottom: 68px; right: 18px; z-index: 99998;
      width: 320px; max-height: 72vh; overflow-y: auto;
      background: #0f172a; color: #e2e8f0;
      border: 1px solid #334155; border-radius: 10px;
      font: 12px/1.5 'JetBrains Mono', 'Fira Code', monospace;
      box-shadow: 0 8px 32px rgba(0,0,0,.6);
      display: none;
    }
    #__insp-panel.open { display: block; }

    #__insp-panel-header {
      padding: 10px 14px 8px;
      border-bottom: 1px solid #1e293b;
      display: flex; align-items: center; justify-content: space-between;
    }
    #__insp-panel-title { color: #d8ef79; font-weight: 700; font-size: 11px; letter-spacing: .05em; }
    #__insp-panel-close {
      background: none; border: none; color: #64748b; cursor: pointer;
      font-size: 16px; line-height: 1; padding: 0 2px;
    }
    #__insp-panel-close:hover { color: #e2e8f0; }

    #__insp-panel-body { padding: 12px 14px; }

    .__insp-row { margin-bottom: 8px; }
    .__insp-label {
      font-size: 10px; text-transform: uppercase; letter-spacing: .07em;
      color: #64748b; margin-bottom: 2px;
    }
    .__insp-val {
      background: #1e293b; border-radius: 4px; padding: 4px 8px;
      word-break: break-all; color: #93c5fd; font-size: 11.5px;
    }
    .__insp-val.green { color: #86efac; }
    .__insp-val.yellow { color: #fde68a; }
    .__insp-val.muted { color: #64748b; font-style: italic; }

    .__insp-classes { display: flex; flex-wrap: wrap; gap: 4px; }
    .__insp-cls-chip {
      background: #1e3a5f; color: #93c5fd; border-radius: 3px;
      padding: 2px 6px; font-size: 10.5px; cursor: pointer;
    }
    .__insp-cls-chip:hover { background: #1d4ed8; }

    #__insp-actions {
      padding: 10px 14px 12px;
      border-top: 1px solid #1e293b;
      display: flex; gap: 6px; flex-wrap: wrap;
    }
    .__insp-action-btn {
      flex: 1; min-width: 80px;
      background: #1e293b; color: #cbd5e1; border: 1px solid #334155;
      border-radius: 5px; padding: 5px 8px; font-size: 11px;
      cursor: pointer; font-family: inherit; transition: background .1s;
    }
    .__insp-action-btn:hover { background: #334155; color: #f1f5f9; }
    .__insp-action-btn.primary { background: #d8ef79; color: #0f172a; border-color: #d8ef79; font-weight: 700; }
    .__insp-action-btn.primary:hover { background: #c8de60; }

    #__insp-toast {
      position: fixed; bottom: 70px; right: 18px; z-index: 100000;
      background: #d8ef79; color: #0f172a; border-radius: 6px;
      padding: 7px 14px; font-size: 12px; font-weight: 700;
      font-family: system-ui, sans-serif;
      opacity: 0; transform: translateY(6px);
      transition: opacity .2s, transform .2s;
      pointer-events: none;
    }
    #__insp-toast.show { opacity: 1; transform: translateY(0); }
  `;
  document.head.appendChild(style);

  /* ── 버튼 ── */
  const btn = document.createElement('button');
  btn.id = '__insp-btn';
  btn.title = 'DOM Inspector (개발용)';
  btn.textContent = '🔍';
  document.body.appendChild(btn);

  /* ── 패널 ── */
  const panel = document.createElement('div');
  panel.id = '__insp-panel';
  panel.innerHTML = `
    <div id="__insp-panel-header">
      <span id="__insp-panel-title">🔍 DOM Inspector</span>
      <button id="__insp-panel-close" title="닫기">✕</button>
    </div>
    <div id="__insp-panel-body">
      <p style="color:#64748b;font-size:11px;text-align:center;margin:8px 0">요소를 클릭하면 여기에 표시됩니다</p>
    </div>
    <div id="__insp-actions" style="display:none"></div>
  `;
  document.body.appendChild(panel);

  /* ── 토스트 ── */
  const toast = document.createElement('div');
  toast.id = '__insp-toast';
  document.body.appendChild(toast);

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  }

  /* ── Inspector 토글 ── */
  btn.addEventListener('click', () => {
    active = !active;
    btn.classList.toggle('on', active);
    btn.textContent = active ? '✕' : '🔍';
    btn.title = active ? 'Inspector OFF' : 'DOM Inspector (개발용)';
    if (!active) {
      clearHover();
      clearPin();
      panel.classList.remove('open');
    }
  });

  document.getElementById('__insp-panel-close').addEventListener('click', () => {
    clearPin();
    panel.classList.remove('open');
  });

  /* ── 호버 ── */
  document.addEventListener('mouseover', (e) => {
    if (!active) return;
    if (e.target.closest('#__insp-btn') || e.target.closest('#__insp-panel')) return;
    if (hovered && hovered !== pinned) hovered.classList.remove('__insp-hl');
    hovered = e.target;
    if (hovered !== pinned) hovered.classList.add('__insp-hl');
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (!active) return;
    if (hovered && hovered !== pinned) hovered.classList.remove('__insp-hl');
    hovered = null;
  }, true);

  /* ── 클릭 → 핀 ── */
  document.addEventListener('click', (e) => {
    if (!active) return;
    if (e.target.closest('#__insp-btn') || e.target.closest('#__insp-panel')) return;
    e.preventDefault();
    e.stopPropagation();
    clearPin();
    pinned = e.target;
    pinned.classList.add('__insp-pin');
    if (hovered === pinned) pinned.classList.remove('__insp-hl');
    showPanel(pinned);
  }, true);

  function clearHover() {
    if (hovered) { hovered.classList.remove('__insp-hl'); hovered = null; }
  }
  function clearPin() {
    if (pinned) { pinned.classList.remove('__insp-pin'); pinned = null; }
  }

  /* ── 패널 채우기 ── */
  function showPanel(el) {
    const body = document.getElementById('__insp-panel-body');
    const actions = document.getElementById('__insp-actions');
    const sel = getSelector(el);
    const tag = el.tagName.toLowerCase();
    const id = el.id || null;
    const classes = [...el.classList].filter(c => !c.startsWith('__insp'));
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const cs = getComputedStyle(el);

    body.innerHTML = `
      <div class="__insp-row">
        <div class="__insp-label">선택자</div>
        <div class="__insp-val green">${esc(sel)}</div>
      </div>
      <div class="__insp-row">
        <div class="__insp-label">태그</div>
        <div class="__insp-val">&lt;${tag}&gt;</div>
      </div>
      ${id ? `<div class="__insp-row">
        <div class="__insp-label">ID</div>
        <div class="__insp-val yellow">#${esc(id)}</div>
      </div>` : ''}
      ${classes.length ? `<div class="__insp-row">
        <div class="__insp-label">클래스 (클릭하면 복사)</div>
        <div class="__insp-classes">${classes.map(c => `<span class="__insp-cls-chip" data-cls="${esc(c)}">.${esc(c)}</span>`).join('')}</div>
      </div>` : ''}
      ${text ? `<div class="__insp-row">
        <div class="__insp-label">텍스트</div>
        <div class="__insp-val ${text.length > 60 ? 'muted' : ''}">${esc(text)}${el.textContent.trim().length > 80 ? '…' : ''}</div>
      </div>` : ''}
      <div class="__insp-row">
        <div class="__insp-label">크기 / 위치</div>
        <div class="__insp-val">${formatRect(el.getBoundingClientRect())}</div>
      </div>
      <div class="__insp-row">
        <div class="__insp-label">CSS (주요값)</div>
        <div class="__insp-val">${formatCss(cs)}</div>
      </div>
    `;

    // 클래스 칩 클릭 → 복사
    body.querySelectorAll('.__insp-cls-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        copyText('.' + chip.dataset.cls);
        showToast(`.${chip.dataset.cls} 복사됨`);
      });
    });

    // 액션 버튼
    actions.style.display = '';
    actions.innerHTML = `
      <button class="__insp-action-btn primary" id="__insp-copy-fb">📋 피드백 복사</button>
      <button class="__insp-action-btn" id="__insp-copy-sel">선택자 복사</button>
      <button class="__insp-action-btn" id="__insp-copy-cls">클래스 복사</button>
    `;

    document.getElementById('__insp-copy-fb').addEventListener('click', (e) => {
      e.stopPropagation();
      const fb = `[${sel}] 피드백: `;
      copyText(fb);
      showToast('클립보드에 복사됨 — 채팅에 붙여넣기 하세요');
    });

    document.getElementById('__insp-copy-sel').addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(sel);
      showToast('선택자 복사됨');
    });

    document.getElementById('__insp-copy-cls').addEventListener('click', (e) => {
      e.stopPropagation();
      const c = classes.length ? classes.join(' ') : tag;
      copyText(c);
      showToast('클래스 복사됨');
    });

    panel.classList.add('open');
  }

  /* ── 유틸 ── */
  function getSelector(el) {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const cls = [...el.classList].filter(c => !c.startsWith('__insp')).slice(0, 2).map(c => `.${c}`).join('');
    const parent = el.parentElement;
    if (!parent || parent === document.body) return tag + cls;
    const siblings = [...parent.children].filter(c => c.tagName === el.tagName);
    const idx = siblings.indexOf(el);
    const nth = siblings.length > 1 ? `:nth-of-type(${idx + 1})` : '';
    return tag + cls + nth;
  }

  function formatRect(r) {
    return `${Math.round(r.width)}×${Math.round(r.height)}  (top:${Math.round(r.top)} left:${Math.round(r.left)})`;
  }

  function formatCss(cs) {
    const props = ['color','background-color','font-size','font-weight','padding','margin','display','flex-direction','gap','border-radius'];
    return props
      .map(p => `${p}: ${cs.getPropertyValue(p)}`)
      .filter(s => !s.endsWith(': ') && !s.endsWith(': 0px') && !s.endsWith(': normal') && !s.endsWith(': none') && !s.endsWith(': auto'))
      .join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
