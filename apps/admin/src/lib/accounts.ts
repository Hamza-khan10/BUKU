/** One person's account as the API shows it to platform admins (3.6). */
export interface Account {
  id: string;
  name: string;
  email: string | null;
  role: string;
  /** active | suspended | deleted */
  status: string;
  since: string;
  lastSignIn: string | null;
  deletionRequested: string | null;
  twoStep: boolean;
  sessions: number;
  employeeLogin: boolean;
  businesses: { id: string | null; name: string; role: string; status: string }[];
}

export const ROLE_NAMES: Record<string, string> = {
  user: 'Customer',
  business_owner: 'Business owner',
  staff: 'Staff',
  super_admin: 'Platform admin',
};
