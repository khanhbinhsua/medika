# 03 · Entity-Relationship Diagram

> **Tái sinh 2026-11-24 từ schema sống** (`backend/src/db/types.ts` — interface `Database`,
> migrations `001`→`031`). Khi sửa schema, cập nhật file này theo.
> Lần này bổ sung nhóm clinic-ops (migrations `027`→`031`, Quyết định B3: nhân CRM đa chi
> nhánh + module clinic-ops opt-in) và dời chúng vào **Miền 4** riêng.

Ký hiệu: 🔒 = cột mã hoá field-level (ciphertext trong DB). Thực tế: **51 bảng**, chia 4
miền. Mọi bảng có `id uuid` PK + `created_at` (lược trong sơ đồ cho gọn) trừ các bảng danh
mục/nối ghi rõ PK khác.

## Miền 1 — Nền tảng: Auth · RBAC · Crypto · Audit

```mermaid
erDiagram
    ROLES ||--o{ USERS : "gán"
    ROLES ||--o{ ROLE_PERMISSIONS : "có"
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "thuộc"
    USERS ||--o{ SESSIONS : "có"
    USERS ||--o| MFA_SECRETS : "có"
    USERS ||--o{ PASSWORD_RESET_TOKENS : "có"
    USERS ||--o{ AUDIT_LOGS : "thực hiện"
    ENCRYPTION_KEYS ||--o| MFA_SECRETS : "wrap DEK"

    ROLES { uuid id PK; text name UK; bool is_system }
    PERMISSIONS { uuid id PK; text code UK }
    ROLE_PERMISSIONS { uuid role_id PK_FK; uuid permission_id PK_FK }
    USERS {
        uuid id PK; citext email UK; text password_hash; text full_name
        uuid role_id FK; text status; text locale; bool mfa_enabled
        int failed_login_attempts; timestamptz locked_until; timestamptz last_login_at
    }
    MFA_SECRETS { uuid user_id PK_FK; bytea secret_enc "🔒"; uuid dek_id FK; text_array recovery_codes_hashed; text last_used_step }
    SESSIONS { uuid id PK; uuid user_id FK; text refresh_token_hash UK; inet ip_address; timestamptz expires_at; timestamptz revoked_at }
    PASSWORD_RESET_TOKENS { uuid id PK; uuid user_id FK; text token_hash; timestamptz expires_at; timestamptz used_at }
    ENCRYPTION_KEYS { uuid id PK; text key_type; bytea wrapped_dek; text kek_reference; int version; text status; timestamptz rotated_at; timestamptz destroyed_at }
    AUDIT_LOGS {
        uuid id PK; uuid request_id; uuid actor_id FK; text actor_email
        text action; text entity_type; uuid entity_id; jsonb changes
        text outcome; text prev_hash; text entry_hash
    }
```

## Miền 2 — Lõi bệnh nhân: hồ sơ · lịch hẹn · đơn thuốc · tài liệu · ảnh · cổng BN

