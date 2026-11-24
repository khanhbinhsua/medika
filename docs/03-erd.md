# 03 · Entity-Relationship Diagram

Ký hiệu: 🔒 = cột được mã hoá field-level (ciphertext trong DB).

## Sơ đồ tổng

```mermaid
erDiagram
    ROLES ||--o{ USERS : "gán"
    USERS ||--o{ SESSIONS : "có"
    USERS ||--o| MFA_SECRETS : "có"
    USERS ||--o{ AUDIT_LOGS : "thực hiện"
    USERS ||--o{ PHI_ACCESS_LOGS : "truy cập"
    ROLES ||--o{ ROLE_PERMISSIONS : "có"
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "thuộc"

    PATIENTS ||--o{ PATIENT_CONTACTS : "có"
    PATIENTS ||--o{ PATIENT_ALLERGIES : "có"
    PATIENTS ||--o{ PATIENT_MEDICAL_HISTORY : "có"
    PATIENTS ||--o{ PATIENT_CONSENTS : "ký"
    PATIENTS ||--o{ APPOINTMENTS : "đặt"
    PATIENTS ||--o{ MEDICAL_RECORDS : "sở hữu"
    PATIENTS ||--o{ PRESCRIPTIONS : "được kê"
    PATIENTS ||--o{ LAB_RESULTS : "có"
    PATIENTS ||--o{ DOCUMENTS : "đính kèm"
    PATIENTS ||--o{ PHI_ACCESS_LOGS : "bị truy cập"

    USERS ||--o{ APPOINTMENTS : "là bác sĩ"
    APPOINTMENTS ||--o{ APPOINTMENT_NOTES : "có"
    APPOINTMENTS ||--o| MEDICAL_RECORDS : "sinh ra"
    APPOINTMENTS ||--o{ APPOINTMENT_REMINDERS : "gửi"
    PATIENTS ||--o{ WAITLIST : "chờ"

    MEDICAL_RECORDS ||--o{ MEDICAL_RECORD_VERSIONS : "lịch sử"
    MEDICAL_RECORDS ||--o{ DOCUMENTS : "đính kèm"
    USERS ||--o{ MEDICAL_RECORDS : "là provider"
    USERS ||--o{ PRESCRIPTIONS : "kê đơn"

    ENCRYPTION_KEYS ||--o{ PATIENTS : "wrap DEK"

    USERS {
        uuid id PK
        citext email UK
        text password_hash
        text full_name
        uuid role_id FK
        text status
        bool mfa_enabled
        int failed_login_attempts
        timestamptz locked_until
        timestamptz password_changed_at
        timestamptz created_at
        timestamptz updated_at
    }

    ROLES {
        uuid id PK
        text name UK
        text description
    }

    PERMISSIONS {
        uuid id PK
        text code UK
        text description
    }

    ROLE_PERMISSIONS {
        uuid role_id PK_FK
        uuid permission_id PK_FK
    }

    SESSIONS {
        uuid id PK
        uuid user_id FK
        text refresh_token_hash UK
        inet ip_address
        text user_agent
        timestamptz last_activity_at
        timestamptz expires_at
        timestamptz revoked_at
    }

    MFA_SECRETS {
        uuid user_id PK_FK
        bytea secret_encrypted "🔒"
        text_array recovery_codes_hashed
        timestamptz confirmed_at
    }

    PATIENTS {
        uuid id PK
        text mrn UK "mã hồ sơ nội bộ"
        bytea first_name_enc "🔒"
        bytea last_name_enc "🔒"
        text name_search_hash "HMAC để tìm kiếm"
        bytea dob_enc "🔒"
        text gender
        bytea email_enc "🔒"
        text email_search_hash
        bytea phone_enc "🔒"
        bytea insurance_id_enc "🔒"
        bytea address_enc "🔒"
        uuid dek_id FK
        text status
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    PATIENT_CONTACTS {
        uuid id PK
        uuid patient_id FK
        text contact_type
        bytea value_enc "🔒"
        bytea relationship_enc "🔒"
        bool is_primary
    }

    PATIENT_ALLERGIES {
        uuid id PK
        uuid patient_id FK
        text allergy_name
        text reaction
        text severity
        timestamptz recorded_at
        uuid recorded_by FK
    }

    PATIENT_MEDICAL_HISTORY {
        uuid id PK
        uuid patient_id FK
        text condition
        text icd10_code
        text status
        bytea notes_enc "🔒"
        date onset_date
        uuid recorded_by FK
    }

    PATIENT_CONSENTS {
        uuid id PK
        uuid patient_id FK
        text consent_type
        bool granted
        text document_version
        timestamptz granted_at
        timestamptz revoked_at
        uuid witnessed_by FK
    }

    APPOINTMENTS {
        uuid id PK
        uuid patient_id FK
        uuid doctor_id FK
        timestamptz scheduled_start
        timestamptz scheduled_end
        text room
        text status
        text reason
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    APPOINTMENT_NOTES {
        uuid id PK
        uuid appointment_id FK
        bytea note_enc "🔒"
        uuid author_id FK
        timestamptz created_at
    }

    APPOINTMENT_REMINDERS {
        uuid id PK
        uuid appointment_id FK
        text channel
        timestamptz scheduled_for
        timestamptz sent_at
        text status
    }

    WAITLIST {
        uuid id PK
        uuid patient_id FK
        uuid doctor_id FK
        text preferred_window
        int priority
        text status
        timestamptz created_at
    }

    MEDICAL_RECORDS {
        uuid id PK
        uuid patient_id FK
        uuid appointment_id FK
        uuid provider_id FK
        text record_type
        bytea content_enc "🔒"
        text icd10_code
        int version
        timestamptz record_date
        timestamptz created_at
        timestamptz updated_at
    }

    MEDICAL_RECORD_VERSIONS {
        uuid id PK
        uuid record_id FK
        int version
        bytea content_enc "🔒"
        uuid changed_by FK
        text change_reason
        timestamptz created_at
    }

    PRESCRIPTIONS {
        uuid id PK
        uuid patient_id FK
        uuid record_id FK
        uuid prescriber_id FK
        text medication
        text dosage
        text frequency
        int duration_days
        bytea instructions_enc "🔒"
        text status
        timestamptz prescribed_at
    }

    LAB_RESULTS {
        uuid id PK
        uuid patient_id FK
        uuid record_id FK
        text test_name
        text loinc_code
        bytea result_value_enc "🔒"
        text reference_range
        text abnormal_flag
        timestamptz test_date
        timestamptz received_at
    }

    DOCUMENTS {
        uuid id PK
        uuid patient_id FK
        uuid record_id FK
        text file_name
        text mime_type
        bigint size_bytes
        text storage_key
        bytea file_dek_enc "🔒"
        text sha256
        uuid uploaded_by FK
        timestamptz created_at
    }

    AUDIT_LOGS {
        bigserial id PK
        uuid request_id
        uuid actor_id FK
        text action
        text entity_type
        uuid entity_id
        jsonb changes
        inet ip_address
        text user_agent
        text outcome
        text prev_hash
        text entry_hash
        timestamptz created_at
    }

    PHI_ACCESS_LOGS {
        bigserial id PK
        uuid request_id
        uuid patient_id FK
        uuid accessed_by FK
        text_array fields_accessed
        text purpose
        inet ip_address
        timestamptz accessed_at
    }

    ENCRYPTION_KEYS {
        uuid id PK
        text key_type
        bytea wrapped_dek
        text kek_reference
        int version
        text status
        timestamptz created_at
        timestamptz rotated_at
    }
```

