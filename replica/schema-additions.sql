-- Schema bổ sung — vòng lõi Qub-X trên CRM-DK (lát cắt dọc F06 → F02 → F03)
-- ĐỀ XUẤT, CHƯA ÁP. Có điều kiện: chỉ dựng nếu chốt Quyết định B2/B3 (hấp thụ
-- clinic-ops). Nếu chọn B1 (CRM thuần + tích hợp) thì bỏ encounter/order/package.
--
-- Quy ước: id uuid; thời gian timestamptz (UTC); TIỀN = bigint VND (đồng nguyên,
-- KHÔNG cent); sở hữu = branch_id; FK có on delete rõ; index mọi FK + cột lọc/sắp;
-- enum bằng check; kiểm soát truy cập ở tầng service (không RLS).
-- Khi áp: tách thành các migration node-pg-migrate theo thứ tự dưới đây.

-- ════════════════ MỐC 0 — Đa chi nhánh (chạm nhiều bảng, làm trước) ════════════════

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  name text NOT NULL,
  address text,
  geo_radius_m int,
  opening_hours jsonb NOT NULL DEFAULT '{}',
  holidays jsonb NOT NULL DEFAULT '[]',
  slot_capacity int,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_branches (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  floor text, name text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE INDEX rooms_branch_idx ON rooms(branch_id);

CREATE TABLE machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL, type text, est_minutes int, active boolean NOT NULL DEFAULT true
);
CREATE INDEX machines_branch_idx ON machines(branch_id);

-- ════════════════ MỐC 1 — Lát cắt dọc ════════════════

-- ─ Lịch hẹn: mở rộng bảng appointments đang có ─
CREATE TABLE appointment_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL, color text, sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);

ALTER TABLE appointments
  ADD COLUMN branch_id uuid REFERENCES branches(id),
  ADD COLUMN group_id uuid REFERENCES appointment_groups(id) ON DELETE SET NULL,
  ADD COLUMN source text NOT NULL DEFAULT 'walkin'
    CHECK (source IN ('prebooked','phone','online','walkin')),
  ADD COLUMN room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  ADD COLUMN machine_id uuid REFERENCES machines(id) ON DELETE SET NULL,
  ADD COLUMN queue_no int,
  ADD COLUMN arrived_at timestamptz;
-- Lưu ý: status hiện tại cần mở sang 7 trạng thái Qub-X
--   (unconfirmed|confirmed|arrived|in_progress|done|cancelled|no_show) — đổi ở migration riêng.
CREATE INDEX appointments_branch_start_idx ON appointments(branch_id, scheduled_start);

-- Nhân sự tham gia (n-n thay cho 1 doctor_id)
CREATE TABLE appointment_staff (
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (appointment_id, staff_id)
);

-- Dòng dịch vụ của lượt (đánh dấu xong → trừ kho ở giai đoạn sau)
CREATE TABLE appointment_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  done_at timestamptz
);
CREATE INDEX appointment_services_appt_idx ON appointment_services(appointment_id);

-- Lịch sử đổi trạng thái lịch hẹn (S08)
CREATE TABLE appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  type text NOT NULL, from_status text, to_status text,
  by_user uuid REFERENCES users(id), at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_events_appt_idx ON appointment_events(appointment_id, at);

-- Chống trùng phòng (ràng buộc DB, không UI). Cần btree_gist.
-- ALTER TABLE appointments ADD CONSTRAINT no_room_overlap
--   EXCLUDE USING gist (room_id WITH =, tstzrange(scheduled_start, scheduled_end) WITH &&)
--   WHERE (room_id IS NOT NULL AND status NOT IN ('cancelled','no_show'));

-- ─ EMR: encounter 15/BV1 (tái dùng mã hoá field-level + bảng version) ─
CREATE TABLE encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  doctor_id uuid NOT NULL REFERENCES users(id),
  reason_enc bytea, history_enc bytea, notes_enc bytea,     -- 🔒 DEK bệnh nhân
  vitals jsonb NOT NULL DEFAULT '{}',
  dx_primary_icd10 text REFERENCES icd10_codes(code),
  dx_secondary_icd10 text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','amended')),
  signed_at timestamptz, signature_ref text,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX encounters_patient_idx ON encounters(patient_id, created_at);