```mermaid
erDiagram
    ENCRYPTION_KEYS ||--o{ PATIENTS : "wrap DEK"
    PATIENTS ||--o{ PATIENT_CONTACTS : "có"
    PATIENTS ||--o{ PATIENT_ALLERGIES : "có"
    PATIENTS ||--o{ PATIENT_MEDICAL_HISTORY : "có"
    PATIENTS ||--o{ PATIENT_CONSENTS : "ký"
    PATIENTS ||--o{ APPOINTMENTS : "đặt"
    PATIENTS ||--o{ PRESCRIPTIONS : "được kê"
    PATIENTS ||--o{ DOCUMENTS : "đính kèm"
    PATIENTS ||--o{ CLINICAL_PHOTOS : "ảnh trước/sau"
    PATIENTS ||--o{ PHI_ACCESS_LOGS : "bị truy cập"
    PATIENTS ||--o| PATIENT_PORTAL_ACCOUNTS : "có"
    USERS ||--o{ APPOINTMENTS : "là bác sĩ"
    USERS ||--o{ PRESCRIPTIONS : "kê đơn"
    APPOINTMENTS ||--o{ APPOINTMENT_NOTES : "có"
    APPOINTMENTS ||--o{ APPOINTMENT_REMINDERS : "gửi"
    PATIENT_PORTAL_ACCOUNTS ||--o{ PATIENT_PORTAL_SESSIONS : "có"
    ICD10_CODES ||..o{ PATIENT_MEDICAL_HISTORY : "mã (ref)"
    ENCOUNTERS ||..o{ PRESCRIPTIONS : "kê từ bệnh án (Miền 4)"
    ENCOUNTERS ||..o{ CLINICAL_PHOTOS : "gắn lượt khám (Miền 4)"

    PATIENTS {
        uuid id PK; text mrn UK
        bytea first_name_enc "🔒"; bytea last_name_enc "🔒"; text name_search_hash
        bytea dob_enc "🔒"; text gender
        bytea email_enc "🔒"; text email_search_hash
        bytea phone_enc "🔒"; text phone_search_hash
        bytea insurance_id_enc "🔒"; bytea address_enc "🔒"; bytea zalo_id_enc "🔒"
        uuid dek_id FK; text status; text dklink_patient_id "UK khi set"
        timestamptz deleted_at; timestamptz purged_at "DEK shredded"
    }
    PATIENT_CONTACTS { uuid id PK; uuid patient_id FK; text contact_type; bytea name_enc "🔒"; bytea value_enc "🔒"; bytea relationship_enc "🔒"; bool is_primary }
    PATIENT_ALLERGIES { uuid id PK; uuid patient_id FK; text allergy_name; text reaction; text severity; bytea notes_enc "🔒"; uuid recorded_by FK }
    PATIENT_MEDICAL_HISTORY { uuid id PK; uuid patient_id FK; text condition; text icd10_code; text status; bytea notes_enc "🔒"; date onset_date; uuid recorded_by FK }
    PATIENT_CONSENTS { uuid id PK; uuid patient_id FK; text consent_type; bool granted; text document_version; timestamptz granted_at; timestamptz revoked_at; uuid witnessed_by FK }
    APPOINTMENTS {
        uuid id PK; uuid patient_id FK; uuid doctor_id FK; uuid branch_id FK
        text source; timestamptz scheduled_start; timestamptz scheduled_end; text room; text status
        bytea reason_enc "🔒"; bytea cancel_reason_enc "🔒"
        timestamptz checked_in_at; timestamptz completed_at; timestamptz cancelled_at
    }
    APPOINTMENT_NOTES { uuid id PK; uuid appointment_id FK; bytea note_enc "🔒"; uuid author_id FK }
    APPOINTMENT_REMINDERS { uuid id PK; uuid appointment_id FK; text channel; timestamptz scheduled_for; timestamptz sent_at; text status; int attempts }
    PRESCRIPTIONS {
        uuid id PK; uuid patient_id FK; uuid encounter_id FK; uuid prescriber_id FK
        text medication; text rxnorm_code; text dosage; text frequency; int duration_days; text quantity
        bytea instructions_enc "🔒"; text status; timestamptz prescribed_at; timestamptz expires_at
    }
    DOCUMENTS { uuid id PK; uuid patient_id FK; bytea file_name_enc "🔒"; text mime_type; bigint size_bytes; text storage_key; bytea file_dek_enc "🔒"; text sha256; uuid uploaded_by FK; timestamptz deleted_at }
    CLINICAL_PHOTOS { uuid id PK; uuid patient_id FK; uuid encounter_id FK; text category; text body_area; bytea caption_enc "🔒"; date taken_at; text mime_type; bigint size_bytes; uuid storage_key UK; bytea file_dek_enc "🔒"; text sha256; uuid uploaded_by FK; timestamptz deleted_at }
    PHI_ACCESS_LOGS { uuid id PK; uuid request_id; uuid patient_id FK; uuid accessed_by FK; text access_type; text_array fields_accessed; text purpose; inet ip_address }
    PATIENT_PORTAL_ACCOUNTS { uuid id PK; uuid patient_id FK; text login_email_hash; text password_hash; text status; bool must_change_password }
    PATIENT_PORTAL_SESSIONS { uuid id PK; uuid portal_account_id FK; text refresh_token_hash; timestamptz expires_at; timestamptz revoked_at }
    ICD10_CODES { text code PK; text name; text search }
```

## Miền 3 — Gắn kết: thông báo · phác đồ · marketing/CSKH · khảo sát · chi tiêu

