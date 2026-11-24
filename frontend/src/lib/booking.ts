import { apiClient } from './api-client';

export interface PublicBranch {
  id: string;
  name: string;
}

export interface BookingRequest {
  id: string;
  branchId: string;
  branchName: string;
  requestedStart: string;
  fullName: string;
  phone: string;
  note: string | null;
  status: string;
  createdAt: string;
}

export interface PatientMatch {
  id: string;
  mrn: string;
  name: string;
}

export interface Doctor {
  id: string;
  fullName: string;
}

// ── Public ──
export async function fetchPublicBranches(): Promise<PublicBranch[]> {
  const { data } = await apiClient.get<PublicBranch[]>('/public/booking/branches');
  return data;
}

export async function fetchSlots(branchId: string, date: string): Promise<string[]> {
  const { data } = await apiClient.get<string[]>('/public/booking/slots', { params: { branchId, date } });
  return data;
}

export async function submitBooking(input: {
  branchId: string;
  start: string;
  fullName: string;
  phone: string;
  note?: string;
}): Promise<{ id: string }> {
  const { data } = await apiClient.post<{ id: string }>('/public/booking', input);
  return data;
}

// ── Nhân sự ──
export async function fetchPendingBookings(): Promise<BookingRequest[]> {
  const { data } = await apiClient.get<BookingRequest[]>('/bookings');
  return data;
}

export async function fetchBookingMatches(id: string): Promise<PatientMatch[]> {
  const { data } = await apiClient.get<PatientMatch[]>(`/bookings/${id}/matches`);
  return data;
}

export async function confirmBooking(
  id: string,
  body: {
    doctorId: string;
    patientId?: string;
    newPatient?: { firstName: string; lastName: string; dob: string; gender?: string };
  },
): Promise<{ appointmentId: string; patientId: string }> {
  const { data } = await apiClient.post(`/bookings/${id}/confirm`, body);
  return data;
}

export async function rejectBooking(id: string, reason?: string): Promise<void> {
  await apiClient.post(`/bookings/${id}/reject`, { reason });
}

export async function fetchDoctors(): Promise<Doctor[]> {
  const { data } = await apiClient.get<Doctor[]>('/users/doctors');
  return data;
}
