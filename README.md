# CRM Y Tế HIPAA-Compliant

CRM y tế cho tổ chức 20 người dùng, hướng tới tuân thủ HIPAA (mục tiêu dài hạn) và mở rộng GDPR/LGPD sau này.

- **Stack**: Node.js + Express + TypeScript · React + TypeScript + Tailwind · PostgreSQL 16 · JWT + TOTP MFA · AES-256-GCM
- **Trạng thái**: Phase 5 (đóng gói + CI/CD + hardening) — image production, CI, provider AWS KMS/S3, runbook. **320 test pass**. Dựng hạ tầng AWS thật cần tài khoản của tổ chức (xem `docs/09-deployment.md`).
- **Spec đầy đủ**: `docs/00-project-brief.md` (tổng hợp từ `CRM_Y_TE_HIPAA_FULL_SPEC.md`)

## Cấu trúc repo

```
CRM-DK/
├── backend/           Node.js + Express + TypeScript API
├── frontend/          React + TypeScript + Tailwind SPA
├── docs/              Kiến trúc, ERD, API spec (OpenAPI), security, setup
├── infra/             Docker Compose, IaC (sẽ bổ sung ở Phase 5)
├── docker-compose.yml Postgres + backend + frontend cho môi trường dev
└── .env.example       Biến môi trường mẫu (KHÔNG chứa secret thật)
```

## Bắt đầu nhanh (dev local)

Yêu cầu: Node.js 20+, Docker Desktop, Git.

```bash
cp .env.example .env
```

Sinh secret rồi dán vào `.env`:

```bash
node -e "const c=require('crypto');console.log('JWT_ACCESS_SECRET='+c.randomBytes(48).toString('base64'));console.log('KEK_LOCAL_KEY='+c.randomBytes(32).toString('base64'));console.log('SEARCH_HMAC_KEY='+c.randomBytes(32).toString('base64'))"
```

Khởi động:

```bash
docker compose up -d postgres
```

```bash
cd backend && npm install && npm run migrate:up && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

Backend `http://localhost:4100`, frontend `http://localhost:5173`, Postgres cổng `5433`.

> Các cổng 4100 / 5433 được chọn để tránh đụng dịch vụ khác trên máy dev. Đổi qua `PORT` và `POSTGRES_HOST_PORT` trong `.env` nếu cần.

Kiểm tra nhanh:

```bash
curl http://localhost:4100/api/health/ready
```

## Tài liệu Phase 1

| Tài liệu | Nội dung |
|---|---|
| [00 - Project Brief](docs/00-project-brief.md) | Mục tiêu, phạm vi, timeline tổng |
| [01 - Tech Stack](docs/01-tech-stack.md) | Chốt công nghệ & phiên bản |
| [02 - Architecture](docs/02-architecture.md) | Kiến trúc hệ thống, thành phần, luồng dữ liệu |
| [03 - ERD](docs/03-erd.md) | Entity-Relationship Diagram (Mermaid) |
| [04 - Database Schema](docs/04-database-schema.md) | Bảng, cột, khoá, mã hoá field-level |
| [05 - API Spec](docs/05-api-spec.yaml) | OpenAPI 3.0 |
| [06 - Security Architecture](docs/06-security-architecture.md) | Threat model, mã hoá, RBAC, audit |
| [07 - Environment Setup](docs/07-environment-setup.md) | Dev / Staging / Prod |

## Chạy thử

```bash
cd backend && npm run seed
```

```bash
cd backend && npm run smoke
```

Tài khoản dev (mật khẩu `DevPassword123!`): `admin@` · `bacsi@` · `yta@` · `letan@` · `kiemtoan@` (đuôi `crm-dk.local`).

Lần đăng nhập đầu, API trả `mfaEnrollmentRequired` — dùng `enrollmentToken` gọi `/auth/mfa/enroll/start` để lấy QR, rồi `/auth/mfa/enroll/confirm` với mã 6 số.