```mermaid
erDiagram
    PATIENTS ||--o{ NOTIFICATIONS : "nhận"
    PATIENTS ||--o{ TREATMENT_PLANS : "có"
    PATIENTS ||--o{ POST_TREATMENT_CARE : "được chăm sóc"
    PATIENTS ||--o{ CAMPAIGN_RECIPIENTS : "trong chiến dịch"
    PATIENTS ||--o{ SURVEY_INVITATIONS : "được mời"
    PATIENTS ||--o{ SURVEY_RESPONSES : "trả lời"
    PATIENTS ||--o{ PATIENT_TRANSACTIONS : "chi tiêu"
    NOTIFICATION_TEMPLATES ||..o{ NOTIFICATIONS : "mẫu (kind/channel)"
    NOTIFICATIONS ||--o{ NOTIFICATION_LOGS : "có"
    TREATMENT_PLAN_TEMPLATES ||--o{ TREATMENT_PLAN_TEMPLATE_STEPS : "gồm"
    TREATMENT_PLAN_TEMPLATES ||--o{ TREATMENT_PLANS : "khởi tạo"
    TREATMENT_PLANS ||--o{ TREATMENT_STEPS : "gồm"
    TREATMENT_STEPS ||--o| APPOINTMENTS : "gắn (0..1)"
    CUSTOMER_SEGMENTS ||--o{ CAMPAIGNS : "nhắm"
    CAMPAIGNS ||--o{ CAMPAIGN_RECIPIENTS : "gửi"
    CAMPAIGN_RECIPIENTS ||--o| NOTIFICATIONS : "qua"
    SURVEYS ||--o{ SURVEY_INVITATIONS : "phát"
    SURVEYS ||--o{ SURVEY_RESPONSES : "thu"
    SURVEY_INVITATIONS ||--o| SURVEY_RESPONSES : "sinh"

    NOTIFICATION_TEMPLATES { uuid id PK; text code; text kind; text channel; text content; text zalo_template_id; bool active }
    NOTIFICATIONS { uuid id PK; uuid patient_id FK; text kind; text status; text channel_sent; text provider_message_id; timestamptz scheduled_at; text related_type; uuid related_id }
    NOTIFICATION_LOGS { uuid id PK; uuid notification_id FK; text channel; text event; timestamptz at }
    TREATMENT_PLAN_TEMPLATES { uuid id PK; text code; text name; text condition; bool active }
    TREATMENT_PLAN_TEMPLATE_STEPS { uuid id PK; uuid template_id FK; int step_order; text title; numeric estimated_cost }
    TREATMENT_PLANS { uuid id PK; uuid patient_id FK; uuid doctor_id FK; uuid template_id FK; bytea title_enc "🔒"; text status; numeric total_cost; uuid approved_by FK }
    TREATMENT_STEPS { uuid id PK; uuid treatment_plan_id FK; int step_order; bytea title_enc "🔒"; bytea description_enc "🔒"; numeric cost; text status; uuid appointment_id FK }
    CUSTOMER_SEGMENTS { uuid id PK; text name; jsonb criteria "non-PHI"; bool active }
    CAMPAIGNS { uuid id PK; text name; uuid segment_id FK; text kind; text message; text status; timestamptz scheduled_at }
    CAMPAIGN_RECIPIENTS { uuid id PK; uuid campaign_id FK; uuid patient_id FK; uuid notification_id FK; text status }
    POST_TREATMENT_CARE { uuid id PK; uuid patient_id FK; uuid treatment_plan_id FK; text care_type; text status; timestamptz scheduled_at; uuid notification_id FK }
    SURVEYS { uuid id PK; text name; text type; jsonb questions; text status }
    SURVEY_INVITATIONS { uuid id PK; uuid survey_id FK; uuid patient_id FK; uuid appointment_id FK; uuid doctor_id FK; text token_hash; text status }
    SURVEY_RESPONSES { uuid id PK; uuid survey_id FK; uuid invitation_id FK; uuid patient_id FK; int score; bytea answers_enc "🔒"; bytea comment_enc "🔒"; bool is_negative }
    PATIENT_TRANSACTIONS { uuid id PK; uuid patient_id FK; timestamptz occurred_at; numeric amount; text category; bytea note_enc "🔒"; text source; timestamptz deleted_at }
    SPENDING_TIERS { text code PK; text name; numeric min_total; int sort }
```

## Miền 4 — Clinic-ops (opt-in, B3): chi nhánh · đặt lịch · POS · bệnh án

