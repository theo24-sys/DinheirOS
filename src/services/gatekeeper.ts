import { isSameDay, parseISO } from 'date-fns';

export interface Wallet {
  id: string;
  name: string;
  allocation: number;
  maxFrequency: number;
  usedFrequency: number;
  perWithdrawalAmount: number;
  lastWithdrawalDate: string | null;
  locked: boolean;
  rolloverBonus: number;
}

export enum GateDecision {
  DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED',
  WEEKLY_LIMIT_EXCEEDED = 'WEEKLY_LIMIT_EXCEEDED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  APPROVED = 'APPROVED',
  LOCKED = 'LOCKED'
}

export function evaluateGates(wallet: Wallet): GateDecision {
  // Gate 0: Basic Lock Check
  if (wallet.locked) {
    return GateDecision.LOCKED;
  }

  // Gate 1: Daily Limit Check (One withdrawal per day)
  if (wallet.lastWithdrawalDate) {
    const lastDate = parseISO(wallet.lastWithdrawalDate);
    if (isSameDay(lastDate, new Date())) {
      return GateDecision.DAILY_LIMIT_EXCEEDED;
    }
  }

  // Gate 2: Weekly Limit Check
  const effectiveMax = wallet.maxFrequency + wallet.rolloverBonus;
  if (wallet.usedFrequency >= effectiveMax) {
    return GateDecision.WEEKLY_LIMIT_EXCEEDED;
  }

  // Gate 3: Balance Check (Allocation covers the per-access amount)
  // In this system, perWithdrawalAmount is derived from allocation / maxFrequency
  // so logically it should always pass if not locked, but we check if money exists
  if (wallet.allocation <= 0) {
    return GateDecision.INSUFFICIENT_FUNDS;
  }

  return GateDecision.APPROVED;
}

export const WALLET_CONFIGS = [
  {
    id: 'fare',
    name: 'Fare (Transport)',
    allocation: 420,
    maxFrequency: 3,
    perWithdrawalAmount: 140,
    dailyLimit: 1
  },
  {
    id: 'tokens',
    name: 'Electricity Tokens',
    allocation: 180,
    maxFrequency: 1,
    perWithdrawalAmount: 180,
    dailyLimit: 1
  },
  {
    id: 'data',
    name: 'Emergency Data',
    allocation: 100,
    maxFrequency: 2,
    perWithdrawalAmount: 50,
    dailyLimit: 1
  },
  {
    id: 'meat',
    name: 'Nutrition (Meat)',
    allocation: 300,
    maxFrequency: 2,
    perWithdrawalAmount: 150,
    dailyLimit: 1
  },
  {
    id: 'energy',
    name: 'Energy Drinks',
    allocation: 180,
    maxFrequency: 3,
    perWithdrawalAmount: 60,
    dailyLimit: 1
  }
];