Smoke test đầy đủ (mỗi lệnh tự reset MFA trước khi chạy): `npm run smoke` (Phase 1) · `smoke:phase2` · `smoke:phase3` · `smoke:purge` · `smoke:reminders` · `smoke:reports` · `smoke:portal` · `smoke:notifications` · `smoke:treatment` · `smoke:marketing` · `smoke:survey` · `smoke:users` · `smoke:spending` · `smoke:conditions`. Unit test: `npm test`. Load test 20 người dùng: `npm run load-test`.

**Cổng bệnh nhân**: nhân viên (admin/lễ tân) tạo tài khoản qua nút "Tạo tài khoản cổng" ở trang bệnh nhân → nhận mật khẩu tạm → bệnh nhân đăng nhập tại `/portal/login`, buộc đổi mật khẩu lần đầu.

**Nhắc lịch**: chạy `npm run reminders:dispatch` (production: cron mỗi 5–15 phút). Email bắt tại Mailhog (`http://localhost:8025`).

## Đã kiểm chứng (chạy thật, không phải giả định)

| Hạng mục | Kết quả |
|---|---|
| 7 migration trên PostgreSQL 16 | ✅ 27 bảng, không lỗi |
| Seed RBAC | ✅ admin 18 / doctor 13 / nurse 9 / receptionist 6 / auditor 3 permission |
| Audit log bất biến | ✅ UPDATE và DELETE đều bị trigger DB chặn |
| Hash chain audit | ✅ nguyên vẹn, 0 mắt xích đứt |
| Chống double-booking | ✅ EXCLUDE constraint chặn lịch chồng giờ cùng bác sĩ |
| **PHI mã hoá trong DB** | ✅ query trực tiếp không tìm thấy plaintext nào |
| **PHI không lọt vào log** | ✅ 0 dòng log chứa tên/sđt/mã bảo hiểm |
| Auth end-to-end (MFA, refresh rotation, logout) | ✅ 36/36 smoke test |
| RBAC cưỡng chế | ✅ lễ tân bị chặn xoá, kiểm toán viên bị chặn xem PHI |
| Ghi audit khi bị từ chối quyền | ✅ `ACCESS_DENIED` có đủ actor, path, permission thiếu |
| Crypto unit test | ✅ 12/12 pass |
| TypeScript strict (BE + FE) | ✅ typecheck sạch |
| Frontend end-to-end trên trình duyệt | ✅ đăng nhập → quét QR → TOTP → dashboard → hồ sơ bệnh nhân |
| Giữ phiên qua reload cứng | ✅ không còn 401 nào trên network |
| Build production frontend | ✅ 117 KB gzip JS · 5 KB gzip CSS · font tự host |
| **Phase 2 backend** | ✅ 40/40 smoke test |
| Chống double-booking (ràng buộc DB) | ✅ chặn lịch chồng giờ, vẫn cho lịch liền kề |
| Máy trạng thái lịch hẹn | ✅ chặn nhảy bước, chặn sửa lịch đã chốt |
| Phiên bản hồ sơ bệnh án | ✅ bản cũ giữ nguyên, bắt buộc nêu lý do sửa |
| Hồ sơ đã ký là bất biến | ✅ chỉ người lập được ký, ký xong không sửa được |
| **Lý do khám + chẩn đoán ICD-10 mã hoá** | ✅ query trực tiếp DB không thấy plaintext |
| Phase 2 trên trình duyệt | ✅ đặt lịch → chuyển trạng thái → tạo hồ sơ → ký → kê đơn |
| **Phase 3 backend** | ✅ 44/44 smoke test |
| **Phát hiện giả mạo nhật ký** | ✅ 11/11 unit test: sửa nội dung, sửa outcome, lùi thời gian, xoá dòng, chèn dòng |
| Nhật ký bất biến ở tầng DB | ✅ tài khoản ứng dụng không UPDATE/DELETE được |
| Phát hiện bất thường | ✅ truy cập hàng loạt, ngoài giờ, bị chặn liên tiếp, xem hồ sơ ngoài phạm vi điều trị |
| Quản lý đồng ý | ✅ lịch sử không bị xoá, tối đa 1 bản còn hiệu lực mỗi loại |
| Phase 3 trên trình duyệt | ✅ 4 tab kiểm toán + chặn kiểm toán viên vào hồ sơ bệnh nhân |
| **Phase 4: unit test** | ✅ 28/28 (thêm phát hiện giả mạo TOTP-replay, log redaction) |
| **Phase 4: dependency audit** | ✅ 0 lỗ hổng ở production dependencies (`npm audit --omit=dev`) |
| **Phase 4: load test 20 người dùng** | ✅ p95 353ms, p99 412ms, 0% lỗi, 95 req/s |
| **Xoá an toàn (crypto-shredding)** | ✅ 25/25 smoke test — hai bước bắt buộc, ân hạn, RBAC, audit |
| **410 thay vì 500 khi đọc dữ liệu đã tiêu huỷ** | ✅ kiểm chứng qua lịch hẹn của bệnh nhân đã purge |
| **Backup + restore thật (không mô tả suông)** | ✅ khôi phục khớp 100% (44/44 patient, 2223/2223 audit log...) |
| **Chuỗi hash audit sống sót qua backup/restore** | ✅ valid=true, 2223/2223 dòng khớp trên DB phục hồi |
| **Xác minh mã hoá tại chỗ** | ✅ 447 cột kiểm tra, 0 nghi ngờ (`npm run verify:encryption`) |
| **Bệnh lý & Dị ứng (cá nhân hoá)** | ✅ 22/22 smoke test (`npm run smoke:conditions`) |
| Tab "Bệnh lý & Dị ứng" trong hồ sơ; ghi chú mã hoá DEK | ✅ marketing segment theo ICD-10 (`conditionLike`); tên bệnh/dị nguyên plaintext để lọc |
| Ô ICD-10 có tìm kiếm + gợi ý (theo mã/tên, không dấu) | ✅ danh mục ICD-10 (`npm run seed:icd10`, 110 mã thường dùng); combobox chọn tự điền tên bệnh |
| **Tài liệu bệnh nhân** | ✅ file mã hoá, DEK riêng từng file, checksum SHA-256 |
| **Nội dung file trên đĩa là ciphertext** | ✅ đọc file vật lý không thấy nội dung gốc |
| Upload → download giải mã khớp file gốc | ✅ kiểm tra checksum SHA-256 mỗi lượt tải |
| Tên file tiếng Việt qua upload | ✅ sửa mojibake của busboy (Latin-1 → UTF-8) |
| **Nhắc lịch tự động Email/SMS** | ✅ 25/25 smoke test (`npm run smoke:reminders`) |
| Email thật gửi tới Mailhog | ✅ kiểm chứng qua Mailhog API, decode MIME/quoted-printable |
| Nhắc lịch KHÔNG chứa PHI | ✅ chỉ ngày giờ + phòng khám, không tên/lý do/bác sĩ (kênh không mã hoá) |
| Điều phối idempotent + retry + huỷ | ✅ không gửi trùng, huỷ khi lịch huỷ/bệnh nhân purge |
| **Thông báo đa kênh Zalo/SMS/Email** | ✅ 29/29 smoke test (`npm run smoke:notifications`) |
| Fallback Zalo ZNS → SMS Brandname → Email | ✅ tự sang kênh kế khi lỗi/thiếu liên hệ, ghi log từng bước |
| Provider thật (Zalo ZNS + eSMS.vn REST) | ✅ smoke chạy backend riêng trỏ mock bắt chước response thật |
| Template `{{placeholder}}` + CRUD + webhook read-receipt | ✅ nội dung render KHÔNG lưu DB, bảng chỉ giữ metadata (không PHI) |
| **Phác đồ điều trị đa bước** | ✅ 41/41 smoke test (`npm run smoke:treatment`) |
| Vòng đời draft→duyệt→active→completed + tự hoàn thành | ✅ máy trạng thái, tự chốt khi mọi bước xong |
| Phê duyệt tách vai trò (người duyệt ≠ bác sĩ phụ trách/người tạo) | ✅ kiểm soát ở tầng service, độc lập quyền `treatment:approve` |
| Template mẫu theo bệnh lý + chi phí ước tính + tiến độ | ✅ tạo phác đồ từ template, tổng chi phí tự tính, % hoàn thành |
| Nội dung lâm sàng phác đồ mã hoá DEK-per-patient | ✅ tiêu đề/mô tả bước/lý do huỷ mã hoá; chi phí plaintext để báo cáo |
| **Marketing & CSKH (segment/chiến dịch/CSKH)** | ✅ 29/29 smoke test (`npm run smoke:marketing`) |
| Chiến dịch bắt buộc consent marketing | ✅ chỉ gửi cho bệnh nhân đã đồng ý (Nghị định 13 + HIPAA marketing) |
| Chăm sóc hậu điều trị tự động khi phác đồ hoàn thành | ✅ nối Module 7 → tự lên lịch CSKH, điều phối gửi đa kênh |
| Chúc mừng sinh nhật tự động (idempotent) | ✅ giải mã dob tại chỗ, không gửi trùng trong năm, lọc consent |
| Nhóm khách hàng động + báo cáo retention/hiệu quả | ✅ segment SQL trên trường không-PHI, tỷ lệ gửi/đọc/quay lại |
| **Khảo sát hài lòng NPS/CSAT** | ✅ 34/34 smoke test (`npm run smoke:survey`) |
| Link khảo sát công khai bằng token (không đăng nhập) | ✅ HMAC token dùng-một-lần, chỉ lưu hash; trả lời qua `/api/public/surveys/:token` |
| Góp ý mã hoá DEK, điểm plaintext để báo cáo | ✅ NPS/CSAT + phân rã theo bác sĩ, xu hướng theo tháng |
| Cảnh báo phản hồi tiêu cực + gửi tự động sau khám | ✅ NPS≤6/CSAT≤2 chấm cờ + audit; dispatch-auto idempotent theo lịch hẹn |
| **Chi tiêu khách hàng (CSKH)** | ✅ 35/35 smoke test (`npm run smoke:spending`) |
| Sổ chi tiêu/bệnh nhân (ghi tay + nhập CSV) — ghi chú mã hoá DEK | ✅ tiền/loại plaintext để cộng dồn; ghi chú mã hoá; audit + phi_access |
| Tổng chi tiêu · hạng VIP (Thường/Bạc/Vàng/Kim cương) · top khách | ✅ tab "Chi tiêu" trong hồ sơ + trang "Chăm sóc theo chi tiêu" |
| Nhóm marketing theo ngưỡng chi tiêu (nhắm khách VIP) | ✅ tiêu chí minTotalSpend/maxTotalSpend trong segment CSKH |
| **Quản lý tài khoản nhân viên** | ✅ 23/23 smoke test (`npm run smoke:users`) |
| Tạo BS/điều dưỡng/lễ tân/kiểm toán + đổi vai trò/khoá | ✅ chỉ admin; khoá → thu hồi phiên; MFA đăng ký lần đăng nhập đầu |
| Đặt lại mật khẩu / gỡ MFA + chống tự khoá & giữ ≥1 admin | ✅ reset thu hồi phiên; chặn tự hạ quyền và hạ admin cuối cùng |
| **Báo cáo & thống kê** | ✅ 24/24 smoke test (`npm run smoke:reports`) |
| Báo cáo tổng hợp KHÔNG lộ PHI | ✅ chỉ đếm/nhóm cột plaintext, CSV không chứa định danh bệnh nhân |
| Xuất CSV (Excel-compatible) | ✅ BOM UTF-8 xác nhận trong bytes thô, RBAC report:export riêng |
| **Cổng bệnh nhân (self-service)** | ✅ 31/31 smoke test (`npm run smoke:portal`) |
| Cách ly token nhân viên ↔ bệnh nhân | ✅ JWT audience riêng, token chéo đều bị chặn (401) |
| Cách ly dữ liệu giữa các bệnh nhân | ✅ bệnh nhân A không thấy bất kỳ dữ liệu nào của B |
| Cổng chỉ hiện kết quả XN đã bác sĩ duyệt | ✅ an toàn lâm sàng — kết quả chưa duyệt bị ẩn |
| Buộc đổi mật khẩu lần đầu + thu hồi phiên | ✅ kiểm chứng end-to-end trong trình duyệt |
| Xác minh mã hoá tại chỗ (cập nhật) | ✅ 994 cột kiểm tra, 0 nghi ngờ |
| **Đóng gói production (Docker)** | ✅ build + boot + healthcheck full stack kiểm chứng bằng `docker-compose.prod.yml` |
| Frontend nginx phục vụ SPA + proxy /api | ✅ SPA/liveness/readiness đều 200 qua nginx |
| Provider AWS KMS (KEK) + S3 (tài liệu) | ✅ code thật (@aws-sdk), SSE-KMS; cần AWS thật để chạy |
| CI/CD GitHub Actions | ✅ lint + typecheck + unit + 8 bộ smoke (Postgres thật) + npm audit + build image |
| Partition audit theo tháng (idempotent) | ✅ `npm run audit:partition` |

