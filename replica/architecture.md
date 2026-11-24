# Kiến trúc: CRM-DK theo vòng lõi Qub-X (thị trường Việt Nam)

Nguồn: `replica/recon.md` (Qub-X, 36 màn · 10 luồng · ~40 thực thể), `replica/features.csv`
(78 dòng — must 32 / should 25 / could 15 / skip 6), và schema thực tế của CRM-DK
(migrations `001`→`025`, sau khi đã gỡ HIS + rút gọn lâm sàng).
Ngày: 2026-11-24. Người viết: `/replica-architect`.

> Đây là **brownfield**: CRM-DK đã chạy (Express + Kysely + PostgreSQL + React/Vite,
> xác thực + MFA + mã hoá field-level + audit hash-chain). Nên bản này KHÔNG đề xuất
> stack mới — nó **đối chiếu** mô hình Qub-X với cái đang có và vạch phần phải thêm.

---

## 0. HAI quyết định phải chốt trước khi build

Cả hai đều là quyết định của chủ sản phẩm, không suy ra được từ recon.

### Quyết định A — Thị trường & khung pháp lý
| | HIPAA (hiện tại) | Việt Nam (vòng lõi Qub-X) |
|---|---|---|
| Luật | HIPAA/HITECH (Mỹ) | TT 13/2025 (EMR, hạn 31/12/2026), TT 26/2025 (đơn thuốc điện tử), Luật BVDLCN 2025 (PDPL) |
| Lưu trú dữ liệu | — | **Bắt buộc tại VN** (Nghị định 13/2023 + PDPL) |
| Khái niệm | "patient / PHI" | "khách hàng / người bệnh"; dữ liệu cá nhân nhạy cảm |
| Biểu mẫu | tự do | **mẫu 15/BV1**, ICD-10 của BYT, đơn thuốc có mã quốc gia |
| Chữ ký | — | ký số qua CA được cấp phép / VNeID |

**Khuyến nghị: chọn Việt Nam làm thị trường chính.** Lý do: toàn bộ recon (phòng khám
thẩm mỹ/da liễu VN, hạn EMR 31/12/2026, MISA, Zalo) là VN; HIPAA chỉ bán được ở Mỹ nơi
đã có Epic/athena. **Giữ nguyên các cơ chế kỹ thuật HIPAA** (mã hoá trường, DEK/KMS,
audit bất biến, phi_access_log) vì chúng **mạnh hơn** sàn PDPL và ánh xạ thẳng sang yêu
cầu BVDLCN — đây là lợi thế, không phải nợ kỹ thuật. Việc đổi là **ngữ nghĩa + tuân thủ**
(thuật ngữ, điều khoản đồng ý theo PDPL, lưu trú VN, 15/BV1), không phải viết lại bảo mật.

→ **ĐÃ CHỐT (2026-11-24): Việt Nam.** Giữ nguyên cơ chế bảo mật HIPAA làm nền kỹ thuật
(mã hoá trường, DEK/KMS, audit bất biến); công việc còn lại là ngữ nghĩa + tuân thủ PDPL/
TT13/TT26 + lưu trú VN.

### Quyết định B — Phạm vi: CRM thuần ↔ Clinic-ops tích hợp  ⚠️ **xung đột cần gỡ**
Đây là mâu thuẫn trực tiếp với lịch sử gần đây của repo. Ngày 23–24/08, CRM-DK đã **chủ
động gỡ** viện phí/POS, dược/kho, tiếp đón/bảng trạng thái, **bệnh án SOAP, xét nghiệm**,
danh mục dịch vụ — để về "CRM đúng nghĩa" (xem memory `crm-scope-no-his`).

**Nhưng vòng lõi Qub-X ĐÒI LẠI chính những thứ đó:** lát cắt đầu mà recon đề xuất là
`F02 + F03 + F06` = **lịch hẹn → bệnh án 15/BV1 + đơn thuốc → đơn/gói/thanh toán**. Không
có encounter EMR và POS thì không có vòng lõi Qub-X.

Ba đường đi:

