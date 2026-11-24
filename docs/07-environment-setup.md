# 07 · Thiết Lập Môi Trường

## Yêu cầu

| Công cụ | Phiên bản |
|---|---|
| Node.js | 20 LTS |
| npm | 10+ |
| Docker Desktop | mới nhất |
| Git | 2.40+ |

## Dev local

### 1. Tạo file cấu hình

```bash
cp .env.example .env
```

### 2. Sinh secret

```bash
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64'));console.log('KEK_LOCAL_KEY='+c.randomBytes(32).toString('base64'));console.log('SEARCH_HMAC_KEY='+c.randomBytes(32).toString('base64'))"
```

Dán ba dòng kết quả vào `.env`.

### 3. Khởi động hạ tầng

```bash
docker compose up -d
```

Postgres ở `localhost:5433`, Mailhog UI ở `http://localhost:8025`.

### 4. Chạy migration

```bash
cd backend && npm install && npm run migrate:up
```

### 5. Chạy backend và frontend

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

Kiểm tra: `curl http://localhost:4100/api/health/ready` phải trả `{"status":"ready","database":"connected"}`.

## Ba môi trường

| | Development | Staging | Production |
|---|---|---|---|
| Hạ tầng | Docker local | AWS (VPC riêng) | AWS (VPC riêng, multi-AZ) |
| Database | Postgres container | RDS t4g.small | RDS t4g.medium, Multi-AZ |
| Dữ liệu | **Chỉ dữ liệu giả** | **Chỉ dữ liệu giả** | PHI thật |
| KEK | `local` (file key) | AWS KMS | AWS KMS (key riêng) |
| TLS | Không (http) | ACM cert | ACM cert + HSTS preload |
| Backup | Không | Hằng ngày, giữ 7 ngày | Hằng ngày + PITR, giữ 35 ngày, sao chép cross-region |
| Log | stdout (pretty) | CloudWatch, giữ 90 ngày | CloudWatch, giữ 6 năm |
| MFA | Bật (có thể tắt để test) | Bắt buộc | Bắt buộc |

> **Quy tắc cứng**: PHI thật **không bao giờ** xuất hiện ngoài production. Dữ liệu test sinh bằng `npm run seed`, không phải copy từ prod.

## Biến môi trường

| Biến | Bắt buộc | Mặc định | Ghi chú |
|---|:-:|---|---|
| `NODE_ENV` | | `development` | |
| `PORT` | | `4100` | Tránh 4000 vì hay bị dịch vụ khác chiếm |
| `LOG_LEVEL` | | `info` | `debug` chỉ dùng ở dev |
| `DATABASE_URL` | ✓ | — | Connection string Postgres |
| `DATABASE_POOL_MAX` | | `10` | 20 users → 10 connection là đủ |
| `DATABASE_SSL` | | `false` | Bắt buộc `true` ở staging/prod |
| `JWT_ACCESS_SECRET` | ✓ | — | Tối thiểu 32 ký tự |
| `JWT_ACCESS_TTL_SECONDS` | | `900` | Không nên tăng quá 900 |
| `SESSION_IDLE_TIMEOUT_SECONDS` | | `1800` | HIPAA auto-logoff |
| `KEK_PROVIDER` | | `local` | Prod **bắt buộc** `aws-kms` |
| `KEK_LOCAL_KEY` | dev | — | 32 byte base64 |
| `KEK_AWS_KMS_ARN` | prod | — | ARN của CMK |
| `SEARCH_HMAC_KEY` | ✓ | — | 32 byte base64, khác KEK |
| `CORS_ORIGINS` | | `http://localhost:5173` | Danh sách ngăn cách bởi dấu phẩy |
| `MAX_LOGIN_ATTEMPTS` | | `5` | |
| `ACCOUNT_LOCK_MINUTES` | | `15` | |
| `MFA_REQUIRED` | | `true` | Chỉ đặt `false` ở dev |

Ứng dụng **từ chối khởi động** nếu thiếu biến bắt buộc hoặc nếu prod dùng `KEK_PROVIDER=local` — xem `backend/src/config/env.ts`.

## Quản lý secret

| Môi trường | Cách lưu |
|---|---|
| Dev | File `.env` local, không commit |
| Staging / Prod | AWS Secrets Manager, inject lúc chạy, xoay 90 ngày |
| CI | GitHub Encrypted Secrets |

Không bao giờ đưa secret vào: Docker image, log, ticket, chat, screenshot.

## Tài khoản database

```sql
-- Role migration (có DDL) — chỉ dùng khi deploy
CREATE ROLE crm_migrator LOGIN PASSWORD '...';
GRANT ALL ON SCHEMA public TO crm_migrator;

-- Role ứng dụng (không có DDL)
CREATE ROLE crm_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
REVOKE UPDATE, DELETE ON audit_logs, phi_access_logs FROM crm_app;

-- Role chỉ đọc cho báo cáo
CREATE ROLE crm_readonly LOGIN PASSWORD '...';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO crm_readonly;
```

## Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| `Cấu hình môi trường không hợp lệ` | Thiếu biến trong `.env` | Đọc danh sách lỗi in ra, điền đủ |
| `KEK_LOCAL_KEY phải dài 32 byte` | Khoá sinh sai độ dài | Sinh lại bằng lệnh ở mục 2 |
| `ECONNREFUSED 5433` | Container Postgres chưa chạy | `docker compose up -d postgres` |
| `port is already allocated` khi `docker compose up` | Cổng 5433 đã bị chiếm | Đổi `POSTGRES_HOST_PORT` trong `.env` |
| `EADDRINUSE :::4100` | Dịch vụ khác đang giữ cổng | Đổi `PORT` trong `.env` |
| `The server does not support SSL connections` | `DATABASE_SSL` bật nhầm ở dev | Đặt `DATABASE_SSL=false` |
| Migration lỗi `btree_gist` | Extension chưa có | Dùng image `postgres:16-alpine` (đã kèm sẵn) |
| `unique constraint on partitioned table...` | Sửa migration audit mà quên cột partition key | Mọi PK/UNIQUE trên `audit_logs` phải chứa `created_at` |
| `Production không được dùng KEK_PROVIDER=local` | Cấu hình prod sai | Đặt `KEK_PROVIDER=aws-kms` + ARN |
