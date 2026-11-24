# Sao lưu, Khôi phục & Xoá An toàn

## 1. Sao lưu (Backup)

### Lịch & giữ bản

```bash
cd backend && npm run backup
```

Chạy `pg_dump -Fc` (custom format — nén sẵn, cho phép `pg_restore` chọn lọc bảng) qua container Postgres, lưu vào `backend/backups/` với tên có timestamp. Mặc định giữ **7 bản gần nhất**, tự xoá bản cũ hơn (`--keep=N` để đổi).

### Mã hoá file backup + off-site (đã triển khai)

Đặt `BACKUP_ENCRYPTION_KEY` (32 byte base64) → `backup.mjs` mã hoá file dump bằng **AES-256-GCM** rồi **xoá bản plaintext**, chỉ giữ `.dump.enc`. Đặt thêm `BACKUP_S3_BUCKET` (+ endpoint/credentials) → tự đẩy off-site lên S3 hoặc MinIO.

Vì sao vẫn cần mã hoá file dù cột PHI lõi đã là ciphertext AES-256-GCM: file dump vẫn chứa **search hash (HMAC tên/email/sđt)**, **tên nhân viên**, **MRN**, **địa chỉ IP trong audit log**, và toàn bộ cấu trúc — dạng thô. Search hash cho phép tấn công xác nhận (biết tên → tính HMAC → xác nhận có mặt). Đưa file như vậy off-site mà không mã hoá là rò rỉ dữ liệu nhạy cảm. Khoá backup **tách khỏi KEK**: mất khoá backup không ảnh hưởng dữ liệu sống, và ngược lại.

Đã kiểm chứng end-to-end (`npm run backup` → `npm run restore`):
- `.dump.enc` bắt đầu bằng version byte, KHÔNG phải magic `PGDMP`; `pg_restore` trực tiếp bị từ chối ("not a valid archive").
- Off-site: object trong MinIO xác nhận là ciphertext (không chứa `PGDMP`).
- Restore từ `.enc`: giải mã ra file tạm → `pg_restore` → verify dữ liệu + **chuỗi hash audit vẫn `valid`** → dọn file tạm plaintext (không để lại trên đĩa).

Production: lên lịch chạy hàng ngày (cron / EventBridge), backup mã hoá đẩy off-site tự động. AWS: thêm SSE-KMS trên bucket làm lớp phòng thủ thứ ba. VPS: MinIO + ổ đĩa mã hoá (LUKS).

## 2. Khôi phục (Restore)

```bash
cd backend && npm run restore -- --target <ten_database>
```

`--target` là **bắt buộc**, không có giá trị mặc định — đây là rào chắn có chủ đích để không vô tình phục hồi đè lên database đang chạy.

### Ba lớp an toàn

1. **Không đè database khác đã tồn tại.** Nếu `--target` là một DB đã có sẵn (và không phải DB chính), script từ chối — tự ý xoá dữ liệu người khác không phải việc của một lệnh restore.
2. **Đè database chính (`crm_dk`) cần xác nhận kép.** Phải có cả cờ `--force-overwrite-primary` LẪN biến môi trường `CONFIRM_OVERWRITE=crm_dk` khớp đúng tên — một trong hai không đủ. Sau đó có 5 giây để Ctrl+C huỷ trước khi DROP DATABASE thật sự chạy.
3. **Tự kiểm tra sau khi phục hồi**, không tự nhận là đã xong: đếm số dòng ở các bảng chính và **verify lại toàn bộ chuỗi hash của `audit_logs`** trên chính database vừa phục hồi (`verify-restored-db.ts`, kết nối tới target DB — không dùng kết nối mặc định của ứng dụng). Nếu chuỗi hash đứt sau khi phục hồi, script báo lỗi và thoát khác 0.

### Diễn tập đã chạy thật (không phải mô tả suông)

```
npm run backup                                    → crm_dk_2026-08-19T12-18-22-166Z.dump (0.67 MB)
npm run restore -- --target crm_dk_restore_test    → phục hồi vào DB rỗng mới tạo
```

Kết quả đối chiếu với DB gốc, khớp **chính xác 100%** từng bảng:

| Bảng | Gốc | Sau phục hồi |
|---|---|---|
| patients | 44 | 44 |
| appointments | 19 | 19 |
| medical_records | 10 | 10 |
| prescriptions | 9 | 9 |
| patient_consents | 48 | 48 |
| audit_logs | 2223 | 2223 |
| phi_access_logs | 33643 | 33643 |
| users | 5 | 5 |

Chuỗi hash `audit_logs` trên bản phục hồi: **`valid: true`, 2223/2223 dòng khớp** — tính toàn vẹn kiểm toán sống sót qua chu trình sao lưu/phục hồi.

