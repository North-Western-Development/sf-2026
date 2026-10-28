import { useCallback, useEffect, useState } from 'react';
import { STAFF_PERMISSIONS, type StaffPermission } from '@subspace/constants';
import { http } from '../../lib/http';
import { toast } from '../../app/ui';

export interface StaffRole {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: number;
  isRoot: boolean;
  builtIn: boolean;
  legacyRank: number | null;
  badgeId: string | null;
  members: number;
}

/** The signed-in staff member's own rank and what it allows. */
export interface ConsoleMe {
  role: StaffRole;
  permissions: number;
  position: number;
}

export interface CustomBadge {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  criteriaType: 'manual' | 'staff_role' | 'account_age' | 'transmissions_sent' | 'voice_minutes';
  threshold: number;
  holders: number;
}

export const can = (me: ConsoleMe | null, p: StaffPermission) => !!me && (me.permissions & STAFF_PERMISSIONS[p]) !== 0;

/** A rank the signed-in staff member may give, edit or delete: below their own (Root: any). */
export const manages = (me: ConsoleMe | null, role: StaffRole) => !!me && (me.role.isRoot || role.position < me.position);

/** Someone's rank: the one assigned, else the built-in rank their staff_rank stands for. */
export const roleOf = (roles: StaffRole[], u: { staffRoleId?: string | null; staffRank?: number }) =>
  roles.find((r) => r.id === u.staffRoleId) ?? (!u.staffRoleId && (u.staffRank ?? 0) > 0 ? roles.find((r) => r.legacyRank === Math.min(u.staffRank ?? 0, 3)) : undefined) ?? null;

/** Every staff rank, highest first; reload after changing one. */
export function useStaffRoles() {
  const [roles, setRoles] = useState<StaffRole[] | null>(null);
  const load = useCallback(
    () =>
      http
        .get<{ roles: StaffRole[] }>('/console/staff-roles')
        .then((r) => setRoles(r.roles))
        .catch((err) => toast((err as Error).message, 'error')),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { roles, reload: load };
}

export const BADGE_RULE_LABELS: Record<CustomBadge['criteriaType'], { label: string; unit?: string }> = {
  manual: { label: 'Given by staff' },
  staff_role: { label: 'Worn by a staff rank' },
  account_age: { label: 'Account age', unit: 'days' },
  transmissions_sent: { label: 'Messages sent', unit: 'messages' },
  voice_minutes: { label: 'Time in voice', unit: 'minutes' },
};

export function describeBadgeRule(b: Pick<CustomBadge, 'criteriaType' | 'threshold'>) {
  const rule = BADGE_RULE_LABELS[b.criteriaType];
  return rule.unit ? `${rule.label}: ${b.threshold.toLocaleString()} ${rule.unit}` : rule.label;
}
