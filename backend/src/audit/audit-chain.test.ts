import { describe, it, expect } from 'vitest';
import { verifyChainRows, hashForRow, GENESIS_HASH } from './audit-logger.js';
import type { VerifiableRow } from './audit-logger.js';

/**
 * Dựng một chuỗi hợp lệ y như writeAuditLog tạo ra, nhưng hoàn toàn trong bộ nhớ.
 * Nhờ vậy có thể thử các kịch bản giả mạo mà không phải tắt trigger bảo vệ hay
 * đụng vào nhật ký kiểm toán thật.
 */
function buildChain(actions: string[]): VerifiableRow[] {
  const rows: VerifiableRow[] = [];
  let prevHash = GENESIS_HASH;

  actions.forEach((action, i) => {
    const base = {
      request_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      actor_id: null,
      action,
      entity_type: 'patient' as string | null,
      entity_id: null,
      changes: null,
      outcome: 'success',
      prev_hash: prevHash,
      created_at: new Date(1_700_000_000_000 + i * 1000),
    };

    const entryHash = hashForRow(base);
    rows.push({ id: i + 1, ...base, entry_hash: entryHash });
    prevHash = entryHash;
  });

  return rows;
}

describe('kiểm tra toàn vẹn nhật ký kiểm toán', () => {
  it('chấp nhận chuỗi nguyên vẹn', () => {
    const result = verifyChainRows(buildChain(['LOGIN_SUCCESS', 'PATIENT_CREATE', 'PATIENT_UPDATE']));

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
  });

  it('chấp nhận chuỗi rỗng', () => {
    expect(verifyChainRows([]).valid).toBe(true);
  });

  it('phát hiện nội dung bị sửa dù hai cột hash giữ nguyên', () => {
    const rows = buildChain(['LOGIN_SUCCESS', 'PATIENT_DELETE', 'LOGOUT']);

    // Kịch bản thật: kẻ có quyền vào thẳng DB đổi hành vi đã ghi thành thứ vô
    // hại, giữ nguyên prev_hash và entry_hash để mắt xích vẫn khớp.
    rows[1]!.action = 'PATIENT_VIEW';

    const result = verifyChainRows(rows);

    expect(result.valid).toBe(false);
    expect(result.kind).toBe('content_modified');
    expect(result.brokenAtId).toBe('2');
  });

  it('phát hiện sửa cột changes', () => {
    const rows = buildChain(['PATIENT_UPDATE', 'LOGOUT']);
    rows[0]!.changes = { insuranceId: { old: 'A', new: 'B' } };

    const result = verifyChainRows(rows);

    expect(result.valid).toBe(false);
    expect(result.kind).toBe('content_modified');
  });

  it('phát hiện sửa outcome từ denied thành success', () => {
    const rows = buildChain(['ACCESS_DENIED', 'LOGOUT']);
    rows[0]!.outcome = 'denied';

    const result = verifyChainRows(rows);

    expect(result.valid).toBe(false);
    expect(result.kind).toBe('content_modified');
  });

  it('phát hiện lùi thời điểm ghi', () => {
    const rows = buildChain(['PATIENT_CREATE', 'LOGOUT']);
    rows[0]!.created_at = new Date(1_600_000_000_000);

    expect(verifyChainRows(rows).kind).toBe('content_modified');
  });

  it('phát hiện dòng bị xoá', () => {
    const rows = buildChain(['LOGIN_SUCCESS', 'PATIENT_DELETE', 'LOGOUT']);
    const withHole = [rows[0]!, rows[2]!];

    const result = verifyChainRows(withHole);

    expect(result.valid).toBe(false);
    expect(result.kind).toBe('broken_link');
    expect(result.brokenAtId).toBe('3');
  });

  it('phát hiện dòng bị chèn thêm', () => {
    const rows = buildChain(['LOGIN_SUCCESS', 'LOGOUT']);
    const forged: VerifiableRow = {
      ...rows[1]!,
      id: 99,
      action: 'PATIENT_EXPORT',
    };
    forged.entry_hash = hashForRow(forged);

    const result = verifyChainRows([rows[0]!, forged, rows[1]!]);

    expect(result.valid).toBe(false);
    // Dòng chèn tự nó hợp lệ, nhưng dòng sau nó không còn nối đúng nữa.
    expect(result.kind).toBe('broken_link');
  });

  it('không phụ thuộc thứ tự khoá trong changes', () => {
    // PostgreSQL lưu `changes` dạng jsonb và sắp xếp lại khoá khi đọc ra.
    // Hash phải bất biến với thứ tự, nếu không mọi dòng có `changes` sẽ bị
    // báo giả mạo nhầm — nguy hiểm hơn là không kiểm tra gì.
    const base = {
      request_id: null,
      actor_id: null,
      action: 'PATIENT_CREATE',
      entity_type: 'patient' as string | null,
      entity_id: null,
      outcome: 'success',
      prev_hash: GENESIS_HASH,
      created_at: new Date(1_700_000_000_000),
    };

    const asWritten = { firstName: { old: null, new: '[SET]' }, dob: { old: null, new: '[SET]' } };
    const asReadBack = { dob: { new: '[SET]', old: null }, firstName: { new: '[SET]', old: null } };

    const hash = hashForRow({ ...base, changes: asWritten });
    const row: VerifiableRow = { id: 1, ...base, changes: asReadBack, entry_hash: hash };

    expect(verifyChainRows([row]).valid).toBe(true);
  });

  it('vẫn phát hiện khi giá trị trong changes bị đổi', () => {
    const base = {
      request_id: null,
      actor_id: null,
      action: 'PATIENT_UPDATE',
      entity_type: 'patient' as string | null,
      entity_id: null,
      outcome: 'success',
      prev_hash: GENESIS_HASH,
      created_at: new Date(1_700_000_000_000),
    };

    const hash = hashForRow({ ...base, changes: { status: { old: 'active', new: 'deceased' } } });
    const tampered: VerifiableRow = {
      id: 1,
      ...base,
      changes: { status: { old: 'active', new: 'active' } },
      entry_hash: hash,
    };

    expect(verifyChainRows([tampered]).kind).toBe('content_modified');
  });

  it('báo đúng số dòng đã kiểm tra trước điểm gãy', () => {
    const rows = buildChain(['A', 'B', 'C', 'D']);
    rows[2]!.action = 'ĐÃ_SỬA';

    expect(verifyChainRows(rows).entriesChecked).toBe(2);
  });
});
