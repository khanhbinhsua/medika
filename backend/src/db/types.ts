import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
// pg trả numeric dạng string (giữ nguyên độ chính xác); ghi vào chấp nhận
// number|string, hoặc bỏ trống (undefined) khi cột có DEFAULT.
type Numeric = ColumnType<string, number | string | undefined, number | string>;

export type UserStatus = 'active' | 'suspended' | 'disabled';
export type PatientStatus = 'active' | 'inactive' | 'deceased' | 'merged';
export type AppointmentStatus =
  | 'scheduled' | 'confirmed' | 'checked_in' | 'in_progress'
  | 'completed' | 'cancelled' | 'no_show';
export type PrescriptionStatus = 'active' | 'completed' | 'cancelled' | 'expired';
export type SeverityLevel = 'mild' | 'moderate' | 'severe' | 'life_threatening';
export type ConsentType = 'treatment' | 'privacy_notice' | 'data_sharing' | 'research' | 'marketing';
export type AuditOutcome = 'success' | 'failure' | 'denied';
export type KeyStatus = 'active' | 'rotating' | 'retired' | 'destroyed';

export interface RolesTable {
  id: Generated<string>;
  name: string;
  description: Generated<string>;
  is_system: Generated<boolean>;
  created_at: Timestamp;
}

export interface PermissionsTable {
  id: Generated<string>;
  code: string;
  description: Generated<string>;
}

export interface RolePermissionsTable {
  role_id: string;
  permission_id: string;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  full_name: string;
  role_id: string;
  status: Generated<UserStatus>;
  locale: Generated<string>;
  mfa_enabled: Generated<boolean>;
  failed_login_attempts: Generated<number>;
  locked_until: Timestamp | null;
  password_changed_at: Timestamp;
  last_login_at: Timestamp | null;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MfaSecretsTable {
  user_id: string;
  secret_enc: Buffer;
  dek_id: string;
  recovery_codes_hashed: Generated<string[]>;
  confirmed_at: Timestamp | null;
  /** Bước TOTP (unix_time/30) đã dùng gần nhất — chặn tái sử dụng mã. */
  last_used_step: string | null;
  created_at: Timestamp;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  refresh_token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  last_activity_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoked_reason: string | null;
  created_at: Timestamp;
}

export interface PasswordResetTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  created_at: Timestamp;
}

export interface EncryptionKeysTable {
  id: Generated<string>;
  key_type: string;
  wrapped_dek: Buffer;
  kek_reference: string;
  version: Generated<number>;
  status: Generated<KeyStatus>;
  created_at: Timestamp;
  rotated_at: Timestamp | null;
  destroyed_at: Timestamp | null;
}

export interface PatientsTable {
  id: Generated<string>;
  mrn: string;
  first_name_enc: Buffer;
  last_name_enc: Buffer;
  name_search_hash: string;
  dob_enc: Buffer;
  gender: string | null;
  email_enc: Buffer | null;
  email_search_hash: string | null;
  phone_enc: Buffer | null;
  phone_search_hash: string | null;
  insurance_id_enc: Buffer | null;
  address_enc: Buffer | null;
  zalo_id_enc: Buffer | null;
  dek_id: string;
  status: Generated<PatientStatus>;
  created_by: string;
  /** External link to the DK-link patient id (integration sync). Unique when set. */
  dklink_patient_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
  /** Thời điểm DEK bị crypto-shredded — khác null nghĩa là PHI vĩnh viễn không giải mã được. */
  purged_at: Timestamp | null;
  purged_by: string | null;
  purged_reason: string | null;
}

export interface PatientContactsTable {
  id: Generated<string>;
  patient_id: string;
  contact_type: string;
  name_enc: Buffer;
  value_enc: Buffer;
  relationship_enc: Buffer | null;
  is_primary: Generated<boolean>;
  created_at: Timestamp;
}

export interface PatientAllergiesTable {
  id: Generated<string>;
  patient_id: string;
  allergy_name: string;
  reaction: string | null;
  severity: Generated<SeverityLevel>;
  notes_enc: Buffer | null;
  recorded_by: string;
  recorded_at: Timestamp;
}

