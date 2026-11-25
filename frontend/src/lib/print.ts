import type { Prescription } from './clinical';
import type { Order } from './billing';

const money = (n: number) => n.toLocaleString('vi-VN') + ' ₫';
const dmy = (iso: string) => new Date(iso).toLocaleDateString('vi-VN');
const dmyhm = (iso: string) => new Date(iso).toLocaleString('vi-VN');

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Mã người-đọc cho bản in, dẫn xuất từ id (chưa có sequence tăng dần — xem gap-analysis). */
export function printCode(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Mở cửa sổ in với một tài liệu HTML tự chứa rồi gọi window.print().
 * Dùng cho đơn thuốc/biên nhận — "in HTML qua trình duyệt", không thêm thư viện PDF.
 */
export function openPrintWindow(title: string, bodyHtml: string): void {
  const w = window.open('', '_blank', 'width=820,height=920');
  if (!w) {
    alert('Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho trang này rồi thử lại.');
    return;
  }
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 24px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 2px; text-transform: uppercase; letter-spacing: .5px; }
  .muted { color: #555; }
  .row { display: flex; justify-content: space-between; gap: 16px; }
  .head { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .meta { margin: 10px 0; }
  .meta div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 10px; width: 280px; margin-left: auto; }
  .totals .row { padding: 3px 0; }
  .totals .grand { border-top: 1px solid #111; font-weight: 700; padding-top: 6px; }
  .sign { margin-top: 48px; display: flex; justify-content: space-between; text-align: center; }
  .sign div { width: 45%; }
  @media print { body { margin: 10mm; } @page { margin: 12mm; } }
</style></head><body>${bodyHtml}
<script>window.onload=function(){window.focus();window.print();};</script>
</body></html>`);
  w.document.close();
}

/** Đơn thuốc: in toàn bộ đơn hiện có của bệnh nhân thành một phiếu. */
export function printPrescriptions(opts: {
  patientName: string;
  mrn: string;
  items: Prescription[];
}): void {
  const { patientName, mrn, items } = opts;
  const code = items[0] ? printCode('DT', items[0].id) : 'DT';
  const rows = items
    .map(
      (p, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td><strong>${escapeHtml(p.medication)}</strong>${p.quantity ? ` — SL: ${escapeHtml(p.quantity)}` : ''}</td>
        <td>${escapeHtml(p.dosage)} · ${escapeHtml(p.frequency)}${p.durationDays ? ` · ${p.durationDays} ngày` : ''}${p.instructions ? `<br><span class="muted">${escapeHtml(p.instructions)}</span>` : ''}</td>
      </tr>`,
    )
    .join('');
  const body = `
    <div class="head row">
      <div><h1>Đơn thuốc</h1><div class="muted">Mã: ${code}</div></div>
      <div class="muted">Ngày in: ${dmy(new Date().toISOString())}</div>
    </div>
    <div class="meta">
      <div><strong>Bệnh nhân:</strong> ${escapeHtml(patientName)}</div>
      <div><strong>Mã hồ sơ:</strong> ${escapeHtml(mrn)}</div>
    </div>
    <table>
      <thead><tr><th style="width:36px">#</th><th>Thuốc</th><th>Liều · tần suất · thời gian · lời dặn</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="muted">Chưa có đơn thuốc.</td></tr>'}</tbody>
    </table>
    <div class="sign">
      <div>Người bệnh<br><span class="muted">(ký, ghi rõ họ tên)</span></div>
      <div>Bác sĩ kê đơn<br><span class="muted">(ký, ghi rõ họ tên)</span></div>
    </div>`;
  openPrintWindow(`Đơn thuốc ${code}`, body);
}

const METHOD_VI: Record<string, string> = {
  cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', prepaid: 'Thẻ trả trước', other: 'Khác',
};

/** Biên nhận cho một đơn: dòng đơn + các lần thu + tổng kết. */
export function printReceipt(opts: { order: Order; patientName: string; mrn: string }): void {
  const { order: o, patientName, mrn } = opts;
  const lines = o.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.name)}</td>
        <td class="num">${l.qty}</td>
        <td class="num">${money(l.unitPriceVnd)}</td>
        <td class="num">${l.discountVnd ? money(l.discountVnd) : '—'}</td>
        <td class="num">${money(l.amountVnd)}</td>
      </tr>`,
    )
    .join('');
  const pays = o.payments
    .map((p) => `<div class="row"><span>${METHOD_VI[p.method] ?? p.method} · ${dmyhm(p.paidAt)}</span><span class="num">${money(p.amountVnd)}</span></div>`)
    .join('');
  const body = `
    <div class="head row">
      <div><h1>Phiếu thu</h1><div class="muted">Đơn: ${escapeHtml(o.code)}</div></div>
      <div class="muted">Ngày in: ${dmyhm(new Date().toISOString())}</div>
    </div>
    <div class="meta">
      <div><strong>Bệnh nhân:</strong> ${escapeHtml(patientName)}</div>
      <div><strong>Mã hồ sơ:</strong> ${escapeHtml(mrn)}</div>
    </div>
    <table>
      <thead><tr><th>Nội dung</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Giảm</th><th class="num">Thành tiền</th></tr></thead>
      <tbody>${lines || '<tr><td colspan="5" class="muted">Không có dòng.</td></tr>'}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Tổng</span><span class="num">${money(o.totalVnd)}</span></div>
      <div class="row"><span>Đã thu</span><span class="num">${money(o.paidVnd)}</span></div>
      <div class="row grand"><span>Còn lại</span><span class="num">${money(o.remainingVnd)}</span></div>
    </div>
    ${pays ? `<div class="meta"><strong>Các lần thu:</strong>${pays}</div>` : ''}
    <div class="sign">
      <div>Người nộp tiền<br><span class="muted">(ký, ghi rõ họ tên)</span></div>
      <div>Người thu tiền<br><span class="muted">(ký, ghi rõ họ tên)</span></div>
    </div>`;
  openPrintWindow(`Phiếu thu ${o.code}`, body);
}