| Hướng | Nội dung | Hợp với |
|---|---|---|
| **B1 — CRM thuần + tích hợp** | Giữ CRM-DK là lớp quan hệ khách hàng (tin nhắn, lịch hẹn, CSKH, marketing, chi tiêu). EMR/POS/kho **nằm ở hệ ngoài**, nối qua webhook kiểu `dklink` đã có. | Memory hiện tại; rủi ro thấp; **nhưng KHÔNG phải là Qub-X** |
| **B2 — Hấp thụ lại clinic-ops** | Dựng lại encounter 15/BV1, POS/gói/thẻ, danh mục dịch vụ, bảng trạng thái — thành một hệ tích hợp giống Qub-X. | Bằng chứng từ recon; **đảo ngược hướng "CRM thuần"** |
| **B3 — Lõi CRM + module clinic bật/tắt** (khuyến nghị) | Nhân CRM giữ nguyên; clinic-ops là **module tuỳ chọn** mỗi phòng khám bật. Bán được cho cả phòng khám chưa cần EMR lẫn phòng khám cần EMR trước 31/12/2026. | Dung hoà; tốn công hơn B1 |

→ **ĐÃ CHỐT (2026-11-24): B3 — Lõi CRM + module clinic bật/tắt.** Nhân CRM (bệnh nhân,
lịch hẹn, CSKH, marketing, chi tiêu, khảo sát, cổng BN) giữ nguyên và luôn bật. Clinic-ops
(encounter 15/BV1, POS/gói/thẻ, danh mục dịch vụ, bảng trạng thái, kho) là **module tùy
chọn** mỗi phòng khám bật — không ép phòng khám chưa cần EMR phải dùng. Schema mục 3 & 5
áp dụng cho các phòng khám bật module clinic.

---

## 1. Stack — giữ nguyên cái đang chạy

| lớp | CRM-DK hiện tại | giữ? | ghi chú |
|---|---|---|---|
| web app | React 18 + Vite + TS | ✅ | SPA; recon là app nội bộ, không cần SSR/SEO |
| styling | Tailwind (tokens "khí cụ lâm sàng") | ✅ | tokens sẵn cho `/replica-design` |
| API | Express + TS, module-per-domain | ✅ | đã có controller/service/schema/routes |
| DB | PostgreSQL 16 | ✅ | **một** DB, không microservice |
| query | Kysely (SQL typed) | ✅ | không RLS Supabase → **authorize mỗi query ở tầng service** |
| auth | JWT + refresh cookie + TOTP MFA | ✅ | tái dùng 100% |
| mã hoá | AES-256-GCM field-level, DEK/bệnh nhân, KEK/KMS | ✅ | tái dùng; **vượt** sàn PDPL |
| file | `storage-provider` (local/S3) | ✅→ | bật **MinIO/S3 đặt tại VN** cho ảnh trước/sau |
| job nền | `src/jobs/*` (tsx) | ✅ | reminders, follow-up, kiểm tra hash-chain |
| hosting | docker-compose (prod/vps/replica) | ✅ | **VPS/cloud tại VN** để lưu trú dữ liệu |
| realtime | *(chưa có)* | ➕ | cần cho hộp thư đa kênh + bảng trạng thái (SSE/WebSocket) — giai đoạn sau |

Lệch với mặc định của skill (Next.js/Supabase/Drizzle): **cố ý** — đã có stack chạy được,
320 test. "Clone cần tính năng của bản gốc, không cần kiến trúc của bản gốc."

---

## 2. Đối chiếu schema: Qub-X (recon §158) ↔ CRM-DK thực tế

Trạng thái: ✅ có · ◐ một phần · ✗ thiếu. "Bảng CRM-DK" là bảng **thực tế trong migrations**
(không phải `docs/03-erd.md` — xem cảnh báo cuối mục).