## Ghi chú thiết kế

### Vì sao có `name_search_hash` / `email_search_hash`
Cột mã hoá không thể `LIKE` hay index B-tree. Ta lưu thêm HMAC-SHA256 (khoá riêng, không phải khoá mã hoá) của giá trị đã chuẩn hoá (lowercase, bỏ dấu) để hỗ trợ **tìm kiếm chính xác**. Tìm kiếm mờ (fuzzy) sẽ giải quyết ở Phase 2 bằng cách giải mã theo trang trên tập đã lọc — chấp nhận đánh đổi hiệu năng để giữ bảo mật.

### Vì sao `dek_id` ở mức bệnh nhân
Mỗi bệnh nhân có một DEK (Data Encryption Key) riêng, được wrap bởi KEK trong KMS. Lợi ích: xoá DEK = **crypto-shredding**, thoả yêu cầu "secure deletion" của HIPAA mà không cần ghi đè vật lý.

### Vì sao tách `MEDICAL_RECORD_VERSIONS`
HIPAA yêu cầu truy vết thay đổi hồ sơ y tế. Bảng chính giữ phiên bản hiện tại; mỗi lần sửa đẩy bản cũ sang bảng version kèm `change_reason`.

### Vì sao `AUDIT_LOGS` có `prev_hash` / `entry_hash`
Hash chain: `entry_hash = SHA256(prev_hash || canonical_json(entry))`. Nếu ai đó sửa/xoá một dòng bằng quyền DB trực tiếp, chuỗi hash đứt và job kiểm tra hằng ngày sẽ phát hiện. Đây là cách đạt "immutable log" thực tế trên PostgreSQL.

Ghi audit được bọc trong `pg_advisory_xact_lock` để nhiều transaction đồng thời không đan xen và làm hỏng chuỗi.

### Khoá chính của bảng partition
`audit_logs` và `phi_access_logs` partition theo thời gian, mà PostgreSQL bắt buộc mọi PRIMARY KEY / UNIQUE trên bảng partition phải chứa cột partition key. Do đó khoá là `(id, created_at)` và `(entry_hash, created_at)` chứ không phải `(id)` / `(entry_hash)`.

### Soft delete
Chỉ `patients` có `deleted_at` (soft delete cho quy trình hoàn tác). Audit log **không bao giờ** xoá. Hard delete chỉ chạy qua thủ tục retention có phê duyệt, ghi lại trong audit.
