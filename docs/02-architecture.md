# 02 · Kiến Trúc Hệ Thống

## Tổng quan

Kiến trúc **modular monolith**: một tiến trình Node.js duy nhất, chia thành các module theo domain, giao tiếp qua service layer. Với 20 người dùng, microservices là over-engineering — nhưng ranh giới module được giữ rõ để tách sau nếu cần.

```mermaid
flowchart TB
    subgraph Client
        RC["React SPA<br/>(TypeScript + Tailwind)"]
    end

    subgraph Edge
        CF["CloudFront / ALB<br/>TLS 1.2+ termination"]
    end

    subgraph API["API Process (Node.js + Express)"]
        MW["Middleware chain<br/>helmet → cors → rateLimit → auth → rbac → audit"]
        R1["Auth Module"]
        R2["Patient Module"]
        R3["Appointment Module"]
        R4["Medical Record Module"]
        R5["Audit Module"]
        R6["Report Module"]
        CRY["Crypto Service<br/>(AES-256-GCM, envelope enc.)"]
        AUD["Audit Logger<br/>(hash-chained)"]
    end

    subgraph Data
        PG[("PostgreSQL 16<br/>encrypted at rest")]
        S3[("S3 / local<br/>documents SSE-KMS")]
        KMS["AWS KMS<br/>(KEK)"]
    end

    subgraph External
        MAIL["SendGrid<br/>(BAA required)"]
        LOG["CloudWatch"]
    end

    RC -->|HTTPS| CF --> MW
    MW --> R1 & R2 & R3 & R4 & R5 & R6
    R2 & R3 & R4 --> CRY
    R1 & R2 & R3 & R4 & R6 --> AUD
    CRY --> KMS
    AUD --> PG
    R2 & R3 & R4 & R6 --> PG
    R4 --> S3
    R3 --> MAIL
    API --> LOG
```

## Phân lớp (layered)

```
routes/       Định nghĩa HTTP endpoint, gắn middleware, không chứa business logic
  ↓
controllers/  Parse + validate request (Zod), gọi service, format response
  ↓
services/     Business logic, transaction boundary, gọi crypto + audit
  ↓
repositories/ Truy vấn DB (Kysely), không biết gì về HTTP
  ↓
db/           Connection pool, migrations, generated types
```

Quy tắc: lớp trên chỉ gọi lớp ngay dưới. Không có repository nào gọi service.

## Middleware chain (thứ tự bắt buộc)

| # | Middleware | Vai trò |
|---|---|---|
| 1 | `requestId` | Gán UUID cho mỗi request, dùng xuyên suốt log + audit |
| 2 | `helmet` | Security headers (HSTS, CSP, noSniff) |
| 3 | `cors` | Allowlist origin cụ thể, không dùng `*` |
| 4 | `express.json({ limit })` | Giới hạn body 1MB (upload đi route riêng) |
| 5 | `httpLogger` (pino) | Log request, **redact** field PHI |
| 6 | `rateLimit` | Global 100 req/15min; `/auth/login` 5 req/15min |
| 7 | `authenticate` | Verify JWT, nạp `req.user` |
| 8 | `enforceSessionTimeout` | Kiểm tra idle 30 phút |
| 9 | `authorize(permission)` | RBAC theo permission |
| 10 | `auditAccess` | Ghi audit log sau khi response hoàn tất |
| 11 | `errorHandler` | Chuẩn hoá lỗi, **không leak** stack/PHI ra client |

## Luồng nghiệp vụ chính

### Đăng nhập có MFA

```mermaid
sequenceDiagram
    participant U as User
    participant F as React SPA
    participant A as Auth Module
    participant D as PostgreSQL
    participant L as Audit Logger

    U->>F: email + password
    F->>A: POST /auth/login
    A->>D: lấy user + password_hash
    A->>A: argon2.verify()
    alt sai mật khẩu
        A->>L: LOGIN_FAILED (tăng failed_attempts)
        A-->>F: 401
    else đúng, mfa_enabled
        A-->>F: 200 { mfaRequired, mfaToken (5 phút) }
        U->>F: mã TOTP 6 số
        F->>A: POST /auth/mfa/verify
        A->>A: otplib.verify()
        A->>D: tạo session + refresh token
        A->>L: LOGIN_SUCCESS
        A-->>F: accessToken (15p) + refreshToken (httpOnly cookie)
    end
```

### Đọc hồ sơ bệnh nhân (giải mã)

```mermaid
sequenceDiagram
    participant F as React SPA
    participant C as Patient Controller
    participant S as Patient Service
    participant Y as Crypto Service
    participant D as PostgreSQL
    participant L as Audit Logger

    F->>C: GET /patients/:id (Bearer token)
    C->>C: authorize('patient:read')
    C->>S: getPatient(id, actor)
    S->>D: SELECT ... encrypted columns
    S->>Y: decryptFields(row, dek)
    Y->>Y: unwrap DEK bằng KEK (KMS)
    Y-->>S: plaintext fields
    S->>L: PHI_ACCESS { patientId, actorId, fields }
    S-->>C: Patient DTO
    C-->>F: 200 JSON
```

## Ranh giới module

| Module | Sở hữu bảng | Phụ thuộc |
|---|---|---|
| auth | `users`, `sessions`, `refresh_tokens`, `mfa_secrets` | crypto, audit |
| patient | `patients`, `patient_contacts`, `patient_allergies`, `patient_medical_history`, `patient_consents` | crypto, audit |
| appointment | `appointments`, `appointment_notes`, `waitlist` | patient (read-only), audit |
| medical-record | `medical_records`, `prescriptions`, `lab_results`, `documents` | patient (read-only), crypto, audit |
| audit | `audit_logs`, `phi_access_logs` | — (không phụ thuộc module nào) |
| report | đọc từ view, không sở hữu bảng | patient, appointment, audit |

## Nguyên tắc bất biến

1. **Mọi truy cập PHI phải ghi audit log** — không có đường tắt, kể cả admin.
2. **Không log PHI vào application log** — pino redact list bắt buộc.
3. **Không trả stack trace ra client** ở bất kỳ môi trường nào.
4. **Mọi mutation chạy trong transaction** cùng với audit log entry.
5. **Frontend không bao giờ giữ khoá giải mã** — kiến trúc là server-side field encryption.
