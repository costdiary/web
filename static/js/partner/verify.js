/* #/verify: 사업자등록증 사진 -> OCR 4개 값 확인 -> 제출 -> 승인/재시도/반려 */
import { h, api, app, bus, field, busy, toast, errMsg, icon, fill, refreshRoute } from '../core.js';

const MAX_BYTES = 12 * 1024 * 1024;

export async function render(box) {
  const stage = h('div');
  box.append(h('div', { class: 'page-h' }, h('h1', null, '사업자 인증')),
    h('p', { class: 'small muted', style: 'margin:-6px 0 14px' }, '도매마켓은 사업자 인증을 마친 판매자만 수요를 보고 제안할 수 있습니다. 보통 1분이면 끝납니다.'),
    stage);

  function showPick() {
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) handleFile(f); });
    const ws = app.me;
    fill(stage, h('section', { class: 'sheet' },
      ws.status === 'rejected' ? h('div', { class: 'banner', role: 'alert' }, h('div', null, h('b', null, '인증에 실패했습니다. '), '등록증 정보를 다시 확인한 뒤 올려 주세요.')) : null,
      h('div', { class: 'drop' },
        icon('receipt', 40),
        h('p', null, '사업자등록증 사진을 올리면 상호·대표자명·사업자등록번호·개업일자를 읽어 옵니다. 반영 전에 직접 확인합니다.'),
        h('div', { class: 'btn-row', style: 'justify-content:center' },
          h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('upload', 20), '사업자등록증 사진 올리기'), file)),
      ws.verify.attempts_today >= 1 ? h('p', { class: 'small muted', style: 'margin-top:10px' }, `오늘 시도 ${ws.verify.attempts_today}회`) : null));
  }

  async function handleFile(f) {
    if (f.size > MAX_BYTES) { toast('사진 용량이 너무 큽니다(12MB 이하).', 'err'); return; }
    fill(stage, h('section', { class: 'sheet' }, h('div', { class: 'reading', role: 'status' },
      h('p', null, '사업자등록증을 읽는 중입니다. 잠시만 기다려 주세요.'), h('div', { class: 'progress' }))));
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await api('/api/ws/verify/ocr', { method: 'POST', form });
      showReview(res);
    } catch (e) {
      fill(stage, h('section', { class: 'sheet' },
        h('p', { class: 'form-err' }, errMsg(e)),
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'button', onclick: showPick }, '다시 올리기'))));
    }
  }

  function showReview(res) {
    const f = res.fields;
    const bizNo = h('input', { class: 'input', type: 'text', maxLength: 10, inputmode: 'numeric', value: f.biz_no || '' });
    const bizName = h('input', { class: 'input', type: 'text', maxLength: 60, value: f.biz_name || '' });
    const ceoName = h('input', { class: 'input', type: 'text', maxLength: 40, value: f.ceo_name || '' });
    const openDate = h('input', { class: 'input', type: 'date', value: f.open_date || '' });
    const err = h('div', { class: 'form-err', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn', type: 'submit' }, '제출하기');
    const form = h('form', { novalidate: true },
      res.demo ? h('div', { class: 'banner info', role: 'status' }, h('div', null, h('b', null, '시험 모드입니다. '), '자동 인식 키가 없어 예시 결과를 보여 드립니다. 그대로 제출해도 실제로 처리됩니다.')) : null,
      err,
      field('사업자등록번호 (10자리, 숫자만)', bizNo, res.low_confidence?.includes('biz_no') ? '읽기 어려웠습니다. 직접 확인해 주세요.' : null),
      field('상호', bizName),
      field('대표자명', ceoName),
      field('개업일자', openDate),
      submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const digits = bizNo.value.replace(/\D/g, '');
      if (digits.length !== 10) { err.textContent = '사업자등록번호 10자리를 숫자만 입력해 주세요.'; err.hidden = false; return; }
      if (!bizName.value.trim() || !ceoName.value.trim() || !openDate.value) { err.textContent = '모든 항목을 입력해 주세요.'; err.hidden = false; return; }
      await busy(submit, async () => {
        let out;
        try {
          out = await api('/api/ws/verify/submit', { method: 'POST', body: { verification_id: res.verification_id, biz_no: digits, biz_name: bizName.value.trim(), ceo_name: ceoName.value.trim(), open_date: openDate.value } });
        } catch (e) { err.textContent = errMsg(e); err.hidden = false; return; }
        showResult(out);
      });
    });
    fill(stage, h('section', { class: 'sheet' },
      h('p', { class: 'small muted' }, '사진과 비교해서 맞는지 확인하고 틀린 곳은 고쳐 주세요.'), form));
  }

  function showResult(out) {
    if (out.status === 'approved') {
      fill(stage, h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '인증이 완료되었습니다')),
        h('p', null, out.message),
        h('ol', { class: 'dm-next' },
          h('li', null, h('b', null, '배송 가능 권역을 고르세요. '), '고른 권역의 수요만 보입니다.'),
          h('li', null, h('b', null, '수요를 보고 블라인드로 제안하세요. '), '현재 거래가는 공개되지 않습니다.'),
          h('li', null, h('b', null, '연결 요청이 오면 72시간 안에 응답하세요. '), '수락하면 서로 연락처가 열립니다.')),
        h('div', { class: 'btn-row', style: 'margin-top:14px' },
          h('a', { class: 'btn', href: '#/demands' }, '수요 보러 가기'),
          h('a', { class: 'btn ghost', href: '#/profile' }, '배송 권역 설정'))));
      api('/api/ws/me').then((me) => { app.me = me; bus.dispatchEvent(new Event('ws-status-changed')); }).catch(() => {});
      return;
    }
    if (out.status === 'retry') {
      fill(stage, h('section', { class: 'sheet' },
        h('div', { class: 'sheet-h' }, h('h2', null, '다시 확인해 주세요') ),
        h('p', { class: 'form-err' }, out.message),
        h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn', type: 'button', onclick: showPick }, '다시 올리기'))));
      return;
    }
    fill(stage, h('section', { class: 'sheet' },
      h('div', { class: 'sheet-h' }, h('h2', null, '인증이 반려되었습니다')),
      h('p', { class: 'form-err' }, out.message),
      out.reason_code !== 'too_many_attempts'
        ? h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn', type: 'button', onclick: showPick }, '다시 시도')) : null));
    refreshRoute();
  }

  showPick();
}