## Triển khai (Phase 5)

Chi tiết ở [docs/09-deployment.md](docs/09-deployment.md). Điểm chính:

- **Image production**: `backend/Dockerfile` (4 stage: deps → build → migrate → runtime tối giản, non-root, healthcheck) và `frontend/Dockerfile` (nginx phục vụ SPA + proxy `/api`). Đã **build + chạy full stack tại chỗ** qua `docker-compose.prod.yml` — SPA, liveness `/api/health`, readiness `/api/health/ready` (có check DB) đều 200 qua nginx.
- **AWS providers hoàn thiện**: `KEK_PROVIDER=aws-kms` (KMS Encrypt/Decrypt, KEK không rời HSM) và `STORAGE_PROVIDER=s3` (SSE-KMS) — code thật bằng `@aws-sdk`, nạp qua dynamic import nên dev không cần SDK. `env.ts` **chặn boot** nếu production dùng KEK cục bộ.
- **CI/CD** (`.github/workflows/ci.yml`): mỗi PR chạy lint + typecheck + unit + 8 bộ smoke trên **Postgres thật** + `npm audit --omit=dev` + build cả hai image.
- **Chưa làm (cần tài khoản AWS)**: Terraform/CDK dựng RDS/ECS/KMS/S3, ALB/CloudFront/WAF, Secrets Manager — thao tác trên hạ tầng thật, không kiểm chứng được từ máy dev.

