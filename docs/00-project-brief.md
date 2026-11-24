# 00 · Project Brief

## Bối cảnh

Xây dựng mới (greenfield) một CRM y tế cho tổ chức **20 người dùng nội bộ** (admin, bác sĩ, y tá, lễ tân). Hệ thống lưu trữ và xử lý PHI (Protected Health Information), do đó phải hướng tới tuân thủ **HIPAA Security Rule** và mở đường cho GDPR/LGPD.

## Phạm vi MVP (Phase 1-2)

| Module | Nội dung |
|---|---|
| Quản lý bệnh nhân | Hồ sơ, tiền sử, dị ứng, liên lạc, bảo hiểm, consent |
| Lịch hẹn | Lập lịch, nhắc nhở, xác nhận, waitlist |
| Hồ sơ y tế | Ghi chú khám, đơn thuốc, kết quả xét nghiệm, tài liệu đính kèm |
| Người dùng & quyền | RBAC 4 vai trò, session management, MFA |
| Kiểm toán | Audit log bất biến, access log, change history |
| Dashboard | Thống kê cơ bản, export PDF/Excel |

## Ngoài phạm vi MVP

Telemedicine, mobile app, patient portal, SMS, tích hợp hệ thống lab bên ngoài, analytics nâng cao.

## Timeline tổng

| Phase | Thời lượng | Mục tiêu |
|---|---|---|
| 1 · Foundation | 2-3 tuần | Kiến trúc, DB schema, API spec, auth, encryption module |
| 2 · Core Features | 3-4 tuần | Patient, Appointment, Medical Records |
| 3 · HIPAA & Security | 2-3 tuần | E2E encryption, audit, backup/DR |
| 4 · Testing | 2 tuần | >80% coverage, security audit, pentest |
| 5 · Deployment | 1-2 tuần | AWS + BAA, CI/CD, training, go-live |

## Tiêu chí thành công

- Kỹ thuật: >80% test coverage, 0 lỗ hổng critical, p95 < 200ms, uptime > 99.5%
- Vận hành: 20 users được đào tạo, 0 sự cố mất dữ liệu, backup đã test restore
- Tuân thủ: audit HIPAA đạt, chính sách đầy đủ, BAA đã ký với AWS

## Rủi ro đã nhận diện (cần quyết định sớm)

| # | Rủi ro | Ảnh hưởng | Hành động đề xuất |
|---|---|---|---|
| R1 | Chưa ký BAA với AWS/SendGrid | Vi phạm HIPAA ngay khi có PHI thật | Ký BAA trước Phase 5; dùng dữ liệu giả cho Phase 1-4 |
| R2 | "End-to-end encryption" trong spec chưa định nghĩa rõ | Nếu E2E thật (client giữ khoá) thì server không thể search/report | Chốt: dùng **field-level encryption phía server** + TLS, không phải E2E client-side. Xem `06-security-architecture.md` |
| R3 | Audit log "immutable" | PostgreSQL thường cho phép UPDATE/DELETE | Dùng append-only table + revoke quyền UPDATE/DELETE + hash chain |
| R4 | Retention 6 năm | Chi phí lưu trữ, cần archive tier | Partition theo tháng, chuyển S3 Glacier sau 1 năm |
| R5 | Key management | Khoá nằm trong .env là vi phạm | Dùng AWS KMS (prod) / file-based dev key với envelope encryption |
| R6 | Team 4-6 người nhưng timeline 4-5 tháng | Rủi ro trượt tiến độ | Chốt scope MVP cứng, đẩy "Nice to have" sang sau go-live |

## Quyết định kiến trúc đã chốt (Phase 1)

- **AD-001**: Monorepo (`backend/` + `frontend/`) thay vì 2 repo — team nhỏ, dễ đồng bộ type.
- **AD-002**: Field-level encryption bằng AES-256-GCM (`node:crypto`), envelope encryption với DEK/KEK. Chọn AES vì được NIST/FIPS phê duyệt — quan trọng cho HIPAA safe harbor.
- **AD-003**: Argon2id cho password hashing (thay bcrypt — mạnh hơn với GPU attack).
- **AD-004**: TOTP (RFC 6238) cho MFA, không dùng SMS OTP (SMS không đạt chuẩn NIST AAL2).
- **AD-005**: Access token (JWT, 15 phút) + refresh token (opaque, lưu DB, 30 phút idle timeout).
- **AD-006**: Audit log ghi bằng hash chain, bảng append-only, không có API xoá.