CREATE INDEX encounters_branch_idx ON encounters(branch_id, created_at);

CREATE TABLE encounter_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  version int NOT NULL,
  snapshot_enc bytea NOT NULL,                              -- 🔒 toàn bộ nội dung bản cũ
  changed_by uuid NOT NULL REFERENCES users(id),
  change_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX encounter_versions_enc_idx ON encounter_versions(encounter_id, version);

-- ─ Đơn thuốc: gắn encounter + mã quốc gia (adapter dklink) ─
ALTER TABLE prescriptions
  ADD COLUMN encounter_id uuid REFERENCES encounters(id) ON DELETE CASCADE,
  ADD COLUMN national_code text,
  ADD COLUMN send_status text NOT NULL DEFAULT 'local'
    CHECK (send_status IN ('local','queued','sent','error')),
  ADD COLUMN pdf_key text;

CREATE TABLE prescription_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  icd10_code text REFERENCES icd10_codes(code),
  name text NOT NULL, items jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─ POS: dịch vụ / gói / thẻ trả trước / đơn / thanh toán (TIỀN = bigint VND) ─
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),                  -- null = dùng chung
  code text, name text NOT NULL, category text,
  price_vnd bigint NOT NULL CHECK (price_vnd >= 0),
  followup_rule text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('session','shot')),
  qty int NOT NULL CHECK (qty > 0),
  price_vnd bigint NOT NULL CHECK (price_vnd >= 0),
  validity_days int,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE prepaid_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  balance_vnd bigint NOT NULL DEFAULT 0,
  bonus_vnd bigint NOT NULL DEFAULT 0,
  paid_vnd bigint NOT NULL DEFAULT 0,
  unlocked_vnd bigint NOT NULL DEFAULT 0,                  -- mở khoá theo tiền đã trả
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prepaid_cards_patient_idx ON prepaid_cards(patient_id);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,                               -- DH-xxxxxx
  branch_id uuid NOT NULL REFERENCES branches(id),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','unpaid','partial','paid','cancelled')),
  total_vnd bigint NOT NULL DEFAULT 0,
  due_date date,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_patient_idx ON orders(patient_id, created_at);
CREATE INDEX orders_branch_status_idx ON orders(branch_id, status);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('service','package','product','prepaid','redeem','transfer')),
  ref_id uuid,
  qty int NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_vnd bigint NOT NULL,
  discount_vnd bigint NOT NULL DEFAULT 0
);
CREATE INDEX order_lines_order_idx ON order_lines(order_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash','transfer','card','prepaid','other')),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  currency text NOT NULL DEFAULT 'VND',
  fx_rate numeric,
  paid_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX payments_order_idx ON payments(order_id);

CREATE TABLE customer_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  package_id uuid NOT NULL REFERENCES packages(id),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  total int NOT NULL,
  used int NOT NULL DEFAULT 0,
  unlocked_qty int NOT NULL DEFAULT 0,
  expires_at date,
  transferred_from_id uuid REFERENCES customer_packages(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_packages_patient_idx ON customer_packages(patient_id);

-- Follow-up: mở rộng bảng post_treatment_care sẵn có (module marketing)
ALTER TABLE post_treatment_care
  ADD COLUMN kind text CHECK (kind IN ('day1','week1','revisit')),
  ADD COLUMN result text CHECK (result IN ('ok','issue','unreachable')),
  ADD COLUMN attempts int NOT NULL DEFAULT 0;

-- ════════════════ GIAI ĐOẠN SAU (should/could) — chưa viết DDL ════════════════
-- refunds, invoices (MISA), commissions,
-- conversations + messages + quick_replies (omni-channel, Zalo OA trước),
-- complaints + complaint_events, form_templates + signed_forms, photos(before/after),
-- products + stock + stock_lots + stock_docs + stock_moves (kho),
-- attendance + shifts + leave (HRM).