### Phương án tự host trên VPS (thay AWS) — kiểm chứng end-to-end

Toàn bộ dịch vụ AWS có bản self-host, **app không đổi code**, chỉ đổi provider qua env:

| AWS | Self-host | Provider |
|---|---|---|
| KMS | **HashiCorp Vault** (Transit) | `KEK_PROVIDER=vault` |
| S3 | **MinIO** | `STORAGE_PROVIDER=s3` + `STORAGE_S3_ENDPOINT` |
| RDS | PostgreSQL container | — |

- `VaultKekProvider` test với **Vault Transit thật**: wrap/unwrap DEK, mã hoá field, IV ngẫu nhiên — **8/8** (`npm run test:vault`).
- **AppRole auth** (chuẩn production, thay token root tĩnh): app đăng nhập role-id + secret-id → token ngắn hạn tự làm mới — **4/4** (`npm run test:vault-approle`). Token bị **policy least-privilege** chặn mọi thứ ngoài encrypt/decrypt trên đúng khoá (đọc/tạo khoá, xem hệ thống đều 403) — secret-id lộ cũng không leo thang được.
- `docker-compose.vps.yml` chạy full stack **`NODE_ENV=production` + Vault + MinIO** (vượt qua guard bảo mật thật, không hạ NODE_ENV để lách): tạo bệnh nhân → DEK wrap qua Vault → đọc lại giải mã đúng; upload tài liệu → mã hoá → lưu MinIO → tải về khớp gốc — **7/7**, xác nhận object MinIO là ciphertext.
- **PostgreSQL replica + PITR** (bản self-host của RDS Multi-AZ): `docker-compose.replica.yml` dựng primary + hot standby streaming replication + WAL archiving. Kiểm chứng thật: ghi ở primary replicate sang replica (lag ~0.05ms), replica read-only (từ chối ghi), WAL archive tự động 0 lỗi.
- Chi tiết + lưu ý pháp lý (HIPAA vs Nghị định 13/2023) ở [docs/09-deployment.md](docs/09-deployment.md).

