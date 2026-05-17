import React, { useState, useEffect } from 'react';
import { WalletCard } from './components/WalletCard';
import { Wallet } from './services/gatekeeper';
import { 
  Fingerprint, TrendingUp, TrendingDown, Zap, DollarSign, 
  Calendar, Clock, LogOut, AlertCircle, Lock, Eye, EyeOff, Unlock 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LocalAuthService, apiCall } from './services/auth';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
};

const pulseVariants = {
  animate: {
    scale: [1, 1.05, 1],
    transition: { duration: 2, repeat: Infinity }
  }
};

const floatVariants = {
  animate: {
    y: [0, -10, 0],
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' }
  }
};

export default function App() {
  const [authStatus, setAuthStatus] = useState(LocalAuthService.getAuthStatus());
  const [isPinSetup, setIsPinSetup] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Calculate stats
  const totalAllocation = wallets.reduce((sum, w) => sum + w.allocation, 0);
  const totalUsed = wallets.reduce((sum, w) => sum + (w.perWithdrawalAmount * w.usedFrequency), 0);
  const totalRemaining = totalAllocation - totalUsed;
  const usagePercentage = totalAllocation > 0 ? (totalUsed / totalAllocation) * 100 : 0;

  // Check PIN setup and auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const pinSet = await LocalAuthService.isPinSet();
        setIsPinSetup(pinSet);
        const biometric = await LocalAuthService.checkBiometric();
        setBiometricAvailable(biometric.available);
        setAuthLoading(false);
      } catch (error) {
        console.error('Auth check failed:', error);
        setAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  // Load wallets when authenticated
  useEffect(() => {
    if (!authStatus.isAuthenticated) return;

    const fetchData = async () => {
      try {
        const walletsData = await apiCall('/api/wallets');
        setWallets(walletsData);

        const txData = await apiCall('/api/transactions?limit=10');
        setRecentTransactions(txData);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [authStatus.isAuthenticated]);

  const handleSetupPin = async () => {
    if (pin.length < 4 || pin.length > 8) {
      setStatusMessage({ type: 'error', text: 'PIN must be 4-8 digits' });
      return;
    }
    if (!/^\d+$/.test(pin)) {
      setStatusMessage({ type: 'error', text: 'PIN must contain only digits' });
      return;
    }

    try {
      await LocalAuthService.setupPin(pin);
      setPin('');
      setIsPinSetup(true);
      setStatusMessage({ type: 'success', text: 'PIN setup successful!' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error: any) {
      setStatusMessage({ type: 'error', text: error.message });
    }
  };

  const handleLogin = async () => {
    try {
      await LocalAuthService.authenticateWithPin(pin);
      setPin('');
      setAuthStatus(LocalAuthService.getAuthStatus());
      setStatusMessage({ type: 'success', text: 'Access Granted!' });
    } catch (error: any) {
      setStatusMessage({ type: 'error', text: error.message });
    }
  };

  const handleBiometric = async () => {
    try {
      await LocalAuthService.authenticateWithFingerprint();
      setAuthStatus(LocalAuthService.getAuthStatus());
      setStatusMessage({ type: 'success', text: 'Fingerprint Verified!' });
    } catch (error: any) {
      setStatusMessage({ type: 'error', text: error.message });
    }
  };

  const handleLogout = () => {
    LocalAuthService.logout();
    setAuthStatus(LocalAuthService.getAuthStatus());
    setPin('');
    setWallets([]);
    setRecentTransactions([]);
    setStatusMessage({ type: 'success', text: 'Logged Out' });
  };

  const handleWithdraw = async (walletId: string) => {
    setLoading(walletId);
    setStatusMessage(null);
    try {
      const response = await apiCall('/api/withdraw', {
        method: 'POST',
        body: JSON.stringify({ walletId })
      });
      setStatusMessage({ type: 'success', text: `💰 KES ${response.amount} Disbursed!` });
      
      const walletsData = await apiCall('/api/wallets');
      setWallets(walletsData);
      const txData = await apiCall('/api/transactions?limit=10');
      setRecentTransactions(txData);
    } catch (error: any) {
      setStatusMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(null);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity }} className="flex flex-col items-center gap-4">
          <DollarSign className="w-16 h-16 text-emerald-400" />
          <div className="h-2 w-32 bg-slate-700 rounded-full overflow-hidden">
            <motion.div className="h-full bg-emerald-400" animate={{ width: ['0%', '100%', '0%'] }} transition={{ duration: 2, repeat: Infinity }} />
          </div>
        </motion.div>
      </div>
    );
  }

  // PIN Setup Screen
  if (!isPinSetup) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 flex items-center justify-center p-4 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <motion.div className="absolute top-10 right-10 w-40 h-40 bg-emerald-400/10 rounded-full blur-3xl" animate={floatVariants} />
          <motion.div className="absolute bottom-20 left-10 w-60 h-60 bg-blue-400/10 rounded-full blur-3xl" animate={floatVariants} />
        </div>

        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 max-w-md w-full">
          <motion.div variants={itemVariants} className="bg-slate-800/80 backdrop-blur-xl border border-emerald-500/30 rounded-3xl p-8 shadow-2xl">
            <motion.div variants={itemVariants} className="flex justify-center mb-8">
              <motion.div animate={pulseVariants} className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg">
                <DollarSign className="w-10 h-10 text-white" />
              </motion.div>
            </motion.div>

            <motion.div variants={itemVariants} className="text-center mb-8">
              <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400 mb-2">FinanceOS</h1>
              <p className="text-slate-400 text-sm">Create Your Security PIN</p>
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-4">
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter 4-8 digit PIN"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-4 bg-slate-700/50 border border-emerald-500/50 rounded-xl text-center text-3xl tracking-widest font-mono focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 transition-all text-emerald-400"
                />
                <button
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400 transition-colors"
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSetupPin}
                disabled={pin.length < 4}
                className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold py-4 rounded-xl hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-emerald-500/50"
              >
                Setup PIN
              </motion.button>
            </motion.div>

            {statusMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-4 p-3 rounded-lg text-sm font-bold ${
                  statusMessage.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50' : 'bg-red-500/20 text-red-300 border border-red-500/50'
                }`}
              >
                {statusMessage.text}
              </motion.div>
            )}

            <p className="text-[11px] text-slate-500 uppercase tracking-widest font-mono text-center mt-6">Personal Finance Control System</p>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // Login Screen
  if (!authStatus.isAuthenticated) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <motion.div className="absolute top-20 left-20 w-72 h-72 bg-blue-400/5 rounded-full blur-3xl" animate={floatVariants} />
          <motion.div className="absolute bottom-10 right-20 w-96 h-96 bg-emerald-400/5 rounded-full blur-3xl" animate={floatVariants} />
        </div>

        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 max-w-md w-full">
          <motion.div variants={itemVariants} className="bg-slate-800/80 backdrop-blur-xl border border-blue-500/30 rounded-3xl p-8 shadow-2xl">
            <motion.div variants={itemVariants} className="flex justify-center mb-8">
              <motion.div animate={pulseVariants} className="w-20 h-20 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <Unlock className="w-10 h-10 text-white" />
              </motion.div>
            </motion.div>

            <motion.div variants={itemVariants} className="text-center mb-8">
              <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">FinanceOS</h1>
              <p className="text-slate-400 text-sm">Enter Your PIN</p>
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-4">
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter PIN"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-4 bg-slate-700/50 border border-blue-500/50 rounded-xl text-center text-3xl tracking-widest font-mono focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 transition-all text-blue-400"
                />
                <button
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-400 transition-colors"
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleLogin}
                disabled={pin.length < 4}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-4 rounded-xl hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-blue-500/50"
              >
                Authenticate
              </motion.button>

              {biometricAvailable && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleBiometric}
                  className="w-full bg-gradient-to-r from-slate-700 to-slate-800 text-slate-200 font-bold py-3 rounded-xl hover:from-slate-600 hover:to-slate-700 transition-all flex items-center justify-center gap-2 border border-slate-600/50"
                >
                  <Fingerprint className="w-5 h-5" />
                  Use Fingerprint
                </motion.button>
              )}
            </motion.div>

            {statusMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-4 p-3 rounded-lg text-sm font-bold ${
                  statusMessage.type === 'success' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50' : 'bg-red-500/20 text-red-300 border border-red-500/50'
                }`}
              >
                {statusMessage.text}
              </motion.div>
            )}

            <p className="text-[11px] text-slate-500 uppercase tracking-widest font-mono text-center mt-6">Secure • Local • Personal</p>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // Main Dashboard
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" animate={floatVariants} />
        <motion.div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" animate={{ ...floatVariants, delay: 1 }} />
      </div>

      {/* Header */}
      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 bg-slate-900/50 backdrop-blur-lg border-b border-slate-700/50 sticky top-0">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <motion.div animate={pulseVariants} className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </motion.div>
              <div>
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400">FinanceOS</h1>
                <p className="text-xs text-slate-400">Behavioral Gatekeeper v1.0.6</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-all border border-red-500/50 text-sm font-bold"
            >
              <LogOut className="w-4 h-4" />
              Exit
            </motion.button>
          </div>
        </div>
      </motion.header>

      {/* Live Stats Dashboard */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {/* Total Budget */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-emerald-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Total Budget</p>
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3 }} className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-300">
              KES {totalAllocation.toLocaleString()}
            </motion.div>
            <p className="text-xs text-slate-500 mt-2">Weekly allocation</p>
          </motion.div>

          {/* Used */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-orange-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Used</p>
              <TrendingDown className="w-5 h-5 text-orange-400" />
            </div>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.4 }} className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-300">
              KES {totalUsed.toLocaleString()}
            </motion.div>
            <p className="text-xs text-slate-500 mt-2">{usagePercentage.toFixed(1)}% utilized</p>
          </motion.div>

          {/* Remaining */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-blue-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Remaining</p>
              <Zap className="w-5 h-5 text-blue-400" />
            </div>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.5 }} className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-300">
              KES {totalRemaining.toLocaleString()}
            </motion.div>
            <p className="text-xs text-slate-500 mt-2">{(100 - usagePercentage).toFixed(1)}% available</p>
          </motion.div>

          {/* Progress */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-purple-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Progress</p>
              <Calendar className="w-5 h-5 text-purple-400" />
            </div>
            <div className="relative h-16 flex items-center justify-center">
              <svg className="w-full h-full" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="none" stroke="#334155" strokeWidth="8" />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="url(#gradientPurple)"
                  strokeWidth="8"
                  strokeDasharray={`${(usagePercentage / 100) * 282.7} 282.7`}
                  initial={{ strokeDasharray: '0 282.7' }}
                  animate={{ strokeDasharray: `${(usagePercentage / 100) * 282.7} 282.7` }}
                  transition={{ duration: 1 }}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
                <defs>
                  <linearGradient id="gradientPurple" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute text-center">
                <p className="text-lg font-black text-purple-400">{usagePercentage.toFixed(0)}%</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Wallets Grid */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400 mb-6 flex items-center gap-2">
            <TrendingUp className="w-6 h-6" /> YOUR ACCESS CHANNELS
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {wallets.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
                  <Zap className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">Loading wallets...</p>
                </motion.div>
              </div>
            ) : (
              wallets.sort((a, b) => a.name.localeCompare(b.name)).map((wallet) => (
                <WalletCard
                  key={wallet.id}
                  wallet={wallet}
                  onWithdraw={handleWithdraw}
                  loading={loading === wallet.id}
                />
              ))
            )}
          </div>
        </motion.div>

        {/* Status Message */}
        <AnimatePresence>
          {statusMessage && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className={`fixed bottom-6 right-6 max-w-sm p-4 rounded-2xl border backdrop-blur-xl flex items-center gap-3 font-bold ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-red-500/20 border-red-500/50 text-red-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
              {statusMessage.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transaction Ledger */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="mt-12">
          <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-6 flex items-center gap-2">
            <Clock className="w-6 h-6" /> TRANSACTION LEDGER
          </h2>
          <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="divide-y divide-slate-700/50 max-h-96 overflow-auto">
              <AnimatePresence mode="popLayout">
                {recentTransactions.length === 0 ? (
                  <div className="p-8 text-center text-slate-400">
                    <motion.p animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
                      No transactions yet
                    </motion.p>
                  </div>
                ) : (
                  recentTransactions.map((tx, idx) => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-4 hover:bg-slate-700/30 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              tx.status === 'success' ? 'bg-emerald-400' : tx.status === 'denied' ? 'bg-red-400' : 'bg-amber-400'
                            }`}
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-200">
                              {tx.walletId}: {tx.status === 'success' ? '✓ APPROVED' : `✗ ${tx.reason || 'DENIED'}`}
                            </p>
                            <p className="text-xs text-slate-400">{new Date(tx.timestamp).toLocaleString()}</p>
                          </div>
                        </div>
                        <p className={`font-bold ${tx.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tx.status === 'success' ? '+' : '-'} KES {tx.amount}
                        </p>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}00/50 rounded-xl text-center text-3xl tracking-widest font-mono focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 transition-all text-emerald-400"
                />
                <button
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400 transition-colors"
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSetupPin}
                disabled={pin.length < 4}
                className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold py-4 rounded-xl hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-emerald-500/50"
              >
                Setup PIN
              </motion.button>
            </motion.div>

            {statusMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-4 p-3 rounded-lg text-sm font-bold ${
                  statusMessage.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50' : 'bg-red-500/20 text-red-300 border border-red-500/50'
                }`}
              >
                {statusMessage.text}
              </motion.div>
            )}

            <p className="text-[11px] text-slate-500 uppercase tracking-widest font-mono text-center mt-6">Personal Finance Control System</p>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // Login Screen
  if (!authStatus.isAuthenticated) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <motion.div className="absolute top-20 left-20 w-72 h-72 bg-blue-400/5 rounded-full blur-3xl" animate={floatVariants} />
          <motion.div className="absolute bottom-10 right-20 w-96 h-96 bg-emerald-400/5 rounded-full blur-3xl" animate={floatVariants} />
        </div>

        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 max-w-md w-full">
          <motion.div variants={itemVariants} className="bg-slate-800/80 backdrop-blur-xl border border-blue-500/30 rounded-3xl p-8 shadow-2xl">
            <motion.div variants={itemVariants} className="flex justify-center mb-8">
              <motion.div animate={pulseVariants} className="w-20 h-20 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <Unlock className="w-10 h-10 text-white" />
              </motion.div>
            </motion.div>

            <motion.div variants={itemVariants} className="text-center mb-8">
              <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">FinanceOS</h1>
              <p className="text-slate-400 text-sm">Enter Your PIN</p>
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-4">
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  placeholder="Enter PIN"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-4 bg-slate-700/50 border border-blue-500/50 rounded-xl text-center text-3xl tracking-widest font-mono focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 transition-all text-blue-400"
                />
                <button
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-400 transition-colors"
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleLogin}
                disabled={pin.length < 4}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold py-4 rounded-xl hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-blue-500/50"
              >
                Authenticate
              </motion.button>

              {biometricAvailable && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleBiometric}
                  className="w-full bg-gradient-to-r from-slate-700 to-slate-800 text-slate-200 font-bold py-3 rounded-xl hover:from-slate-600 hover:to-slate-700 transition-all flex items-center justify-center gap-2 border border-slate-600/50"
                >
                  <Fingerprint className="w-5 h-5" />
                  Use Fingerprint
                </motion.button>
              )}
            </motion.div>

            {statusMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-4 p-3 rounded-lg text-sm font-bold ${
                  statusMessage.type === 'success' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50' : 'bg-red-500/20 text-red-300 border border-red-500/50'
                }`}
              >
                {statusMessage.text}
              </motion.div>
            )}

            <p className="text-[11px] text-slate-500 uppercase tracking-widest font-mono text-center mt-6">Secure • Local • Personal</p>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // Main Dashboard
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" animate={floatVariants} />
        <motion.div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" animate={{ ...floatVariants, delay: 1 }} />
      </div>

      {/* Header */}
      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 bg-slate-900/50 backdrop-blur-lg border-b border-slate-700/50 sticky top-0">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <motion.div animate={pulseVariants} className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </motion.div>
              <div>
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400">FinanceOS</h1>
                <p className="text-xs text-slate-400">Behavioral Gatekeeper v1.0.6</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-all border border-red-500/50 text-sm font-bold"
            >
              <LogOut className="w-4 h-4" />
              Exit
            </motion.button>
          </div>
        </div>
      </motion.header>

      {/* Live Stats Dashboard */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {/* Total Budget */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-emerald-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Total Budget</p>
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3 }} className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-300">
              KES {totalAllocation.toLocaleString()}
            </motion.div>
            <p className="text-xs text-slate-500 mt-2">Weekly allocation</p>
          </motion.div>

          {/* Used */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-orange-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Used</p>
              <TrendingDown className="w-5 h-5 text-orange-400" />
            </div>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.4 }} className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-300">
              KES {totalUsed.toLocaleString()}
            </motion.div>
            <p className="text-xs text-slate-500 mt-2">{usagePercentage.toFixed(1)}% utilized</p>
          </motion.div>

          {/* Remaining */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-blue-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Remaining</p>
              <Zap className="w-5 h-5 text-blue-400" />
            </div>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.5 }} className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-300">
              KES {totalRemaining.toLocaleString()}
            </motion.div>
            <p className="text-xs text-slate-500 mt-2">{(100 - usagePercentage).toFixed(1)}% available</p>
          </motion.div>

          {/* Progress */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-slate-800/50 to-slate-700/30 border border-purple-500/30 rounded-2xl p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-400 text-sm font-bold uppercase">Progress</p>
              <Calendar className="w-5 h-5 text-purple-400" />
            </div>
            <div className="relative h-16 flex items-center justify-center">
              <svg className="w-full h-full" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="none" stroke="#334155" strokeWidth="8" />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="url(#gradientPurple)"
                  strokeWidth="8"
                  strokeDasharray={`${(usagePercentage / 100) * 282.7} 282.7`}
                  initial={{ strokeDasharray: '0 282.7' }}
                  animate={{ strokeDasharray: `${(usagePercentage / 100) * 282.7} 282.7` }}
                  transition={{ duration: 1 }}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
                <defs>
                  <linearGradient id="gradientPurple" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute text-center">
                <p className="text-lg font-black text-purple-400">{usagePercentage.toFixed(0)}%</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Wallets Grid */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400 mb-6 flex items-center gap-2">
            <TrendingUp className="w-6 h-6" /> YOUR ACCESS CHANNELS
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {wallets.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
                  <Zap className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">Loading wallets...</p>
                </motion.div>
              </div>
            ) : (
              wallets.sort((a, b) => a.name.localeCompare(b.name)).map((wallet) => (
                <WalletCard
                  key={wallet.id}
                  wallet={wallet}
                  onWithdraw={handleWithdraw}
                  loading={loading === wallet.id}
                />
              ))
            )}
          </div>
        </motion.div>

        {/* Status Message */}
        <AnimatePresence>
          {statusMessage && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className={`fixed bottom-6 right-6 max-w-sm p-4 rounded-2xl border backdrop-blur-xl flex items-center gap-3 font-bold ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-red-500/20 border-red-500/50 text-red-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
              {statusMessage.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transaction Ledger */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="mt-12">
          <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-6 flex items-center gap-2">
            <Clock className="w-6 h-6" /> TRANSACTION LEDGER
          </h2>
          <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="divide-y divide-slate-700/50 max-h-96 overflow-auto">
              <AnimatePresence mode="popLayout">
                {recentTransactions.length === 0 ? (
                  <div className="p-8 text-center text-slate-400">
                    <motion.p animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
                      No transactions yet
                    </motion.p>
                  </div>
                ) : (
                  recentTransactions.map((tx, idx) => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-4 hover:bg-slate-700/30 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              tx.status === 'success' ? 'bg-emerald-400' : tx.status === 'denied' ? 'bg-red-400' : 'bg-amber-400'
                            }`}
                          />
                          <div>
                            <p className="text-sm font-bold text-slate-200">
                              {tx.walletId}: {tx.status === 'success' ? '✓ APPROVED' : `✗ ${tx.reason || 'DENIED'}`}
                            </p>
                            <p className="text-xs text-slate-400">{new Date(tx.timestamp).toLocaleString()}</p>
                          </div>
                        </div>
                        <p className={`font-bold ${tx.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tx.status === 'success' ? '+' : '-'} KES {tx.amount}
                        </p>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
      {/* Header */}
      <header className="h-20 bg-slate-900 shrink-0 text-white flex items-center justify-between px-8 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-500 rounded flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase">FINANCE_OS // CORE</h1>
            <p className="text-xs text-slate-400 font-mono uppercase tracking-widest">PIN-AUTH PROTOCOL v1.0.5</p>
          </div>
        </div>

        <div className="hidden lg:flex gap-12 text-right uppercase font-mono">
          <div>
            <p className="text-xs text-slate-400">System Reset</p>
            <p className="text-sm font-semibold text-emerald-400">MONDAY 00:00</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Weekly Budget</p>
            <p className="text-sm font-semibold tracking-tighter">KES 1,250.00</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Server Status</p>
            <p className="text-sm font-semibold text-emerald-400 flex items-center justify-end gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> LOCAL RUNNING
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-rose-400 hover:text-rose-300 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-sm font-bold hidden sm:inline">Logout</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 p-6 grid grid-cols-1 md:grid-cols-12 gap-6 bg-slate-50 overflow-auto">
        {/* Left Column: Wallets */}
        <div className="md:col-span-8 flex flex-col min-h-0">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-600 mb-4 flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> ACTIVE_ACCESS_CHANNELS
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {wallets.length === 0 ? (
              [1, 2, 3, 4].map(i => (
                <div key={i} className="h-[200px] rounded-xl bg-slate-200 animate-pulse" />
              ))
            ) : (
              wallets.sort((a, b) => a.name.localeCompare(b.name)).map(wallet => (
                <WalletCard
                  key={wallet.id}
                  wallet={wallet}
                  onWithdraw={handleWithdraw}
                  loading={loading === wallet.id}
                />
              ))
            )}
          </div>

          <div className="mt-auto">
            <div
              className={`p-4 rounded-xl border flex items-center gap-3 transition-opacity duration-500 ${
                statusMessage
                  ? statusMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'opacity-0 bg-slate-100 border-slate-200'
              }`}
            >
              <div
                className={`p-1 rounded-full ${
                  statusMessage?.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                }`}
              >
                {statusMessage?.type === 'success' ? (
                  <ShieldCheck className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
              </div>
              <p className="text-xs font-bold uppercase tracking-tight">{statusMessage?.text || 'GATE STANDBY'}</p>
            </div>
          </div>
        </div>

        {/* Right Column: Transaction Ledger */}
        <div className="md:col-span-4 flex flex-col min-h-0 bg-white border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">LEDGER & TRACE</h3>
            <History className="w-4 h-4 text-slate-400" />
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-6">
            <AnimatePresence mode="popLayout">
              {recentTransactions.map(tx => (
                <motion.div key={tx.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
                  <div
                    className={`w-1 shrink-0 rounded-full ${
                      tx.status === 'success'
                        ? 'bg-emerald-500'
                        : tx.status === 'denied'
                          ? 'bg-rose-500'
                          : 'bg-amber-500'
                    }`}
                  ></div>
                  <div>
                    <p className="text-[9px] text-slate-400 font-mono tracking-tighter">
                      {new Date(tx.timestamp).toLocaleTimeString()} // ID_{tx.id.slice(0, 6).toUpperCase()}
                    </p>
                    <p className="text-xs font-bold uppercase">
                      {tx.walletId}: {tx.status === 'success' ? 'GATE_APPROVAL' : `ENTRY_DENIED [${tx.reason || 'FAILED'}]`}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1 italic leading-tight">
                      {tx.status === 'success' ? 'Payment initiated. Ledger updated.' : 'Request blocked by security rules.'}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {recentTransactions.length === 0 && (
              <div className="h-full flex items-center justify-center text-center p-8">
                <div>
                  <div className="w-8 h-1 bg-slate-100 mx-auto mb-4" />
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">No Trace Telemetry</p>
                </div>
              </div>
            )}
          </div>

          {/* Logic Summary */}
          <div className="bg-slate-900 text-slate-300 text-[9px] p-4 border-t border-slate-700 font-mono shrink-0">
            <p className="text-indigo-400 font-bold mb-1">// SECURITY_GATES</p>
            <p>G1: DAILY_LIMIT | G2: WEEKLY_COUNT | G3: LIQUIDITY</p>
            <p className="mt-2 text-indigo-400 font-bold mb-1">// ROLLOVER_POLICY</p>
            <p>IF_USED &lt; MAX THEN SLOT = 1 [CAPPED AT 1]</p>
          </div>
        </div>
      </main>
      {/* Footer */}
      <footer className="h-12 bg-white border-t border-slate-200 px-8 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Secure Local Environment</p>
          </div>
          <p className="text-[10px] text-slate-400 font-mono hidden sm:block">PIN-Protected // Local Storage // Rules Enforced</p>
        </div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] italic">Restraint Governs Abundance.</p>
      </footer>
    </div>
  );
}
