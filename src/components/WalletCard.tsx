import React from 'react';
import { motion } from 'motion/react';
import { Lock, Unlock, Zap, Bus, Wifi, Utensils, Coffee, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Wallet, GateDecision } from '../services/gatekeeper';

interface WalletCardProps {
  wallet: Wallet;
  onWithdraw: (id: string) => void;
  loading: boolean;
}

const iconMap: Record<string, React.ReactNode> = {
  fare: <Bus className="w-6 h-6" />,
  tokens: <Zap className="w-6 h-6" />,
  data: <Wifi className="w-6 h-6" />,
  meat: <Utensils className="w-6 h-6" />,
  energy: <Coffee className="w-6 h-6" />,
};

export const WalletCard: React.FC<WalletCardProps> = ({ wallet, onWithdraw, loading }) => {
  const effectiveMax = wallet.maxFrequency + wallet.rolloverBonus;
  const remaining = Math.max(0, effectiveMax - wallet.usedFrequency);
  const isLocked = wallet.locked || remaining === 0;

  const categoryLabels: Record<string, { label: string, color: string }> = {
    fare: { label: 'Essential', color: 'bg-indigo-50 text-indigo-700' },
    tokens: { label: 'Utilities', color: 'bg-blue-50 text-blue-700' },
    data: { label: 'Emergency', color: 'bg-rose-50 text-rose-700' },
    meat: { label: 'Nutrition', color: 'bg-amber-50 text-amber-700' },
    energy: { label: 'Burnout Support', color: 'bg-purple-50 text-purple-700' },
  };

  const cat = categoryLabels[wallet.id] || { label: 'System', color: 'bg-slate-100 text-slate-700' };

  return (
    <motion.div
      layout
      id={`wallet-${wallet.id}`}
      className={`relative overflow-hidden rounded-xl border-2 p-5 flex flex-col justify-between transition-all bg-white ${
        isLocked 
          ? 'border-slate-200 grayscale opacity-70' 
          : 'border-slate-200 shadow-sm hover:border-indigo-200'
      }`}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${cat.color}`}>
            {cat.label}
          </span>
          <h2 className="text-lg font-bold mt-1 flex items-center gap-2">
            <span className="opacity-70">{iconMap[wallet.id]}</span>
            {wallet.name}
          </h2>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Allocation</p>
          <p className="font-mono font-bold text-sm">KES {wallet.allocation.toFixed(2)}</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex gap-1.5 h-1.5">
          {Array.from({ length: effectiveMax }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 rounded-full ${
                i < wallet.usedFrequency 
                  ? 'bg-slate-900' 
                  : i >= wallet.maxFrequency 
                    ? 'border border-dashed border-indigo-400 bg-indigo-50' 
                    : 'bg-slate-100'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto">
        <div className="flex gap-4">
          <div className="text-center">
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Freq</p>
            <p className="text-xs font-mono font-bold">
              {wallet.usedFrequency}/{effectiveMax}
              {wallet.rolloverBonus > 0 && <span className="text-[10px] text-indigo-600 ml-1">+{wallet.rolloverBonus}</span>}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Slot</p>
            <p className="text-xs font-mono font-bold">KES {wallet.perWithdrawalAmount}</p>
          </div>
        </div>

        <button
          id={`withdraw-btn-${wallet.id}`}
          disabled={isLocked || loading}
          onClick={() => onWithdraw(wallet.id)}
          className={`px-4 py-2 rounded text-[10px] font-bold tracking-widest transition-all ${
            isLocked
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : loading
              ? 'bg-indigo-600/50 text-white cursor-wait'
              : 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:scale-95'
          }`}
        >
          {loading ? 'PROCESSING' : isLocked ? 'LOCKED' : 'REQUEST ACCESS'}
        </button>
      </div>

      {wallet.lastWithdrawalDate && (
        <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center text-[9px] font-mono opacity-50">
          <span>TX_READY</span>
          <span>{new Date(wallet.lastWithdrawalDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      )}
    </motion.div>
  );
};
