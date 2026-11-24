# Triển khai & Vận hành (Phase 5)

## Tổng quan kiến trúc production (AWS, HIPAA-eligible)

```
                    ┌─────────────┐
   Người dùng ──────► CloudFront  │  (TLS, WAF, chống DDoS)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │     ALB     │  (TLS termination, health check)
                    └──────┬──────┘
              ┌────────────┼────────────┐
        ┌─────▼─────┐              ┌─────▼─────┐
        │ Frontend  │              │  Backend  │  ECS Fargate
        │ (nginx)   │              │ (Node)    │  (2+ task, multi-AZ)
        └───────────┘              └─────┬─────┘
                          ┌──────────────┼──────────────┐
                    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
                    │    RDS    │  │    KMS    │  │    S3     │
                    │ Postgres  │  │  (KEK)    │  │ (tài liệu)│
                    │ Multi-AZ  │  │           │  │ SSE-KMS   │
                    └───────────┘  └───────────┘  └───────────┘
```

**Yêu cầu BAA**: ký Business Associate Agreement với AWS trước khi đưa PHI lên. Chỉ dùng dịch vụ nằm trong danh sách HIPAA-eligible của AWS (ECS, RDS, KMS, S3, CloudFront, ALB đều có).

## Điều đã có sẵn (code hoàn chỉnh, kiểm chứng tại chỗ)

| Thành phần | File | Trạng thái |
|---|---|---|
| Image backend production | `backend/Dockerfile` (4 stage) | ✅ build + boot + healthcheck kiểm chứng bằng compose |
| Image frontend (nginx) | `frontend/Dockerfile` + `nginx.conf` | ✅ phục vụ SPA + proxy `/api`, kiểm chứng |
| Compose kiểm chứng image | `docker-compose.prod.yml` | ✅ chạy full stack tại chỗ |
| KEK qua AWS KMS | `src/crypto/kek-provider.ts` (`AwsKmsKekProvider`) | ✅ code thật (@aws-sdk/client-kms), chưa test với KMS thật |
| Lưu tài liệu qua S3 | `src/storage/storage-provider.ts` (`S3StorageProvider`) | ✅ code thật (@aws-sdk/client-s3), SSE-KMS |
| CI/CD | `.github/workflows/ci.yml` | ✅ lint + typecheck + unit + 8 bộ smoke (Postgres thật) + build image |
| Migration khi deploy | `backend/Dockerfile` stage `migrate` | ✅ chạy `node-pg-migrate up` |
| Sao lưu / khôi phục | `docs/08-backup-recovery.md` | ✅ (production dùng RDS automated backup + PITR) |

> **Chưa làm** (cần tài khoản AWS + hạ tầng thật): Terraform/CDK dựng RDS/ECS/KMS/S3, cấu hình ALB/CloudFront/WAF, secrets trong Secrets Manager. Đây là việc thao tác trên tài khoản AWS của tổ chức, không thể kiểm chứng từ máy dev.

## Phương án tự host trên VPS (Việt Nam) — thay thế AWS

Nếu triển khai trên VPS trong nước (ví dụ phục vụ bệnh nhân Việt Nam, tuân theo **Nghị định 13/2023/NĐ-CP** thay vì HIPAA — xem lưu ý cuối tài liệu), mỗi dịch vụ AWS có bản self-host tương đương. **App không đổi dòng code nào** — chỉ đổi provider qua biến môi trường:

| Vai trò | AWS | Self-host trên VPS | Provider trong code |
|---|---|---|---|
| Quản lý khoá gốc (KEK) | KMS | **HashiCorp Vault** (Transit engine) | `KEK_PROVIDER=vault` |
| Lưu tài liệu | S3 | **MinIO** (S3-compatible) | `STORAGE_PROVIDER=s3` + `STORAGE_S3_ENDPOINT` |
| Database | RDS | PostgreSQL container (+ backup/replica tự quản) | — |
| TLS / reverse proxy | ALB/CloudFront | Caddy hoặc nginx + Let's Encrypt | — |
| Giám sát | CloudWatch | Prometheus + Grafana + Loki | — |

