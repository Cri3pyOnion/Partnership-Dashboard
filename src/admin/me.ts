import { createContext, useContext } from 'react';
import type { Staff } from '../shared/types';

export type Me = Pick<Staff, 'email' | 'name' | 'role' | 'team'>;

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}