| Thực thể Qub-X | TT | Bảng CRM-DK tương ứng | Việc phải làm |
|---|---|---|---|
| Organization | ✗ | — (đơn tenant) | thêm `organizations` (hoặc giả định 1 org, thêm sau) |
| Branch | ✗ | — | **thêm `branches`** + `branch_id` lan khắp bảng vận hành |
| Room / Machine | ✗ | — | thêm `rooms`, `machines` (est_minutes) |
| Staff (User) | ◐ | `users` + `roles`/`permissions` | thêm `user_branches` (n-n), `users.locale`; **quyền theo chi nhánh** |
| Customer | ✅ | `patients` (+ `patient_contacts/allergies/medical_history/consents`) | đổi khái niệm "khách hàng"; thêm `source`, `tier`, `next_visit_note` |
| Conversation / Message | ✗ | — | **thêm** `conversations`, `messages` (omni-channel; giai đoạn sau, Zalo OA trước) |
| QuickReply | ✗ | — | thêm `quick_replies` |
| AppointmentGroup | ✗ | — | thêm `appointment_groups` (màu) |
| Appointment | ◐ | `appointments` (cơ bản) | mở rộng: `branch_id, group_id, source, room_id, machine_id, queue_no, arrived_at`, trạng thái 7 bước, nhân sự n-n |
| AppointmentService | ✗ | — | thêm `appointment_services` (dòng dịch vụ → trừ kho) |
| AppointmentEvent | ◐ | `appointment_notes` + `audit_logs` | thêm `appointment_events` (đổi trạng thái có from/to) |
| Service | ✗ | — (service_items đã gỡ cùng HIS) | **dựng lại** `services` (+ `service_bom` nếu làm kho) |
| Package / CustomerPackage | ◐ | `treatment_plans` ≈ "liệu trình" | **thêm** `packages`, `customer_packages` (buổi/shot, mở khoá theo tiền) |
| PrepaidCard | ✗ | — | thêm `prepaid_cards` |
| Order / OrderLine / Payment | ✗ | (billing đã gỡ) · `patient_transactions` ≈ sổ chi đơn giản | **dựng lại** `orders`, `order_lines`, `payments` — **tiền VND nguyên (bigint đồng)** |
| Refund | ✗ | — | thêm `refunds` (gửi→duyệt→hoàn tất→đảo) |
| Commission | ✗ | — | thêm `commissions` (could) |
| Invoice (MISA) | ✗ | — | thêm `invoices` + adapter MISA meInvoice (should) |
| FollowUpTask | ◐ | `post_treatment_care` (module marketing) | **đối chiếu & mở rộng** sang day1/week1/revisit + kết quả |
| Complaint | ✗ | — | thêm `complaints` + `complaint_events` (could) |
| Encounter (15/BV1) | ✗ | (medical_records đã **GỠ** 24/08) | **dựng lại** `encounters` đúng 15/BV1 + ICD-10 chính/kèm + ký/khóa/amend; **tái dùng** mã hoá + bảng version |
| Prescription | ◐ | `prescriptions` (standalone) | thêm `encounter_id`, `national_code`, status sent/error, PDF; nối `dklink` adapter |
| PrescriptionTemplate | ✗ | — | thêm `prescription_templates` (theo ICD) |
| ConsentForm / SignedForm | ◐ | `patient_consents` | thêm ảnh chữ ký, `witness_id`, `form_templates`, `signed_forms` |
| Photo (before/after) | ◐ | `documents` | thêm `kind(before/after)` + `encounter_id` (hoặc bảng `photos`) |
| AccessLog | ✅ | `phi_access_logs` + `audit_logs` (hash-chain) | tái dùng — **đã khớp** feature "nhật ký truy cập" (S35) |
| ICD-10 catalog | ✅ | `icd10_codes` (110 mã) | **nạp danh mục ICD-10 đầy đủ của BYT**; phân bệnh chính/kèm |
| Product/Stock/Lot/Doc/Move | ✗ | (kho đã gỡ) | module kho — giai đoạn sau (should/could) |
| Attendance/Shift/Leave (HRM) | ✗ | — | ngoài vòng lõi (could) — bỏ qua giai đoạn đầu |