```mermaid
erDiagram
    BRANCHES ||--o{ USER_BRANCHES : "phân công"
    USERS ||--o{ USER_BRANCHES : "làm tại"
    BRANCHES ||--o{ APPOINTMENTS : "tại"
    BRANCHES ||--o{ BOOKING_REQUESTS : "nhận"
    BOOKING_REQUESTS ||--o| APPOINTMENTS : "xác nhận → tạo"
    BRANCHES ||--o{ SERVICES : "cung cấp"
    BRANCHES ||--o{ ORDERS : "lập tại"
    PATIENTS ||--o{ ORDERS : "của"
    APPOINTMENTS ||--o| ORDERS : "gắn (0..1)"
    ORDERS ||--o{ ORDER_LINES : "gồm"
    ORDERS ||--o{ PAYMENTS : "thu"
    ORDERS ||--o| CUSTOMER_PACKAGES : "sinh thẻ"
    PACKAGES ||--o{ CUSTOMER_PACKAGES : "mẫu gói"
    PATIENTS ||--o{ CUSTOMER_PACKAGES : "sở hữu thẻ"
    SERVICES ||..o{ ORDER_LINES : "ref_id (service)"
    PACKAGES ||..o{ ORDER_LINES : "ref_id (package)"
    BRANCHES ||--o{ ENCOUNTERS : "khám tại"
    PATIENTS ||--o{ ENCOUNTERS : "có bệnh án"
    USERS ||--o{ ENCOUNTERS : "bác sĩ khám"
    APPOINTMENTS ||--o| ENCOUNTERS : "sinh (0..1)"
    ICD10_CODES ||..o{ ENCOUNTERS : "chẩn đoán (ref)"
    ENCOUNTERS ||--o{ ENCOUNTER_VERSIONS : "bản bổ sung"
    ENCOUNTERS ||--o{ PRESCRIPTIONS : "kê đơn (Miền 2)"
    ENCOUNTERS ||--o{ CLINICAL_PHOTOS : "ảnh (Miền 2)"

    BRANCHES {
        uuid id PK; text code UK; text name; text address; text phone
        int geo_radius_m; jsonb opening_hours; jsonb holidays; int slot_capacity
        bool is_default "UK khi true"; bool active
    }
    USER_BRANCHES { uuid user_id PK_FK; uuid branch_id PK_FK }
    BOOKING_REQUESTS {
        uuid id PK; uuid branch_id FK; timestamptz requested_start; timestamptz requested_end
        text full_name "plaintext (staff-only)"; text phone "plaintext"; text note
        text status "pending|confirmed|rejected"; text source; uuid confirmed_appointment_id FK
        text reject_reason; uuid handled_by FK; timestamptz handled_at
    }
    SERVICES { uuid id PK; uuid branch_id FK "null=dùng chung"; text code; text name; text category; bigint price_vnd; bool active }
    PACKAGES { uuid id PK; text name; text unit "session|shot"; int qty; bigint price_vnd; int validity_days; bool active }
    ORDERS {
        uuid id PK; text code UK "DH-000001"; uuid branch_id FK; uuid patient_id FK; uuid appointment_id FK
        text status "draft|unpaid|partial|paid|cancelled"; bigint total_vnd; text note; uuid created_by FK
    }
    ORDER_LINES {
        uuid id PK; uuid order_id FK; text kind "service|package|other"; uuid ref_id "soft ref (no FK)"
        text name "chụp lúc bán"; int qty; bigint unit_price_vnd; bigint discount_vnd; bigint amount_vnd
    }
    PAYMENTS { uuid id PK; uuid order_id FK; text method "cash|transfer|card|prepaid|other"; bigint amount_vnd; uuid received_by FK; timestamptz paid_at }
    CUSTOMER_PACKAGES { uuid id PK; uuid patient_id FK; uuid package_id FK; uuid order_id FK; text name; int total; int used; date expires_at }
    ENCOUNTERS {
        uuid id PK; uuid branch_id FK; uuid patient_id FK; uuid appointment_id FK; uuid doctor_id FK
        bytea reason_enc "🔒"; bytea history_enc "🔒"; bytea past_personal_enc "🔒"; bytea past_family_enc "🔒"
        jsonb vitals "non-PHI sinh hiệu"; bytea exam_general_enc "🔒"; bytea exam_organs_enc "🔒"
        bytea labs_summary_enc "🔒"; bytea treatment_enc "🔒"; bytea dx_note_enc "🔒"
        text dx_primary_icd10 FK; text_array dx_secondary_icd10; date treatment_from; date treatment_to
        text status "draft|signed|amended"; timestamptz signed_at; uuid signed_by FK; bool locked
    }
    ENCOUNTER_VERSIONS { uuid id PK; uuid encounter_id FK; int version; bytea snapshot_enc "🔒"; uuid changed_by FK; text change_reason }
```