export interface PatientMedicalHistoryTable {
  id: Generated<string>;
  patient_id: string;
  condition: string;
  icd10_code: string | null;
  status: Generated<string>;
  notes_enc: Buffer | null;
  onset_date: Date | null;
  recorded_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PatientConsentsTable {
  id: Generated<string>;
  patient_id: string;
  consent_type: ConsentType;
  granted: boolean;
  document_version: string;
  granted_at: Timestamp;
  revoked_at: Timestamp | null;
  witnessed_by: string | null;
  notes: string | null;
}

export interface AppointmentsTable {
  id: Generated<string>;
  patient_id: string;
  doctor_id: string;
  branch_id: string | null;
  source: Generated<string>;
  scheduled_start: Timestamp;
  scheduled_end: Timestamp;
  room: string | null;
  status: Generated<AppointmentStatus>;
  /** Lý do khám — PHI, mã hoá bằng DEK của bệnh nhân. */
  reason_enc: Buffer | null;
  checked_in_at: Timestamp | null;
  completed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  cancel_reason_enc: Buffer | null;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AppointmentNotesTable {
  id: Generated<string>;
  appointment_id: string;
  note_enc: Buffer;
  author_id: string;
  created_at: Timestamp;
}

export interface PatientPortalAccountsTable {
  id: Generated<string>;
  patient_id: string;
  login_email_hash: string;
  password_hash: string;
  status: Generated<string>;
  failed_login_attempts: Generated<number>;
  locked_until: Timestamp | null;
  last_login_at: Timestamp | null;
  must_change_password: Generated<boolean>;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PatientPortalSessionsTable {
  id: Generated<string>;
  portal_account_id: string;
  refresh_token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  last_activity_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoked_reason: string | null;
  created_at: Timestamp;
}

export type ReminderChannel = 'email' | 'sms';
export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface AppointmentRemindersTable {
  id: Generated<string>;
  appointment_id: string;
  channel: Generated<ReminderChannel>;
  scheduled_for: Timestamp;
  sent_at: Timestamp | null;
  status: Generated<ReminderStatus>;
  failure_reason: string | null;
  attempts: Generated<number>;
  last_attempt_at: Timestamp | null;
  created_at: Timestamp;
}

export interface PrescriptionsTable {
  id: Generated<string>;
  patient_id: string;
  prescriber_id: string;
  medication: string;
  rxnorm_code: string | null;
  dosage: string;
  frequency: string;
  duration_days: number | null;
  quantity: string | null;
  instructions_enc: Buffer | null;
  status: Generated<PrescriptionStatus>;
  prescribed_at: Timestamp;
  expires_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DocumentsTable {
  id: Generated<string>;
  patient_id: string;
  file_name_enc: Buffer;
  mime_type: string;
  size_bytes: string;
  storage_key: string;
  file_dek_enc: Buffer;
  sha256: string;
  uploaded_by: string;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface AuditLogsTable {
  id: Generated<string>;
  request_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: unknown | null;
  ip_address: string | null;
  user_agent: string | null;
  outcome: Generated<AuditOutcome>;
  reason: string | null;
  prev_hash: string;
  entry_hash: string;
  created_at: Timestamp;
}

export interface PhiAccessLogsTable {
  id: Generated<string>;
  request_id: string | null;
  patient_id: string;
  accessed_by: string;
  access_type: string;
  fields_accessed: Generated<string[]>;
  purpose: string | null;
  ip_address: string | null;
  accessed_at: Timestamp;
}

export type NotificationChannel = 'zalo' | 'sms' | 'email';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';
export type NotificationKind =
  | 'appointment_reminder'
  | 'appointment_confirm'
  | 'appointment_cancel'
  | 'rebooking_reminder'
  | 'treatment_next'
  | 'survey'
  | 'marketing'
  | 'custom';

export interface NotificationTemplatesTable {
  id: Generated<string>;
  code: string;
  name: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  subject: string | null;
  content: string;
  zalo_template_id: string | null;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface NotificationsTable {
  id: Generated<string>;
  patient_id: string;
  kind: NotificationKind;
  status: Generated<NotificationStatus>;
  channel_sent: NotificationChannel | null;
  provider_message_id: string | null;
  scheduled_at: Timestamp;
  sent_at: Timestamp | null;
  read_at: Timestamp | null;
  attempts: Generated<number>;
  last_error: string | null;
  related_type: string | null;
  related_id: string | null;
  created_by: string | null;
  created_at: Timestamp;
}

export interface NotificationLogsTable {
  id: Generated<string>;
  notification_id: string;
  channel: NotificationChannel;
  event: string;
  detail: string | null;
  at: Timestamp;
}

export type TreatmentPlanStatus = 'draft' | 'pending_approval' | 'active' | 'completed' | 'cancelled';
export type TreatmentStepStatus = 'pending' | 'scheduled' | 'completed' | 'skipped' | 'cancelled';

export interface TreatmentPlanTemplatesTable {
  id: Generated<string>;
  code: string;
  name: string;
  condition: string | null;
  description: string | null;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TreatmentPlanTemplateStepsTable {
  id: Generated<string>;
  template_id: string;
  step_order: number;
  title: string;
  description: string | null;
  estimated_cost: Numeric;
  created_at: Timestamp;
}

export interface TreatmentPlansTable {
  id: Generated<string>;
  patient_id: string;
  doctor_id: string;
  template_id: string | null;
  title_enc: Buffer;
  status: Generated<TreatmentPlanStatus>;
  total_cost: Numeric;
  approved_by: string | null;
  approved_at: Timestamp | null;
  cancel_reason_enc: Buffer | null;
  cancelled_at: Timestamp | null;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TreatmentStepsTable {
  id: Generated<string>;
  treatment_plan_id: string;
  step_order: number;
  title_enc: Buffer;
  description_enc: Buffer | null;
  cost: Numeric;
  status: Generated<TreatmentStepStatus>;
  scheduled_date: Timestamp | null;
  completed_at: Timestamp | null;
  appointment_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'read';
export type CareStatus = 'pending' | 'sent' | 'cancelled';

// Tiêu chí phân nhóm — chỉ trên trường KHÔNG phải PHI (query được bằng SQL).
export interface SegmentCriteria {
  gender?: string | undefined;
  minVisits?: number | undefined;
  maxVisits?: number | undefined;
  conditionLike?: string | undefined; // khớp patient_medical_history.condition / icd10_code
  inactiveSinceDays?: number | undefined; // không có lịch hẹn trong N ngày (win-back)
  newWithinDays?: number | undefined; // bệnh nhân tạo trong N ngày
  minTotalSpend?: number | undefined; // tổng chi tiêu ≥ (VND) — nhắm khách VIP
  maxTotalSpend?: number | undefined; // tổng chi tiêu ≤ (VND)
}

export interface CustomerSegmentsTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  // jsonb: pg trả về object đã parse; ghi vào bằng chuỗi JSON.
  criteria: ColumnType<SegmentCriteria, string, string>;
  active: Generated<boolean>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CampaignsTable {
  id: Generated<string>;
  name: string;
  segment_id: string | null;
  kind: NotificationKind;
  message: string;
  status: Generated<CampaignStatus>;
  scheduled_at: Timestamp | null;
  sent_at: Timestamp | null;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CampaignRecipientsTable {
  id: Generated<string>;
  campaign_id: string;
  patient_id: string;
  notification_id: string | null;
  status: Generated<CampaignRecipientStatus>;
  sent_at: Timestamp | null;
  opened_at: Timestamp | null;
  error: string | null;
}

export interface PostTreatmentCareTable {
  id: Generated<string>;
  patient_id: string;
  treatment_plan_id: string | null;
  care_type: string;
  message: string;
  status: Generated<CareStatus>;
  scheduled_at: Timestamp;
  sent_at: Timestamp | null;
  notification_id: string | null;
  created_by: string | null;
  created_at: Timestamp;
}

export type SurveyType = 'nps' | 'csat' | 'custom';
export type SurveyStatus = 'draft' | 'active' | 'closed';
export type SurveyInvitationStatus = 'pending' | 'sent' | 'responded' | 'failed';

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'choice';
  required?: boolean | undefined;
  // scale: thang điểm tuỳ chỉnh + nhãn hai đầu + câu điểm chính + ngưỡng tiêu cực.
  min?: number | undefined;
  max?: number | undefined;
  lowLabel?: string | undefined;
  highLabel?: string | undefined;
  primary?: boolean | undefined; // câu đưa vào score/báo cáo (mỗi khảo sát 1 câu)
  negativeAtOrBelow?: number | undefined; // điểm ≤ ngưỡng → chấm cờ tiêu cực
  // choice:
  options?: string[] | undefined;
}

export interface SurveysTable {
  id: Generated<string>;
  name: string;
  type: SurveyType;
  questions: ColumnType<SurveyQuestion[], string, string>;
  status: Generated<SurveyStatus>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SurveyInvitationsTable {
  id: Generated<string>;
  survey_id: string;
  patient_id: string;
  appointment_id: string | null;
  doctor_id: string | null;
  token_hash: string;
  status: Generated<SurveyInvitationStatus>;
  notification_id: string | null;
  sent_at: Timestamp | null;
  responded_at: Timestamp | null;
  created_at: Timestamp;
}

export interface SurveyResponsesTable {
  id: Generated<string>;
  survey_id: string;
  invitation_id: string | null;
  patient_id: string;
  appointment_id: string | null;
  doctor_id: string | null;
  score: number | null;
  answers_enc: Buffer | null;
  comment_enc: Buffer | null;
  is_negative: Generated<boolean>;
  submitted_at: Timestamp;
}

export interface PatientTransactionsTable {
  id: Generated<string>;
  patient_id: string;
  occurred_at: Timestamp;
  amount: Numeric;
  category: Generated<string>;
  note_enc: Buffer | null;
  source: Generated<string>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface SpendingTiersTable {
  code: string;
  name: string;
  min_total: Numeric;
  sort: number;
}

export interface Icd10CodesTable {
  code: string;
  name: string;
  search: string;
}

export interface BranchesTable {
  id: Generated<string>;
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  geo_radius_m: number | null;
  opening_hours: ColumnType<Record<string, unknown>, string | undefined, string>;
  holidays: ColumnType<unknown[], string | undefined, string>;
  slot_capacity: number | null;
  is_default: Generated<boolean>;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserBranchesTable {
  user_id: string;
  branch_id: string;
}

export type BookingStatus = 'pending' | 'confirmed' | 'rejected';

export interface BookingRequestsTable {
  id: Generated<string>;
  branch_id: string;
  requested_start: Timestamp;
  requested_end: Timestamp;
  full_name: string;
  phone: string;
  note: string | null;
  status: Generated<BookingStatus>;
  source: Generated<string>;
  confirmed_appointment_id: string | null;
  reject_reason: string | null;
  handled_by: string | null;
  handled_at: Timestamp | null;
  created_at: Timestamp;
}

export interface Database {
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  users: UsersTable;
  mfa_secrets: MfaSecretsTable;
  sessions: SessionsTable;
  password_reset_tokens: PasswordResetTokensTable;
  encryption_keys: EncryptionKeysTable;
  patients: PatientsTable;
  patient_contacts: PatientContactsTable;
  patient_allergies: PatientAllergiesTable;
  patient_medical_history: PatientMedicalHistoryTable;
  patient_consents: PatientConsentsTable;
  appointments: AppointmentsTable;
  appointment_notes: AppointmentNotesTable;
  appointment_reminders: AppointmentRemindersTable;
  patient_portal_accounts: PatientPortalAccountsTable;
  patient_portal_sessions: PatientPortalSessionsTable;
  prescriptions: PrescriptionsTable;
  documents: DocumentsTable;
  audit_logs: AuditLogsTable;
  phi_access_logs: PhiAccessLogsTable;
  notification_templates: NotificationTemplatesTable;
  notifications: NotificationsTable;
  notification_logs: NotificationLogsTable;
  treatment_plan_templates: TreatmentPlanTemplatesTable;
  treatment_plan_template_steps: TreatmentPlanTemplateStepsTable;
  treatment_plans: TreatmentPlansTable;
  treatment_steps: TreatmentStepsTable;
  customer_segments: CustomerSegmentsTable;
  campaigns: CampaignsTable;
  campaign_recipients: CampaignRecipientsTable;
  post_treatment_care: PostTreatmentCareTable;
  surveys: SurveysTable;
  survey_invitations: SurveyInvitationsTable;
  survey_responses: SurveyResponsesTable;
  patient_transactions: PatientTransactionsTable;
  spending_tiers: SpendingTiersTable;
  icd10_codes: Icd10CodesTable;
  branches: BranchesTable;
  user_branches: UserBranchesTable;
  booking_requests: BookingRequestsTable;
}
