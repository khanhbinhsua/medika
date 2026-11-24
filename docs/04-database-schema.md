# 04 · Database Schema

Nguồn sự thật là các file migration trong `backend/migrations/`. Tài liệu này giải thích **vì sao**.

## Thứ tự migration

| File | Nội dung |
|---|---|
| `...001_extensions-and-enums.sql` | pgcrypto, citext, enum types, trigger `set_updated_at` |
| `...002_auth-and-rbac.sql` | roles, permissions, users, sessions, MFA, seed RBAC |
| `...003_encryption-keys.sql` | encryption_keys, thêm `dek_id` cho mfa_secrets |
| `...004_patients.sql` | patients + contacts, allergies, history, consents |
| `...005_appointments.sql` | appointments, notes, reminders, waitlist |
| `...006_medical-records.sql` | records + versions, prescriptions, lab_results, documents |
| `...007_audit-logs.sql` | audit_logs, phi_access_logs (partitioned, append-only) |

Chạy:
```bash
npm run migrate:up --prefix backend
```

## Ma trận phân quyền (seed sẵn)

| Permission | admin | doctor | nurse | receptionist | auditor |
|---|:-:|:-:|:-:|:-:|:-:|
| patient:read | ✓ | ✓ | ✓ | ✓ | |
| patient:write | ✓ | ✓ | ✓ | ✓ | |
| patient:delete | ✓ | | | | |
| appointment:read | ✓ | ✓ | ✓ | ✓ | |
| appointment:write | ✓ | ✓ | ✓ | ✓ | |
| appointment:cancel | ✓ | ✓ | | ✓ | |
| record:read | ✓ | ✓ | ✓ | | |
| record:write | ✓ | ✓ | | | |
| prescription:write | ✓ | ✓ | | | |
| lab:read / lab:write | ✓ | ✓ | ✓ | | |
| document:read / write | ✓ | ✓ | ✓ | | |
| user:read / user:write | ✓ | | | | |
| audit:read | ✓ | | | | ✓ |
| report:read | ✓ | ✓ | | ✓ | ✓ |
| report:export | ✓ | | | | ✓ |

> `auditor` cố ý **không** có `patient:read` — kiểm toán viên xem được ai truy cập cái gì, nhưng không xem được nội dung PHI. Đây là least privilege.

## Cột mã hoá (bytea) và cột tra cứu

| Bảng | Cột mã hoá | Cột hash tra cứu |
|---|---|---|
| `patients` | first_name, last_name, dob, email, phone, insurance_id, address | name_search_hash, email_search_hash, phone_search_hash |
| `patient_contacts` | name, value, relationship | — |
| `patient_allergies` | notes | — |
| `patient_medical_history` | notes | — |
| `appointment_notes` | note | — |
| `medical_records` | content | — |
| `medical_record_versions` | content | — |
| `prescriptions` | instructions | — |
| `lab_results` | result_value | — |
| `documents` | file_dek | — |
| `mfa_secrets` | secret | — |

Cột **không** mã hoá có chủ ý: `allergy_name`, `condition`, `icd10_code`, `medication`, `test_name`, `dosage`, `frequency` — cần để truy vấn/cảnh báo tương tác thuốc, và tự chúng không định danh được bệnh nhân khi tách khỏi `patient_id`.

## Ràng buộc đáng chú ý

| Ràng buộc | Bảng | Mục đích |
|---|---|---|
| `appointments_no_doctor_overlap` (EXCLUDE GIST) | appointments | Chặn double-booking ở tầng DB, không dựa vào application logic |
| `patient_contacts_one_primary_idx` | patient_contacts | Tối đa 1 liên hệ chính mỗi bệnh nhân |
| `patient_consents_active_idx` | patient_consents | Mỗi loại consent chỉ có 1 bản còn hiệu lực |
| `medical_records_signed_consistency` | medical_records | `is_signed` và `signed_at` không được lệch nhau |
| `encryption_keys_destroyed_consistency` | encryption_keys | Trạng thái destroyed phải có mốc thời gian |
| Trigger `reject_audit_mutation` | audit_logs, phi_access_logs | Chặn UPDATE/DELETE ngay ở DB |

## Partition & retention

`audit_logs` và `phi_access_logs` partition theo `RANGE (created_at)`. Hiện chỉ có partition DEFAULT — Phase 3 sẽ thêm job tạo partition theo tháng.

Chính sách retention (HIPAA yêu cầu tối thiểu 6 năm):

| Tuổi dữ liệu | Nơi lưu |
|---|---|
| 0–12 tháng | RDS, partition nóng |
| 1–2 năm | RDS, partition đã `VACUUM FULL` |
| 2–6 năm | Export sang S3 Glacier Instant Retrieval, detach partition |
| > 6 năm | Xoá theo thủ tục có phê duyệt, ghi lại vào audit |

## Crypto-shredding

Để "xoá an toàn" dữ liệu một bệnh nhân mà không cần ghi đè vật lý từng bản ghi và bản backup:

1. Đặt `encryption_keys.status = 'destroyed'`, `destroyed_at = now()`.
2. Ghi đè `wrapped_dek` bằng zero.
3. Ghi audit `PATIENT_CRYPTO_SHRED`.

Sau bước này mọi ciphertext của bệnh nhân đó — kể cả trong backup cũ — vĩnh viễn không giải mã được.

## Quyền tài khoản DB

Ứng dụng chạy bằng role `crm_app` với quyền tối thiểu:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
REVOKE UPDATE, DELETE ON audit_logs, phi_access_logs FROM crm_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
```

Migration chạy bằng role riêng `crm_migrator` (có DDL), không dùng chung với ứng dụng.