### Backup mã hoá + off-site (đã kiểm chứng end-to-end)

`npm run backup` giờ: `pg_dump` → kiểm PHI (1216 cột, 0 nghi ngờ) → **mã hoá AES-256-GCM** (`BACKUP_ENCRYPTION_KEY`, khoá tách khỏi KEK) → xoá bản plaintext → **đẩy off-site** S3/MinIO (`BACKUP_S3_*`). `npm run restore` tự giải mã `.dump.enc` → phục hồi → dọn file tạm.

Kiểm chứng thật: `.dump.enc` không phải archive (`pg_restore` từ chối), object MinIO là ciphertext, restore từ `.enc` giữ nguyên dữ liệu + **chuỗi hash audit `valid` (4361 dòng)**. Vì sao cần: dump vẫn chứa search hash HMAC, tên nhân viên, MRN, IP audit ở dạng thô dù cột PHI lõi đã mã hoá.

### Ba lỗi thật container test bắt được
- **Logger crash**: `pino-pretty` (devDep) không có trong image `--omit=dev` → sửa để rơi về log JSON khi module vắng mặt.
- **Thiếu config ESLint**: script `lint` tồn tại nhưng không có `.eslintrc` → tạo config, lint bắt 2 tham số chết đã dọn.
- **Healthcheck IPv6**: `wget localhost` thử `::1` còn nginx bind IPv4 → dùng `127.0.0.1`.