**Điểm mấu chốt — khoá gốc vẫn không nằm cạnh dữ liệu**: `env.ts` chặn `KEK_PROVIDER=local` ở production; Vault Transit giữ khoá gốc TRONG Vault y như KMS giữ trong HSM. App chỉ gửi DEK vào để wrap và nhận `vault:v1:...` về. Đây là điều khiến VPS đạt được *tinh thần* của yêu cầu quản lý khoá, không chỉ "mã hoá cho có".

### Đã kiểm chứng tại chỗ (chạy thật, không phải sơ đồ)

`docker-compose.vps.yml` dựng full stack self-host và đã chạy thử end-to-end:

- **`VaultKekProvider`** (`src/crypto/kek-provider.ts`): test với Vault Transit thật — wrap/unwrap DEK, mã hoá field qua DEK, IV ngẫu nhiên: **8/8** (`scripts/test-vault-kek.mjs`).
- **Full stack production**: backend chạy `NODE_ENV=production` + Vault + MinIO (**vượt qua guard bảo mật thật**, không hạ NODE_ENV để lách). Tạo bệnh nhân → DEK wrap qua Vault → lưu → đọc lại unwrap qua Vault → giải mã đúng tên. Upload tài liệu → mã hoá → lưu MinIO → tải về → khớp gốc. **7/7**, và xác nhận object trong MinIO là ciphertext (không có plaintext).

```bash
# Chuẩn bị Vault (một lần):
vault secrets enable transit
vault write -f transit/keys/crm-dk-kek

# Chạy thử full stack self-host:
docker compose -f docker-compose.vps.yml up -d   # gồm cả vault-init + minio-init
```

### Việc còn phải làm cho VPS production thật

- **Vault AppRole** — **ĐÃ LÀM (app code)**: `VaultKekProvider` hỗ trợ đăng nhập AppRole (role-id + secret-id → token ngắn hạn, tự làm mới, cache). Kiểm chứng thật: wrap/unwrap DEK qua token AppRole (`npm run test:vault-approle`, 4/4), và token bị policy least-privilege chặn mọi thứ ngoài encrypt/decrypt trên đúng khoá (đọc/tạo khoá, xem hệ thống đều 403). Còn lại là **vận hành Vault** (không phải app code): chạy chế độ production (không dev-mode), init + unseal đúng cách (auto-unseal bằng khoá cloud/HSM/transit), bật audit log của Vault. Thiết lập AppRole một lần:
  ```bash
  vault auth enable approle
  vault policy write crm-dk-kek - <<EOF
  path "transit/encrypt/crm-dk-kek" { capabilities = ["update"] }
  path "transit/decrypt/crm-dk-kek" { capabilities = ["update"] }
  EOF
  vault write auth/approle/role/crm-dk token_policies=crm-dk-kek token_ttl=1h token_max_ttl=4h
  vault read auth/approle/role/crm-dk/role-id            # → VAULT_ROLE_ID
  vault write -f auth/approle/role/crm-dk/secret-id      # → VAULT_SECRET_ID
  ```