## 3. Xác minh mã hoá tại chỗ (Encryption-at-rest verification)

```bash
cd backend && npm run verify:encryption
```

Ép mọi cột `*_enc` decode UTF-8. Nguyên lý: AES-256-GCM sinh IV (12 byte) + auth tag (16 byte) hoàn toàn ngẫu nhiên ở đầu ciphertext — xác suất 28 byte ngẫu nhiên liên tiếp **tình cờ** tạo thành chuỗi UTF-8 hợp lệ là cực nhỏ. Nên: **decode UTF-8 mà thành công mới là dấu hiệu đáng ngờ** (ngược trực giác thông thường).

Đã chạy trên toàn bộ dữ liệu dev hiện tại: **291 cột kiểm tra, 0 nghi ngờ.**

Lệnh này được gọi tự động trong `npm run backup` — một bản sao lưu chỉ được coi là hợp lệ nếu bước kiểm tra này sạch.

## 4. Point-in-Time Recovery (PITR) — Production

Docker Compose dev **không** bật WAL archiving (không đại diện đúng cho topology production, nên không tự dựng PITR thủ công ở đây — dễ tạo cảm giác an toàn giả mà không phản ánh đúng hạ tầng thật sẽ dùng).

**Production dùng AWS RDS PostgreSQL với automated backups + point-in-time restore built-in**:

- Bật `backup_retention_period` (7–35 ngày) khi tạo RDS instance.
- RDS tự động chụp snapshot hàng ngày + lưu WAL liên tục — khôi phục về **bất kỳ thời điểm nào** trong khung giữ, không cần code tự viết.
- Không có lý do tự dựng lại cơ chế WAL archiving thủ công khi dùng RDS — đây chính là tính năng lõi của dịch vụ.

RTO mục tiêu theo spec: **< 4 giờ**. Với RDS point-in-time restore (tạo instance mới từ snapshot + WAL, thường 15–60 phút tuỳ kích thước DB) + thời gian trỏ lại DNS/kết nối ứng dụng, mục tiêu này khả thi mà không cần thêm hạ tầng.

## 5. Xoá an toàn (Secure Deletion / Crypto-Shredding)

Xem chi tiết luồng nghiệp vụ ở `patient.service.ts` (`purgePatient`) và UI tại `/benh-nhan/da-xoa`. Tóm tắt:

- **Hai bước bắt buộc**: soft-delete (`deleted_at`) trước, tiêu huỷ vĩnh viễn (`purged_at`, crypto-shredding) sau — CHECK constraint ở DB chặn thao tác một bước.
- **Thời gian ân hạn** (`PATIENT_PURGE_GRACE_HOURS`, mặc định 72 giờ ở production) giữa hai bước — lưới an toàn cuối cho một hành động không thể hoàn tác.
- **Cơ chế**: huỷ DEK của bệnh nhân (`encryption_keys.status = 'destroyed'`, `wrapped_dek` bị ghi đè bằng zero). Mọi ciphertext dùng khoá đó — hồ sơ nhân khẩu học, lý do khám mọi lịch hẹn, nội dung mọi hồ sơ bệnh án, hướng dẫn mọi đơn thuốc — vĩnh viễn không giải mã được, **kể cả trong bản sao lưu cũ đã tạo trước đó**. Đây chính là lý do "xoá an toàn" không cần xoá dữ liệu vật lý khỏi từng bản backup: khoá mất thì dữ liệu tự động thành rác không đọc được.
- Chỉ `admin` (permission `patient:purge`), bắt buộc nêu lý do (≥10 ký tự, lưu vĩnh viễn cùng bản ghi), ghi audit log mức nghiêm trọng cao nhất (`PATIENT_PURGE`).
- Sau khi purge, mọi endpoint đọc phải dữ liệu liên quan trả về **410 Gone** (`DataDestroyedError`) thay vì crash 500 — đã kiểm chứng qua `npm run smoke:purge`.

## Bảng lệnh tham khảo

| Việc cần làm | Lệnh |
|---|---|
| Sao lưu ngay | `npm run backup` |
| Sao lưu, giữ 14 bản thay vì 7 | `npm run backup -- --keep=14` |
| Phục hồi bản mới nhất vào DB thử nghiệm | `npm run restore -- --target crm_dk_test` |
| Phục hồi một file cụ thể | `npm run restore -- --file backups/crm_dk_...dump --target crm_dk_test` |
| Diễn tập disaster recovery (đè DB chính) | `CONFIRM_OVERWRITE=crm_dk npm run restore -- --target crm_dk --force-overwrite-primary` |
| Kiểm tra không có PHI plaintext | `npm run verify:encryption` |