## Audit bảo mật (Phase 4)

Soát thủ công theo OWASP Top 10 (không phải git repo nên không dùng được review theo diff). 4 lỗ hổng thật đã vá:

| # | Lỗ hổng | Mức độ | Đã sửa |
|---|---|---|---|
| 1 | `jwt.verify()` không ghim thuật toán tường minh — dựa vào suy luận ngầm định của thư viện | Cứng hoá phòng vệ | Ghim `algorithms: ['HS256']` ở mọi lệnh gọi |
| 2 | **Mã TOTP có thể dùng lại** trong cửa sổ ±90s — mã bị lộ (quay màn hình, nhìn trộm) dùng lại được kể cả sau khi chủ tài khoản đã đăng nhập | Trung bình (A07) | Thêm `last_used_step`, claim nguyên tử bằng `UPDATE ... WHERE` |
| 3 | **Log ứng dụng lộ tên bệnh nhân qua query string** — `GET /patients?q=Nguyen+Van+A` ghi nguyên vẹn vào access log vì pino-http log cả `req.url`, không tách được `req.query` | Cao (A09, lộ PHI) | Serializer tuỳ chỉnh cắt query string; đổi danh sách redact từ liệt kê sang chặn nguyên khối `req.body` |
| 4 | Chuỗi phụ thuộc `argon2 → node-pre-gyp → tar` dính CVE critical (path traversal khi cài đặt) | Chuỗi cung ứng | Nâng argon2 0.31→0.45, kysely 0.27→0.29 (dính SQL injection advisory dù code không dùng pattern lỗi). **0 lỗ hổng production** sau nâng cấp |

