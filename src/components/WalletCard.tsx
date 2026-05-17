import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Unlock, TrendingUp, DollarSign, Zap, AlertCircle, CheckCircle2, Flame, Gem } from 'lucide-react';
import { Wallet, GateDecision } from '../services/gatekeeper';

interface WalletCardProps {
  wallet: Wallet;
  onWithdraw: (id: string) => void;
  loading: boolean;
}

const iconMap: Record<string, { icon: React.ReactNode; gradient: string; color: string }> = {
  food: { 
    icon: <DollarSign className="w-8 h-8" />, 
    gradient: 'from-emerald-400 to-teal-500',
    color: 'emerald'
  },
  transport: { 
    icon: <TrendingUp className="w-8 h-8" />, 
    gradient: 'from-blue-400 to-cyan-500',
    color: 'blue'
  },
  utilities: { 
    icon: <Zap className="w-8 h-8" />, 
    gradient: 'from-yellow-400 to-orange-500',
    color: 'amber'
  },
  emergency: { 
    icon: <Flame className="w-8 h-8" />, 
    gradient: 'from-red-400 to-pink-500',
    color: 'red'
  },
  wellness: { 
    icon: <Gem className="w-8 h-8" />, 
    gradient: 'from-purple-400 to-pink-500',
    color: 'purple'
  },
};

export const WalletCard: React.FC<WalletCardProps> = ({ wallet, onWithdraw, loading }) => {
  const effectiveMax = wallet.maxFrequency + wallet.rolloverBonus;
  const remaining = Math.max(0, effectiveMax - wallet.usedFrequency);
  const isLocked = wallet.locked || remaining === 0;
  const usagePercent = (wallet.usedFrequency / effectiveMax) * 100;

  const walletConfig = iconMap[wallet.id] || {
    icon: <DollarSign className="w-8 h-8" />,
    gradient: 'from-slate-400 to-slate-500',
    color: 'slate'
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
      id={`wallet-${wallet.id}`}
      className={`relative overflow-hidden rounded-2xl backdrop-blur-xl transition-all border ${
        isLocked 
          ? 'border-slate-600/30 bg-slate-800/30 opacity-60' 
          : 'border-slate-600/30 bg-slate-800/50 hover:border-slate-500/50 hover:bg-slate-700/60 hover:shadow-2xl hover:shadow-slate-900/50'
      }`}
    >
      {/* Animated background gradient */}
      {!isLocked && (
        <motion.div
          className={`absolute inset-0 bg-gradient-to-br ${walletConfig.gradient} opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none`}
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* Floating money icons */}
      {!isLocked && (
        <>
          <motion.div
            className="absolute top-4 right-4 opacity-10"
            animate={{ y: [-10, 10, -10], rotate: [0, 5, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <DollarSign className="w-12 h-12 text-emerald-400" />
          </motion.div>
          <motion.div
            className="absolute bottom-4 left-4 opacity-10"
            animate={{ y: [10, -10, 10], rotate: [0, -5, 0] }}
            transition={{ duration: 4, repeat: Infinity }}
          >
            <TrendingUp className="w-12 h-12 text-blue-400" />
          </motion.div>
        </>
      )}

      <div className="relative z-10 p-6 flex flex-col h-full justify-between">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <motion.div
              animate={{ scale: isLocked ? 1 : [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className={`p-3 rounded-xl bg-gradient-to-br ${walletConfig.gradient} shadow-lg`}
            >
              <div className="text-white">{walletConfig.icon}</div>
            </motion.div>
            <div>
              <p className="text-xs text-slate-400 uppercase font-bold tracking-widest mb-1">Access Channel</p>
              <h2 className="text-lg font-black text-white">{wallet.name}</h2>
            </div>
          </div>
          {isLocked ? (
            <Lock className="w-5 h-5 text-red-400" />
          ) : (
            <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}>
              <Unlock className="w-5 h-5 text-emerald-400" />
            </motion.div>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 mb-6 bg-slate-900/50 rounded-xl p-4">
          <div className="text-center">
            <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Allocation</p>
            <motion.p
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-sm font-black text-emerald-400"
            >
              KES {(wallet.allocation / 1000).toFixed(1)}K
            </motion.p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Per Slot</p>
            <motion.p className="text-sm font-black text-blue-400">
              KES {wallet.perWithdrawalAmount}
            </motion.p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Remaining</p>
            <motion.p className={`text-sm font-black ${remaining > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {remaining}/{effectiveMax}
            </motion.p>
          </div>
        </div>

        {/* Progress Bar with Animation */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-slate-400 uppercase font-bold">Weekly Usage</p>
            <motion.p
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-[10px] text-slate-300 font-mono"
            >
              {usagePercent.toFixed(0)}%
            </motion.p>
          </div>
          <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${usagePercent}%` }}
              transition={{ duration: 1 }}
              className={`h-full rounded-full bg-gradient-to-r ${
                remaining > 2 ? 'from-emerald-400 to-teal-500' :
                remaining > 0 ? 'from-yellow-400 to-orange-500' :
                'from-red-400 to-pink-500'
              }`}
            />
          </div>
        </div>

        {/* Frequency Dots */}
        <div className="mb-6">
          <p className="text-[10px] text-slate-400 uppercase font-bold mb-2">Withdrawal Slots</p>
          <div className="flex gap-2">
            {Array.from({ length: effectiveMax }).map((_, i) => (
              <motion.div
                key={i}
                whileHover={{ scale: 1.2 }}
                className={`h-3 flex-1 rounded-full transition-all ${
                  i < wallet.usedFrequency
                    ? 'bg-gradient-to-r from-emerald-400 to-teal-500'
                    : i >= wallet.maxFrequency
                      ? 'bg-slate-700 border border-dashed border-emerald-500/50'
                      : 'bg-slate-700/50'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Withdraw Button */}
        <motion.button
          whileHover={!isLocked && !loading ? { scale: 1.02 } : {}}
          whileTap={!isLocked && !loading ? { scale: 0.98 } : {}}
          disabled={isLocked || loading}
          onClick={() => onWithdraw(wallet.id)}
          className={`w-full py-3 rounded-lg font-black text-sm uppercase tracking-wider transition-all relative overflow-hidden ${
            isLocked
              ? 'bg-slate-700/30 text-slate-500 cursor-not-allowed border border-slate-700'
              : loading
                ? 'bg-slate-600/50 text-slate-300 cursor-wait border border-slate-600'
                : `bg-gradient-to-r ${walletConfig.gradient} text-white shadow-lg hover:shadow-xl border border-slate-600/30`
          }`}
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                />
                Processing...
              </motion.div>
            ) : isLocked ? (
              <motion.div
                key="locked"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                Wallet Locked
              </motion.div>
            ) : (
              <motion.div
                key="ready"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Request Disbursement
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Footer Info */}
        {wallet.lastWithdrawalDate && !isLocked && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            className="text-[9px] text-slate-400 font-mono mt-3 text-center"
          >
            Last: {new Date(wallet.lastWithdrawalDate).toLocaleDateString()}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
};
