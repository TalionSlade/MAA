export interface Customer {
  id: string;
  name: string;
  email: string;
  preferredBranch?: string;
  previousAppointments?: AppointmentHistory[];
}

export interface AppointmentHistory {
  date: string;
  branch: string;
  banker: string;
  reason: string;
}

export interface Branch {
  id: string;
  name: string;
  bankers: Banker[];
}

export interface Banker {
  id: string;
  name: string;
  specialization: string;
  availability: string[];
}

export interface AppointmentFormData {
  customerNumber?: string;
  name: string;
  email: string;
  date: string;
  time: string;
  reason: string;
  branch: string;
  banker: string;
}