Còn 6 lỗ hổng dev-only (vite/vitest/esbuild dev server) — không đóng gói vào bản build production, nâng cấp cần vitest major version nên để lại, ghi rõ trong `npm audit`.

Đã kiểm chứng bằng cách xác nhận **hash cũ tạo trước khi nâng cấp argon2 vẫn xác thực được** (tương thích ngược PHC string format) và chạy lại toàn bộ 149 test.

## Tối ưu hiệu năng (Phase 4)

Phát hiện N+1 thật ở 3 endpoint danh sách (`listPatients`, `listAppointments`, `listPhiAccess`): mỗi dòng trả về gọi `loadDek()` tuần tự — ở production (`KEK_PROVIDER=aws-kms`) mỗi lần unwrap là một lệnh gọi mạng tới AWS KMS, nên trang 20 dòng = 20 round-trip KMS nối đuôi nhau. Thêm `loadDeks()` tải theo lô (1 query + unwrap song song) và `writePhiAccessLogs()` ghi nhiều dòng trong 1 INSERT.

Đo bằng `npm run load-test` (20 người dùng ảo, phân theo đúng quyền RBAC từng vai trò):

| | Trước | Sau |
|---|---|---|
| p95 | 707ms | **353ms** |
| p99 | 1016ms | **412ms** |
| max | 1350ms | **468ms** |
| Throughput | 79 req/s | 95 req/s |

Độ trễ đuôi (p99/max) giảm mạnh nhất — đúng dấu hiệu của việc loại bỏ nghẽn tuần tự dưới tải đồng thời.

Thêm index bán phần `audit_logs(outcome, created_at) WHERE outcome != 'success'` — bảng này giữ dữ liệu 6 năm theo yêu cầu HIPAA nên sẽ lớn dần; ở khối lượng nhỏ hiện tại planner chưa cần dùng đến (đã xác nhận bằng `EXPLAIN`), nhưng sẽ phát huy khi bảng lớn.

## Thiết kế giao diện

Hướng **"khí cụ lâm sàng"** — ngôn ngữ của thiết bị y tế và biểu mẫu xét nghiệm, không phải dashboard SaaS:

- **Chữ**: IBM Plex Sans + Plex Mono, tự host (chỉ subset latin + vietnamese). Không gọi Google Fonts — tránh rò IP người dùng sang bên thứ ba và giữ CSP `default-src 'self'` sạch. Mọi mã, số, ID dùng font đều nét để cột thẳng hàng khi quét mắt.
- **Màu**: nền giấy, một màu nhấn teal y tế, cùng bộ màu ngữ nghĩa cho mức độ nghiêm trọng. Có giao diện tối cho ca trực đêm.
- **Đường nét**: viền kẻ tóc 1px thay cho đổ bóng, bo góc 2px — dày đặc thông tin, đọc như biểu mẫu in.
- **Tuân thủ hiện diện trong UI**: cảnh báo tự đăng xuất trước 2 phút, ghi chú "lượt xem đã vào nhật ký PHI" ngay trên hồ sơ, và giải thích vì sao tìm kiếm chỉ khớp chính xác (do dữ liệu đã mã hoá).

## Cảnh báo tuân thủ

- Chưa có BAA với AWS / SendGrid → **KHÔNG** đưa PHI thật vào hệ thống cho đến khi ký BAA và pass security audit (Phase 4-5).
- Repo này ở giai đoạn foundation, các kiểm soát HIPAA sẽ được siết chặt qua Phase 3.