- **Ổ đĩa VPS mã hoá toàn phần** (LUKS) — bảo vệ dữ liệu lúc nghỉ ở tầng OS.
- ~~Backup mã hoá + off-site~~ — **ĐÃ LÀM**: `BACKUP_ENCRYPTION_KEY` (AES-256-GCM) + `BACKUP_S3_*` đẩy lên MinIO/S3, kiểm chứng end-to-end (backup → mã hoá → off-site → restore → verify chuỗi hash). Chỉ cần đặt lịch cron.
- **PostgreSQL replica + WAL archiving** — **ĐÃ LÀM (kiểm chứng)**: `docker-compose.replica.yml` dựng primary + **hot standby streaming replication** + WAL archiving cho PITR. Kiểm chứng thật: replica ở chế độ standby (read-only, từ chối ghi), ghi ở primary replicate sang replica (lag ~0.05ms), WAL segment archive tự động (0 lỗi). Đây là bản self-host của RDS Multi-AZ + PITR.
  - **Failover**: khi primary chết, thăng cấp replica bằng `pg_ctl promote` (hoặc `SELECT pg_promote()`), trỏ app sang; dựng lại một replica mới từ primary mới.
  - **PITR**: từ một base backup (`pg_basebackup`) + WAL đã archive, khôi phục tới thời điểm bất kỳ bằng `recovery_target_time` trong `postgresql.auto.conf` + `restore_command` đọc từ kho WAL. Production: đẩy WAL archive off-site (S3/MinIO) như backup.
  - Production khác bản kiểm chứng: `scram-sha-256` thay `trust`, `pg_hba` giới hạn subnet, mật khẩu mạnh, replication slot để primary không xoá WAL replica chưa nhận, TLS giữa primary–replica.
- **Credential mạnh** cho Postgres/MinIO/Vault từ secrets, không hardcode như file compose thử nghiệm.

## Biến môi trường production (bắt buộc)

```bash
NODE_ENV=production
PORT=4100
DATABASE_URL=postgresql://<user>:<pass>@<rds-endpoint>:5432/crm_dk
DATABASE_SSL=true

# Secret — lấy từ AWS Secrets Manager, KHÔNG hardcode
JWT_ACCESS_SECRET=<48+ byte ngẫu nhiên>
SEARCH_HMAC_KEY=<32 byte base64>

# Mã hoá — production BẮT BUỘC KMS (env.ts chặn KEK_PROVIDER=local khi production)
KEK_PROVIDER=aws-kms
KEK_AWS_KMS_ARN=arn:aws:kms:<region>:<account>:key/<key-id>

# Lưu trữ tài liệu
STORAGE_PROVIDER=s3
STORAGE_S3_BUCKET=<bucket-name>

# Email/SMS (dịch vụ đã ký BAA)
SMTP_HOST=<sendgrid/ses host>
SMS_PROVIDER=twilio

CORS_ORIGINS=https://<domain-production>
```

`env.ts` xác thực toàn bộ khi khởi động và **từ chối boot** nếu cấu hình sai (ví dụ `KEK_PROVIDER=local` ở production) — lỗi cấu hình dừng deploy ngay, không âm thầm chạy kém an toàn.

## Quy trình deploy

1. **CI** (`.github/workflows/ci.yml`) chạy trên mỗi PR: lint, typecheck, unit + 8 bộ smoke test trên Postgres thật, npm audit (prod), build image. Merge chỉ khi xanh.
2. **Build & push image** lên ECR (thêm bước push vào CI khi có tài khoản).
3. **Chạy migration** (một lần, trước khi đổi task): `docker run --rm -e DATABASE_URL=... <backend-image>:migrate up` — dùng stage `migrate` của Dockerfile.
4. **Cập nhật ECS service** (rolling deploy, ALB health check `/api/health/ready` phải xanh trước khi nhận traffic).
5. **Xác minh**: `/api/health` (liveness) và `/api/health/ready` (readiness, có kiểm tra kết nối DB).

## Giám sát & cảnh báo

- **Log**: backend ghi JSON ra stdout (production) → CloudWatch Logs / log aggregation. Đã **redact PHI** (xem `logger.ts`): không có body request, query string, hay trường nhạy cảm nào lọt vào log.
- **Health**: ALB target group dùng `/api/health/ready`.
- **Cảnh báo nên đặt**: tỉ lệ 5xx, độ trễ p95, số lần đăng nhập thất bại tăng đột biến, kết quả kiểm tra toàn vẹn chuỗi hash audit (`verifyAuditChain`) khác `valid:true`, và các cảnh báo bất thường từ `/api/audit/anomalies`.
- **Kiểm tra toàn vẹn định kỳ**: lên lịch gọi `verifyAuditChain` hàng ngày; nếu `valid:false` → cảnh báo mức cao nhất (dấu hiệu nhật ký bị giả mạo).