`SPENDING_TIERS`, `ICD10_CODES`, `SERVICES`, `PACKAGES` là **bảng danh mục/cấu hình**
(`BRANCHES` nửa danh mục, nửa thực thể vận hành). `ROLE_PERMISSIONS` và `USER_BRANCHES` là
**bảng nối** PK ghép (không có `id`/`created_at`).

## Ghi chú thiết kế

### `name_search_hash` / `email_search_hash` / `icd10_codes.search`
Cột mã hoá không `LIKE`/index được. Lưu thêm HMAC-SHA256 (khoá riêng) của giá trị đã chuẩn
hoá (lowercase, bỏ dấu) để **tìm chính xác**. Danh mục ICD-10 cũng có cột `search` không dấu
cho combobox gợi ý. Tìm mờ: giải mã theo trang trên tập đã lọc.

### `dek_id` ở mức bệnh nhân → crypto-shredding
Mỗi bệnh nhân một DEK, wrap bởi KEK trong KMS. Xoá DEK (`purged_at`) = **crypto-shredding**,
đạt "secure deletion" (HIPAA/PDPL) không cần ghi đè vật lý. Mọi PHI của bệnh nhân — kể cả
bệnh án (`encounters.*_enc`), chú thích ảnh (`clinical_photos.caption_enc`) và per-file DEK
(`documents`/`clinical_photos.file_dek_enc`) — mã hoá bằng DEK này nên cùng bị shred.

### `audit_logs` hash-chain
`entry_hash = SHA256(prev_hash || canonical_json(entry))`. Sửa/xoá một dòng bằng quyền DB
sẽ làm đứt chuỗi; job kiểm tra hằng ngày phát hiện. Ghi audit bọc trong
`pg_advisory_xact_lock` để các transaction không đan xen làm hỏng chuỗi.

### Partition theo thời gian
`audit_logs` và `phi_access_logs` partition theo thời gian → PRIMARY KEY phải chứa cột
partition: `(id, created_at)` / `(id, accessed_at)`.

### Bệnh án ngoại trú (`encounters`) + đơn thuốc
Mốc 1 (B3) đã bật module clinic-ops: `prescriptions.encounter_id` (nullable, `ON DELETE SET
NULL`) gắn đơn thuốc với lượt khám khi kê ngay trong bệnh án; đơn nhắc tái khám vẫn gắn trực
tiếp bệnh nhân (`encounter_id` null). Bệnh án theo mẫu **15/BV-01** (TT 32/2023/TT-BYT): phần
hành chính lấy từ hồ sơ bệnh nhân (không lưu lại), các trường lâm sàng mã hoá field-level,
mã ICD-10 để plaintext cho thống kê/segment. Hoàn tất = `signed` + `locked`; sửa sau khoá →
bản `amended`, snapshot ciphertext bản cũ lưu ở `encounter_versions`.

### POS / gói (`orders`)
Tiền = `bigint` VND (đồng nguyên, không cent). Một `orders` gồm nhiều `order_lines`
(dịch vụ/gói/nhập tay) và thu bằng nhiều `payments` → cho thu một phần (status `partial` =
công nợ). `order_lines.ref_id` là **soft reference** tới `services.id`/`packages.id` theo
`kind` (không có FK để `name`/giá chụp tại thời điểm bán không vỡ khi danh mục đổi). Mua gói
đã thanh toán → sinh `customer_packages` (thẻ buổi, `total`/`used`).

### Đặt lịch online (`booking_requests`)
Public **không** ghi thẳng vào bảng PHI: ghi staging `booking_requests` (tên/SĐT plaintext,
staff-only). Lễ tân xác nhận → tạo/khớp bệnh nhân + lịch hẹn, set `confirmed_appointment_id`.
`appointments.source` (`prebooked|phone|online|walkin`) đánh dấu nguồn.

### Soft delete
`patients`, `patient_transactions`, `documents`, `clinical_photos` có `deleted_at`.
`audit_logs`/`phi_access_logs` **không bao giờ** xoá. Hard delete chỉ qua thủ tục retention có
phê duyệt, ghi trong audit.

### Tích hợp DK-link
`patients.dklink_patient_id` (unique khi set) liên kết 1-1 với bệnh nhân bên DK-link; webhook
upsert idempotent, `created_by` = user hệ thống `dklink-integration@system.local`.
