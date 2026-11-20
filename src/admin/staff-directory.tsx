// Active staff for the assignment pickers and for showing names instead of emails.
import { useEffect, useState } from 'react';
import { api } from './api';

export interface StaffEntry {
  email: string;
  name: string;
}

let cached: Promise<StaffEntry[]> | null = null;

/** Loads the directory once per page load; a failure leaves an empty list (emails still show). */
export function useStaffDirectory(): StaffEntry[] {
  const [list, setList] = useState<StaffEntry[]>([]);
  useEffect(() => {
    let live = true;
    cached ??= api.get<StaffEntry[]>('/api/admin/staff-directory').catch(() => {
      cached = null;
      return [];
    });
    void cached.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** Test hook: forget the cached directory. */
export const resetStaffDirectory = () => {
  cached = null;
};

/** A staff member's name, their email when not in the directory, or 未分配. */
export function staffName(list: StaffEntry[], email: string | null): string {
  if (!email) return '未分配';
  return list.find((s) => s.email === email)?.name ?? email;
}

/**
 * Picker for a staff assignment. `value` '' means unassigned. A current assignee who is no longer
 * active still shows, so editing something else never silently drops them.
 */
export function StaffSelect({
  id, label, value, onChange, list, invalid,
}: { id: string; label: string; value: string; onChange: (v: string) => void; list: StaffEntry[]; invalid?: boolean }) {
  const known = value === '' || list.some((s) => s.email === value);
  return (
    <select id={id} aria-label={label} value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)}>
      <option value="">未分配</option>
      {!known && <option value={value}>{value}</option>}
      {list.map((s) => (
        <option key={s.email} value={s.email}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
