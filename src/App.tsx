import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db, auth } from './services/firebase';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { WalletCard } from './components/WalletCard';
import { Wallet } from './services/gatekeeper';
import { LayoutDashboard, History, ShieldCheck, CreditCard, RefreshCw, LogIn, LogOut, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from './lib/errorHandlers';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setWallets([]);
      setRecentTransactions([]);
      return;
    }

    // Listen to wallets
    const unsubWallets = onSnapshot(collection(db, 'wallets'), (snapshot) => {
      const walletList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Wallet));
      setWallets(walletList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'wallets');
    });

    // Listen to recent transactions
    const q = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(10));
    const unsubTransactions = onSnapshot(q, (snapshot) => {
      const txList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecentTransactions(txList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'transactions');
    });

    return () => {
      unsubWallets();
      unsubTransactions();
    };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login Failed:', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleWithdraw = async (walletId: string) => {
    setLoading(walletId);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletId })
      });
      const result = await response.json();

      if (!response.ok) {
        setStatusMessage({ type: 'error', text: result.message || 'Withdrawal Denied' });
      } else {
        setStatusMessage({ type: 'success', text: `Access Granted! KES Disbursement initiated.` });
      }
    } catch (error) {
      setStatusMessage({ type: 'error', text: 'Connection Failure' });
    } finally {
      setLoading(null);
      // Clear status message after 5s
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full text-center space-y-8 glass-panel p-12 border-slate-200 bg-white">
          <div className="w-16 h-16 bg-indigo-500 rounded-2xl mx-auto flex items-center justify-center text-white shadow-xl">
            <ShieldCheck className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">FinanceOS</h1>
            <p className="text-slate-500 mt-2">Behavioral Gatekeeper v1.0.4</p>
          </div>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-slate-800 transition-all active:scale-95"
          >
            <LogIn className="w-5 h-5" /> Authenticate with Google
          </button>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Restricted Access // Private Protocol</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col font-sans overflow-hidden text-slate-900">
      {/* Header: System Context */}
      <header className="h-20 bg-slate-900 shrink-0 text-white flex items-center justify-between px-8 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-500 rounded flex items-center justify-center">
             <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase">FINANCE_OS // CORE</h1>
            <p className="text-xs text-slate-400 font-mono uppercase tracking-widest">GATE-AUTH PROTOCOL v1.0.4</p>
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
            <p className="text-xs text-slate-400">B2C Status</p>
            <p className="text-sm font-semibold text-emerald-400 flex items-center justify-end gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> DARAJA ONLINE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 pl-8 border-l border-white/10">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-bold text-white/40 uppercase truncate max-w-[100px]">{user.email}</p>
            <button onClick={handleLogout} className="text-[10px] font-bold text-rose-400 uppercase hover:text-rose-300">De-authenticate</button>
          </div>
          <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-white/20 bg-white/5" />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 p-6 grid grid-cols-1 md:grid-cols-12 gap-6 bg-slate-50 overflow-auto">
        
        {/* Left Column: Active Wallets Grid */}
        <div className="md:col-span-8 flex flex-col min-h-0">
          <h2 className="section-header">
            <CreditCard className="w-3.5 h-3.5" /> ACTIVE_ACCESS_CHANNELS
          </h2>
          <div className="finance-grid mb-6">
            {wallets.length === 0 ? (
              [1, 2, 3, 4, 5].map(i => (
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
            <div className={`p-4 rounded-xl border flex items-center gap-3 transition-opacity duration-500 ${
              statusMessage 
                ? (statusMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700')
                : 'opacity-0 bg-slate-100 border-slate-200'
            }`}>
              <div className={`p-1 rounded-full ${statusMessage?.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                {statusMessage?.type === 'success' ? <ShieldCheck className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              </div>
              <p className="text-xs font-bold uppercase tracking-tight">
                {statusMessage?.text || 'GATE STANDBY'}
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Ledger & Logic Trace */}
        <div className="md:col-span-4 flex flex-col min-h-0 bg-white border-2 border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">LEDGER & TRACE</h3>
            <History className="w-3.5 h-3.5 text-slate-400" />
          </div>
          
          <div className="flex-1 overflow-auto p-4 space-y-6">
            <AnimatePresence mode="popLayout">
              {recentTransactions.map((tx) => (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={tx.id} 
                  className="flex gap-3"
                >
                  <div className={`w-1 shrink-0 rounded-full ${
                    tx.status === 'success' ? 'bg-emerald-500' : 
                    tx.status === 'denied' ? 'bg-rose-500' : 
                    'bg-amber-500'
                  }`}></div>
                  <div>
                    <p className="text-[9px] text-slate-400 font-mono tracking-tighter">
                      {new Date(tx.timestamp).toLocaleTimeString()} // ID_{tx.id.slice(0,6).toUpperCase()}
                    </p>
                    <p className="text-xs font-bold uppercase">
                      {tx.walletId}: {tx.status === 'success' ? 'GATE_APPROVAL' : `ENTRY_DENIED [${tx.reason || 'FAILED'}]`}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1 italic leading-tight">
                      {tx.status === 'success' ? 'B2C PaymentRequest fired. Transaction ledger updated.' : 'Request aborted by security middleware.'}
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

          {/* Logic Summary Panel */}
          <div className="code-panel shrink-0 border-t border-slate-800">
            <p className="text-indigo-400 text-[9px] font-bold mb-1">// ROLLOVER_POLICY</p>
            <p>IF USED &lt; MAX THEN ACCEL_SLOT = 1 [CAPPED 1]</p>
            <p>MONEY_ROLLOVER: FORCE_DISABLE</p>
            
            <p className="mt-3 text-indigo-400 text-[9px] font-bold mb-1">// GATE_SEQUENCE_INTEGRITY</p>
            <div className="flex gap-4">
              <p>G1: DAY_FREQ</p>
              <p>G2: WEEK_COUNT</p>
              <p>G3: LIQUIDITY</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="h-12 bg-white border-t border-slate-200 px-8 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Secure Environment</p>
          </div>
          <p className="text-[10px] text-slate-400 font-mono hidden sm:block">
            Latency: 42ms // Node: 20.x // Ledger: Firestore // B2C: Active
          </p>
        </div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] italic">
          Restraint Governs Abundance.
        </p>
      </footer>
    </div>
  );
}
