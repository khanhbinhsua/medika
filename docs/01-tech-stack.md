# 01 · Tech Stack (đã chốt Phase 1)

## Backend

| Thành phần | Lựa chọn | Phiên bản | Lý do |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | LTS đến 2026, hỗ trợ native test runner |
| Ngôn ngữ | TypeScript | 5.x | Type safety cho dữ liệu y tế |
| Web framework | Express | 4.x | Đơn giản, hệ sinh thái middleware lớn |
| DB client | pg + Kysely | 8.x / 0.27 | Kysely cho type-safe query, không cần ORM nặng |
| Migration | node-pg-migrate | 6.x | SQL-first, dễ review cho audit |
| Validation | Zod | 3.x | Thay Joi — suy ra type TS trực tiếp |
| Auth | jsonwebtoken + otplib | — | JWT + TOTP MFA |
| Password | argon2 | 0.31 | Argon2id, thay bcrypt |
| Encryption | `node:crypto` (built-in) | — | AES-256-GCM + envelope encryption, không thêm dependency |
| Logging | pino | 9.x | Thay Winston — nhanh hơn, JSON native, dễ redact PHI |
| Rate limit | express-rate-limit | 7.x | Chống brute-force login |
| Security headers | helmet | 7.x | CSP, HSTS, X-Frame-Options |
| Test | Vitest + Supertest | — | Nhanh, cùng cấu hình với frontend |

> **Thay đổi so với spec gốc**:
> - Winston → **pino** (redaction PHI tốt hơn, JSON native)
> - Joi → **Zod** (suy ra type TypeScript trực tiếp)
> - bcrypt → **argon2id** (khuyến nghị OWASP 2024)
> - libsodium → **`node:crypto` AES-256-GCM**. Hai lý do: (1) bản ESM của
>   `libsodium-wrappers@0.7.16` bị hỏng, crash ngay khi khởi động server —
>   đã kiểm chứng thực tế; (2) AES-256-GCM được NIST phê duyệt (FIPS 140-2),
>   là thuật toán mà hướng dẫn "encryption safe harbor" của HHS tham chiếu
>   (NIST SP 800-111), trong khi XSalsa20-Poly1305 của libsodium thì không.
>   Đổi lại còn bớt được một dependency.
>
> Ghi nhận trong `00-project-brief.md` AD-002, AD-003.

## Frontend

| Thành phần | Lựa chọn | Phiên bản |
|---|---|---|
| Framework | React | 18.x |
| Build | Vite | 5.x |
| Ngôn ngữ | TypeScript | 5.x |
| Styling | Tailwind CSS | 3.x |
| Routing | React Router | 6.x |
| HTTP | Axios | 1.x |
| State | Zustand | 4.x |
| Server state | TanStack Query | 5.x |
| Form | React Hook Form + Zod | — |
| Date | date-fns | 3.x |
| Toast | react-hot-toast | 2.x |
| Test | Vitest + Testing Library | — |

## Hạ tầng

| Thành phần | Dev | Staging / Prod |
|---|---|---|
| Database | PostgreSQL 16 (Docker) | AWS RDS PostgreSQL 16, encryption at rest (KMS) |
| File storage | Local `./uploads` | AWS S3 + SSE-KMS |
| Key management | File-based dev key | AWS KMS |
| Email | Mailhog (Docker) | SendGrid (yêu cầu BAA) |
| Monitoring | pino → stdout | CloudWatch Logs + Metrics |
| CI/CD | — | GitHub Actions |

## Quy ước

- Node version pin bằng `.nvmrc` = `20`
- Package manager: `npm` (lockfile v3, commit vào repo)
- Lint/format: ESLint + Prettier, chạy trong pre-commit hook và CI
- Commit: Conventional Commits (`feat:`, `fix:`, `chore:`)