## Công việc nền (cron / EventBridge → ECS task)

| Việc | Lệnh | Tần suất khuyến nghị |
|---|---|---|
| Gửi nhắc lịch | `npm run reminders:dispatch` | 5–15 phút |
| Sao lưu mã hoá + off-site | `npm run backup` (đặt `BACKUP_ENCRYPTION_KEY` + `BACKUP_S3_*`) | Hàng ngày |
| Kiểm tra toàn vẹn audit | gọi `verifyAuditChain` | Hàng ngày |
| Tạo partition audit tháng mới | `npm run audit:partition` | Hàng tháng |

## Checklist trước khi go-live (HIPAA)

- [ ] Ký BAA với AWS và mọi nhà cung cấp chạm PHI (SendGrid/Twilio...)
- [ ] KMS key có key rotation bật, chính sách IAM tối thiểu quyền
- [ ] RDS: mã hoá at-rest bật, Multi-AZ, backup retention ≥ 7 ngày, PITR
- [ ] S3: SSE-KMS, versioning, block public access, cross-region replication
- [ ] TLS 1.2+ mọi nơi (CloudFront, ALB); HSTS đã bật ở backend (`helmet`)
- [ ] Secrets trong Secrets Manager, không có secret trong image/env file commit
- [ ] CloudWatch alarms + log aggregation đã cấu hình
- [ ] Chạy thử khôi phục từ backup (diễn tập DR) — xem `docs/08-backup-recovery.md`
- [ ] Rà soát quyền IAM: ECS task role chỉ có kms:Encrypt/Decrypt lên đúng key, s3 lên đúng bucket
- [ ] Đào tạo nhân viên: tài khoản, MFA, chính sách sử dụng, quy trình sự cố

## Lưu ý pháp lý: HIPAA vs luật Việt Nam

**HIPAA là luật Mỹ**, chỉ ràng buộc cơ sở y tế/bảo hiểm Mỹ và đối tác của họ xử lý dữ liệu bệnh nhân **Mỹ**. Nếu hệ thống phục vụ phòng khám và bệnh nhân **Việt Nam**, HIPAA **không có hiệu lực pháp lý** — nó chỉ là *chuẩn thiết kế bảo mật* mà dự án hướng tới.

- **Luật áp dụng thực tế**: Nghị định 13/2023/NĐ-CP (bảo vệ dữ liệu cá nhân), Luật Khám bệnh chữa bệnh, Luật An toàn thông tin mạng. Nghị định 13 xếp **dữ liệu sức khoẻ vào nhóm "nhạy cảm"** — yêu cầu bảo vệ mạnh, có thể bao gồm lưu trú dữ liệu trong nước.
- **Rào cản BAA**: nếu HIPAA *có* áp dụng (bệnh nhân Mỹ), bắt buộc ký Business Associate Agreement với nhà cung cấp hosting. AWS có BAA; **VPS thông thường không có** → không thể HIPAA-compliant trên VPS cho PHI Mỹ.
- **VPS Việt Nam** phù hợp khi mục tiêu là tuân thủ luật VN (bệnh nhân Việt). Các safeguard "HIPAA" đã xây (mã hoá cấp trường, MFA, RBAC, audit bất biến, crypto-shredding) trở thành *baseline vượt chuẩn* — dùng lại tốt cho tuân thủ Nghị định 13.

> Đây là phân tích kỹ thuật, **không phải tư vấn pháp lý**. Trước khi go-live thật nên hỏi luật sư chuyên về dữ liệu cá nhân để chốt phạm vi tuân thủ.