**Tái dùng mạnh từ CRM-DK (đừng làm lại):** auth+MFA, mã hoá trường + DEK/KMS, audit
hash-chain + phi_access, backup/replication (`docs/08`), notifications, surveys/NPS,
`customer_segments`+`campaigns` (marketing/CSKH), `spending`/hạng VIP (≈ "Hạng thành
viên theo chi tiêu", S11), cổng bệnh nhân, danh mục ICD-10, `dklink` (mẫu adapter webhook).

### ⚠️ `docs/03-erd.md` đã LỆCH với code
ERD trong docs vẫn vẽ `MEDICAL_RECORDS`, `MEDICAL_RECORD_VERSIONS`, `LAB_RESULTS`,
`WAITLIST` — nhưng schema thực tế **đã drop** medical_records/lab_results (slim 24/08) và
`waitlist` chưa từng được implement. Ngược lại docs **thiếu**: `patient_transactions`,
`spending_tiers`, `icd10_codes`, `dklink_patients`, treatment/marketing/survey/portal.
→ **Việc cần làm:** tái sinh `docs/03-erd.md` từ schema sống (migrations/`db/types.ts`)
trước khi dùng nó làm cơ sở thiết kế. Dùng recon §158 làm *đích*, `db/types.ts` làm
*hiện trạng*, không dùng `03-erd.md`.

### ⚠️ Hai migration trùng số `025`
`1700000000025_dklink-integration.sql` và `1700000000025_icd10-catalog.sql` trùng tiền tố.
node-pg-migrate chạy theo thứ tự chữ cái (`dklink` trước `icd10`) nên hiện không vỡ, nhưng
phải **đổi số một trong hai** (vd icd10 → `...026`) để tránh nhầm và lỗi khi rollback.

---

## 3. Schema mới cho lát cắt dọc (F06 → F02 → F03)

Nguyên tắc (theo skill, chỉnh cho VN): `id uuid default gen_random_uuid()`, `created_at/
updated_at timestamptz` UTC; **cột sở hữu `branch_id`** trên mọi bảng vận hành; FK có
`on delete` quyết định rõ; index mọi FK + cột lọc/sắp; enum bằng `check`; **tiền = `bigint`
VND (đồng nguyên, KHÔNG cent)** + `currency` cho ngoại tệ; kiểm soát truy cập **mỗi query
ở service** (không RLS). DDL đầy đủ ở `replica/schema-additions.sql`; dưới là phần xương sống.

```sql
-- Đa chi nhánh (Quyết định B2/B3)
create table branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,                         -- để trống nếu đơn tổ chức
  name text not null,
  address text,
  geo_radius_m int,
  opening_hours jsonb not null default '{}',
  holidays jsonb not null default '[]',
  slot_capacity int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table user_branches (
  user_id uuid not null references users(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  primary key (user_id, branch_id)
);

-- Encounter 15/BV1 (dựng lại — tái dùng mã hoá field-level + bảng version)
create table encounters (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  patient_id uuid not null references patients(id) on delete restrict,
  appointment_id uuid references appointments(id) on delete set null,
  doctor_id uuid not null references users(id),
  reason_enc bytea, history_enc bytea, notes_enc bytea,   -- 🔒 DEK bệnh nhân
  vitals jsonb not null default '{}',
  dx_primary_icd10 text references icd10_codes(code),
  dx_secondary_icd10 text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','signed','amended')),
  signed_at timestamptz, signature_ref text, locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on encounters (patient_id, created_at);
create index on encounters (branch_id, created_at);
-- Hoàn tất = signed + locked; sửa sau khóa chỉ qua bản amend (giữ bản cũ ở *_versions).

-- Đơn thuốc gắn encounter + mã quốc gia (adapter dklink)
alter table prescriptions
  add column encounter_id uuid references encounters(id) on delete cascade,
  add column national_code text,
  add column send_status text not null default 'local'
    check (send_status in ('local','queued','sent','error')),
  add column pdf_key text;

-- POS: dịch vụ, gói, thẻ trả trước, đơn, dòng đơn, thanh toán (tiền VND bigint)
create table services (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),             -- null = dùng chung mọi chi nhánh
  code text, name text not null, category text,
  price_vnd bigint not null check (price_vnd >= 0),
  followup_rule text, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table packages (
  id uuid primary key default gen_random_uuid(),
  name text not null, unit text not null check (unit in ('session','shot')),
  qty int not null check (qty > 0), price_vnd bigint not null, validity_days int
);
create table orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                           -- DH-xxxxxx
  branch_id uuid not null references branches(id),
  patient_id uuid not null references patients(id) on delete restrict,
  appointment_id uuid references appointments(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','unpaid','partial','paid','cancelled')),
  total_vnd bigint not null default 0, due_date date,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on orders (patient_id, created_at);
create index on orders (branch_id, status);
create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  kind text not null check (kind in ('service','package','product','prepaid','redeem','transfer')),
  ref_id uuid, qty int not null default 1,
  unit_price_vnd bigint not null, discount_vnd bigint not null default 0
);
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  method text not null check (method in ('cash','transfer','card','prepaid','other')),
  amount_vnd bigint not null check (amount_vnd > 0),
  currency text not null default 'VND', fx_rate numeric,
  paid_at timestamptz not null default now(),
  received_by uuid not null references users(id)
);
create table customer_packages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete restrict,
  package_id uuid not null references packages(id),
  order_id uuid references orders(id) on delete set null,
  total int not null, used int not null default 0,
  unlocked_qty int not null default 0,                 -- mở khoá theo tiền đã trả
  expires_at date, transferred_from_id uuid references customer_packages(id)
);
-- Bất biến tiền: SUM(payments.amount_vnd) ≤ orders.total_vnd; "bắt buộc thu trước hoàn tất"
-- kiểm ở service, không ở UI.

-- Follow-up (đối chiếu post_treatment_care sẵn có trước khi thêm cột)
alter table post_treatment_care
  add column kind text check (kind in ('day1','week1','revisit')),
  add column result text check (result in ('ok','issue','unreachable')),
  add column attempts int not null default 0;
```

Ràng buộc cứng (từ recon):
- **Trùng phòng/máy/nhân sự** (S04) → `exclude using gist` trên `appointments(room_id, tstzrange(start,end))`.
- **Idempotent webhook** (dklink đã làm; áp cho Zalo/MISA) → unique theo external id.
- **Tiền** → chỉ ghi `payments`, tổng hợp bằng view; không sửa `orders.total` tay.

---

## 4. API theo luồng (lát cắt dọc)

`method path | việc | ai gọi | input | output | luồng`

```
F06 Đặt lịch online công khai
  GET  /api/public/booking/slots    khung giờ còn chỗ   | công khai | branch,service,date | slots[]           | F06
  POST /api/public/booking          tạo lịch "chưa xác nhận" | công khai | họ tên,sđt,slot | {appointmentId}    | F06
  POST /api/appointments/:id/confirm  lễ tân xác nhận    | queue:manage | —            | appointment      | F06

F02 Lượt khám có bệnh án + đơn
  POST /api/encounters              mở 15/BV1 từ lịch     | encounter:write | appointmentId    | encounter(draft) | F02
  PATCH /api/encounters/:id         ghi hỏi bệnh/sinh hiệu/ICD | encounter:write | fields       | encounter        | F02
  POST /api/encounters/:id/sign     ký + khóa             | encounter:write(author) | —          | 204              | F02
  POST /api/encounters/:id/amend    sửa bổ sung sau khóa  | encounter:write | reason,fields     | encounter(amended)| F02
  POST /api/prescriptions           kê theo encounter     | prescription:write | items[]        | prescription     | F02
  POST /api/prescriptions/:id/send  đẩy liên thông (adapter) | prescription:write | —           | {national_code}  | F02

F03 Bán gói + làm buổi đầu + trả một phần
  POST /api/orders                  mở đơn (POS)          | order:write | patientId,lines[]     | order(draft)     | F03
  POST /api/orders/:id/lines        thêm dịch vụ/gói      | order:write | line                  | order            | F03
  POST /api/orders/:id/payments     thu (một phần/nhiều PT)| order:write | method,amount_vnd    | payment          | F03
  POST /api/appointments/:id/done   hoàn tất (ép đã thu?) | queue:manage | —                   | 204 + follow-up  | F03→F04
```
Webhook **vào**: `dklink` (có), Zalo OA, MISA meInvoice. Webhook **ra**: email/Zalo xác nhận lịch.
Job nền: sinh follow-up (day1/week1/revisit), nhắc lịch, kiểm tra hash-chain, hết hạn gói/thẻ.

---

## 5. Phần dễ "cắn"

- **Lưu trú dữ liệu VN** — host + object storage đặt tại VN; rà soát mọi dịch vụ ngoài (email, Zalo) theo PDPL về chuyển dữ liệu xuyên biên giới.
- **Tiền VND** — **đồng nguyên, không cent** → `bigint`; cent/`numeric(12,2)` của `patient_transactions` cũ dễ gây lẻ. Ngoại tệ (S17) lưu `currency+fx_rate`, quy về VND khi ghi sổ.
- **Đa chi nhánh** — rò rỉ chéo chi nhánh là lỗi bảo mật: mọi query lọc theo chi nhánh người dùng được phép (đã có mẫu authorize per-query).
- **Idempotency** — webhook đến hai lần (Zalo, MISA); theo mẫu `dklink` (unique external id, upsert).
- **EMR có giá trị pháp lý** — ký/khóa/amend phải bất biến; chữ ký số thật qua CA (chỉ adapter); 15/BV1 phải **đối chiếu văn bản gốc** (features.csv dòng 25 ghi rõ "cần đối chiếu").
- **Cửa sổ 24h** kênh chat, **tin mẫu đã duyệt** — ràng buộc của từng nền tảng, không bỏ qua.
- **Xoá theo PDPL/BVDLCN** — đã có crypto-shredding (xoá DEK); ánh xạ sang quyền xoá dữ liệu của chủ thể.
- **Race** ở POS (hai thu ngân một đơn) và lịch (hai người một slot) → ràng buộc DB, không UI.

---

## 6. Thứ tự build

0. **Nền chung** (nếu chọn B2/B3): `branches` + `branch_id` + `user_branches` + chọn chi nhánh trên topbar. Chạm nhiều bảng → làm trước.
1. **Lát cắt dọc (xấu nhưng thông):** F06 → F02 → F03 end-to-end. Màn S09,S05/S06,S08,S14,S15,S17. Bảng: branches, appointments(mở rộng), encounters, prescriptions, services, packages, orders, order_lines, payments, customer_packages. Route mục 4.
2. **Must còn lại** theo khu vực: hồ sơ khách 11-tab (S11) tận dụng patients/spending/consents/allergies; sổ thanh toán (S18); công nợ (S19); ảnh trước/sau (S12).
3. **Should:** hộp thư đa kênh Zalo OA (S03) + liên kết hồ sơ; follow-up nâng (S22); hoàn tiền duyệt (S20); MISA e-invoice; hoa hồng.
4. **Could / sau:** kho (S24–27), phân tích theo kỳ (S29), HRM, các kênh chat còn lại, AI.
5. **Fix** từ `/replica-entrepreneur` (chưa chạy).

Mỗi mốc liệt kê S-ID + bảng + route như trên.

---

## 7. Tóm tắt

- **Stack (1 dòng):** React/Vite + Express/Kysely + PostgreSQL 16, mã hoá field-level + MFA + audit hash-chain — **giữ nguyên**, host tại VN.
- **Bảng:** hiện có ~30 (thực tế); recon §158 ~40 thực thể; **thêm ~18** cho vòng lõi (branches, rooms/machines, encounters, services, packages, prepaid_cards, orders/order_lines/payments, customer_packages, refunds, invoices, conversations/messages, quick_replies, appointment_groups/services/events, complaints…).
- **Route:** lát cắt dọc ~15 route + webhook vào/ra.
- **3 phần rủi ro nhất:** (1) **Quyết định B** — đảo hướng "CRM thuần"; (2) EMR 15/BV1 + đơn thuốc liên thông hợp pháp (ký số, mã quốc gia, đối chiếu mẫu gốc); (3) tiền nhiều chi nhánh chính xác (gói/thẻ/công nợ/hoàn tiền/ngoại tệ).
- **Việc dọn kèm:** tái sinh `docs/03-erd.md` từ schema sống; đổi số migration `025` trùng.

**Bước kế:** chốt Quyết định A + B, rồi `/replica-design` (tokens Tailwind đã có) hoặc bắt tay mốc 0 (đa chi nhánh).
