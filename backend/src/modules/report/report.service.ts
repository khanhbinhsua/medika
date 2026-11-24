import { sql, type SelectQueryBuilder } from 'kysely';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';

/**
 * TẤT CẢ báo cáo ở đây là số liệu TỔNG HỢP trên các cột KHÔNG mã hoá
 * (status, gender, *_id, *_date, created_at, room...). KHÔNG bao giờ giải mã
 * PHI của từng dòng, KHÔNG trả về danh sách có định danh bệnh nhân. Nhờ vậy
 * báo cáo không phải là "disclosure" PHI — không cần ghi phi_access_log, và
 * xuất file cũng an toàn để chia sẻ trong nội bộ.
 *
 * Tên bác sĩ/nhân viên KHÔNG phải PHI (thông tin nhân sự), nên được phép hiển
 * thị trong báo cáo năng suất.
 */

export interface Overview {
  activePatients: number;
  newPatientsLast30d: number;
  appointmentsUpcoming: number;
  appointmentsCompletedLast30d: number;
  activePrescriptions: number;
  documentsTotal: number;
}

export async function overview(): Promise<Overview> {
  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 86_400_000);

  const [patients, newPatients, upcoming, completed, rx, docs] = await Promise.all([
    count(db.selectFrom('patients').where('deleted_at', 'is', null).where('status', '=', 'active')),
    count(db.selectFrom('patients').where('deleted_at', 'is', null).where('created_at', '>=', days30)),
    count(
      db
        .selectFrom('appointments')
        .where('scheduled_start', '>=', now)
        .where('status', 'in', ['scheduled', 'confirmed']),
    ),
    count(
      db.selectFrom('appointments').where('status', '=', 'completed').where('scheduled_start', '>=', days30),
    ),
    count(db.selectFrom('prescriptions').where('status', '=', 'active')),
    count(db.selectFrom('documents').where('deleted_at', 'is', null)),
  ]);

  return {
    activePatients: patients,
    newPatientsLast30d: newPatients,
    appointmentsUpcoming: upcoming,
    appointmentsCompletedLast30d: completed,
    activePrescriptions: rx,
    documentsTotal: docs,
  };
}

export interface StatusCount {
  status: string;
  count: number;
}

/** Phân bố lịch hẹn theo trạng thái trong khoảng thời gian. */
export async function appointmentsByStatus(from: Date, to: Date): Promise<StatusCount[]> {
  const rows = await db
    .selectFrom('appointments')
    .select(['status', (eb) => eb.fn.countAll<string>().as('count')])
    .where('scheduled_start', '>=', from)
    .where('scheduled_start', '<=', to)
    .groupBy('status')
    .orderBy('status')
    .execute();

  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

export interface TimelinePoint {
  day: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

/** Số lịch hẹn theo từng ngày — cho biểu đồ đường xu hướng. */
export async function appointmentsTimeline(from: Date, to: Date): Promise<TimelinePoint[]> {
  const rows = await sql<{
    day: Date;
    total: string;
    completed: string;
    cancelled: string;
    no_show: string;
  }>`
    SELECT date_trunc('day', scheduled_start) AS day,
           count(*)::text AS total,
           count(*) FILTER (WHERE status = 'completed')::text AS completed,
           count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
           count(*) FILTER (WHERE status = 'no_show')::text AS no_show
    FROM appointments
    WHERE scheduled_start >= ${from} AND scheduled_start <= ${to}
    GROUP BY 1
    ORDER BY 1
  `.execute(db);

  return rows.rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    total: Number(r.total),
    completed: Number(r.completed),
    cancelled: Number(r.cancelled),
    noShow: Number(r.no_show),
  }));
}

export interface ProviderProductivity {
  doctorId: string;
  doctorName: string;
  appointments: number;
  completed: number;
  prescriptions: number;
}

/** Năng suất theo bác sĩ. Tên bác sĩ là thông tin nhân sự, không phải PHI. */
export async function providerProductivity(from: Date, to: Date): Promise<ProviderProductivity[]> {
  const rows = await sql<{
    doctor_id: string;
    doctor_name: string;
    appointments: string;
    completed: string;
    prescriptions: string;
  }>`
    SELECT u.id AS doctor_id,
           u.full_name AS doctor_name,
           count(DISTINCT a.id)::text AS appointments,
           count(DISTINCT a.id) FILTER (WHERE a.status = 'completed')::text AS completed,
           count(DISTINCT pr.id)::text AS prescriptions
    FROM users u
    JOIN roles r ON r.id = u.role_id AND r.name = 'doctor'
    LEFT JOIN appointments a ON a.doctor_id = u.id AND a.scheduled_start >= ${from} AND a.scheduled_start <= ${to}
    LEFT JOIN prescriptions pr ON pr.prescriber_id = u.id AND pr.prescribed_at >= ${from} AND pr.prescribed_at <= ${to}
    GROUP BY u.id, u.full_name
    ORDER BY count(DISTINCT a.id) DESC
  `.execute(db);

  return rows.rows.map((r) => ({
    doctorId: r.doctor_id,
    doctorName: r.doctor_name,
    appointments: Number(r.appointments),
    completed: Number(r.completed),
    prescriptions: Number(r.prescriptions),
  }));
}

// ── Xuất CSV (mở được bằng Excel) ─────────────────────────────────────

/**
 * CSV cho Excel: BOM UTF-8 ở đầu để Excel đọc đúng tiếng Việt, escape đúng
 * dấu phẩy/nháy/xuống dòng. Chỉ chứa số liệu tổng hợp — không PHI.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return '﻿' + lines.join('\r\n');
}

export async function exportProviderProductivityCsv(from: Date, to: Date): Promise<string> {
  const data = await providerProductivity(from, to);
  return toCsv(
    ['Bác sĩ', 'Tổng lịch hẹn', 'Đã hoàn thành', 'Đơn thuốc'],
    data.map((d) => [d.doctorName, d.appointments, d.completed, d.prescriptions]),
  );
}

export async function exportAppointmentsTimelineCsv(from: Date, to: Date): Promise<string> {
  const data = await appointmentsTimeline(from, to);
  return toCsv(
    ['Ngày', 'Tổng', 'Hoàn thành', 'Đã huỷ', 'Không đến'],
    data.map((d) => [d.day, d.total, d.completed, d.cancelled, d.noShow]),
  );
}

// ── nội bộ ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(query: SelectQueryBuilder<Database, keyof Database, any>): Promise<number> {
  const row = await query.select((eb) => eb.fn.countAll<string>().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}
