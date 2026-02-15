import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  TrendingDown, Clock, Plus, AlertTriangle, BarChart3, 
  Check, X, Layout, List, RefreshCw, Save, Edit2,
  Ship, Plane, Factory, Calendar, AlertCircle, ArrowRight, Train, Trash2, Settings, LogOut, Lock
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';

/**
 * 智策供应链全景指挥系统 - 旗舰记忆增强版
 * * 核心逻辑说明：
 * 1. 采用静默式数据持久化引擎，满足用户“无云端感”但“有记忆”的需求。
 * 2. 严格修复存储路径段数问题，解决 appId 斜杠导致的权限拒绝。
 * 3. 增强型加载锁：确保旧数据读取完毕前，不触发任何写操作。
 */

// --- 1. 内部持久化引擎初始化 ---
// 说明：
// - 若存在 Firebase 配置，则启用 Firestore"记忆引擎"进行云端数据同步。
// - 若不存在，则使用默认数据（本地存储备份已移除）。
let db = null, auth = null;

// 你可以改这个名字：同一个 appId 就代表同一个“共享空间”
let appId = (import.meta.env.VITE_APP_ID || 'inventory-app').replace(/\//g, '_');

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 白名单配置
const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const isEmailAllowed = (email) => ALLOWED_EMAILS.includes(email.toLowerCase());

// 🔍 诊断：输出 Firebase 配置状态
console.log('🔍 Firebase 配置诊断：');
console.log('  apiKey:', firebaseConfig.apiKey ? '✅ 已配置' : '❌ 缺失');
console.log('  authDomain:', firebaseConfig.authDomain ? '✅ 已配置' : '❌ 缺失');
console.log('  projectId:', firebaseConfig.projectId ? '✅ 已配置' : '❌ 缺失');
console.log('  storageBucket:', firebaseConfig.storageBucket ? '✅ 已配置' : '❌ 缺失');
console.log('  messagingSenderId:', firebaseConfig.messagingSenderId ? '✅ 已配置' : '❌ 缺失');
console.log('  appId:', firebaseConfig.appId ? '✅ 已配置' : '❌ 缺失');

// 是否启用 Firebase（没配就走 localStorage）
const missingFirebaseEnv = [];
if (!firebaseConfig.apiKey) missingFirebaseEnv.push('VITE_FIREBASE_API_KEY');
if (!firebaseConfig.authDomain) missingFirebaseEnv.push('VITE_FIREBASE_AUTH_DOMAIN');
if (!firebaseConfig.projectId) missingFirebaseEnv.push('VITE_FIREBASE_PROJECT_ID');
if (!firebaseConfig.storageBucket) missingFirebaseEnv.push('VITE_FIREBASE_STORAGE_BUCKET');
if (!firebaseConfig.messagingSenderId) missingFirebaseEnv.push('VITE_FIREBASE_MESSAGING_SENDER_ID');
if (!firebaseConfig.appId) missingFirebaseEnv.push('VITE_FIREBASE_APP_ID');

const hasFirebase = missingFirebaseEnv.length === 0;
console.log('📦 Firebase 状态:', hasFirebase ? '✅ 准备初始化' : ('❌ 缺少配置项：' + missingFirebaseEnv.join(', ')));

try {
  if (hasFirebase) {
    console.log('🚀 正在初始化 Firebase...');
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    console.log('✅ Firebase Auth 初始化成功');

    // ✅ 关键增强：支持指定 Firestore 数据库 ID（多数据库场景）
    // - 绝大多数 Firebase 项目是默认库，无需配置
    // - 如果你在 GCP 控制台创建了非 (default) 的库，可通过 VITE_FIRESTORE_DB_ID 指定
    const firestoreDbId = (import.meta.env.VITE_FIRESTORE_DB_ID || '').trim();
    db = firestoreDbId ? getFirestore(app, firestoreDbId) : getFirestore(app);
    console.log('✅ Firestore 初始化成功，数据库:', firestoreDbId || '(默认)');
  }
} catch (e) {
  console.error('❌ Firebase 初始化失败：', e.code, e.message);
  db = null;
  auth = null;
}

const DEFAULT_DATA = [
  { id: 1, name: '旗舰商品 A (北美线)', currentStock: 1200, unitCost: 0, monthlySales: Array(12).fill(600), pos: [{ id: 101, poNumber: 'PO-20260214-001', orderDate: new Date().toISOString().split('T')[0], qty: 2500, prodDays: 30, leg1Mode: 'sea', leg1Days: 35, leg2Mode: 'rail', leg2Days: 15, leg3Mode: 'sea', leg3Days: 10 }] },
  { id: 2, name: '高周转新品 B (东南亚)', currentStock: 4000, unitCost: 0, monthlySales: Array(12).fill(800), pos: [] }
];

function sanitizeSkus(items) {
  const safeArr = Array.isArray(items) ? items : [];
  return safeArr
    .filter(Boolean)
    .map((sku, idx) => {
      const id = Number.isFinite(Number(sku.id)) ? Number(sku.id) : (idx + 1);
      const name = String(sku.name ?? `商品 #${id}`);
      const currentStock = Number(sku.currentStock ?? 0);
      const unitCostRaw = Number(sku.unitCost ?? 0);
      const unitCost = Number.isFinite(unitCostRaw) && unitCostRaw >= 0 ? unitCostRaw : 0;
      const monthlySalesRaw = Array.isArray(sku.monthlySales) ? sku.monthlySales : [];
      const monthlySales = Array.from({ length: 12 }).map((_, i) => Number(monthlySalesRaw[i] ?? 0));
      const posRaw = Array.isArray(sku.pos) ? sku.pos : [];
      const pos = posRaw.filter(Boolean).map((po) => ({
        id: Number.isFinite(Number(po.id)) ? Number(po.id) : Date.now(),
        poNumber: String(po.poNumber ?? ''),
        orderDate: String(po.orderDate ?? new Date().toISOString().split('T')[0]).slice(0, 10),
        qty: Number(po.qty ?? 0),
        prodDays: Number(po.prodDays ?? 0),
        leg1Mode: ['sea', 'air', 'rail'].includes(po.leg1Mode) ? po.leg1Mode : 'sea',
        leg1Days: Number(po.leg1Days ?? 0),
        leg2Mode: ['sea', 'air', 'rail'].includes(po.leg2Mode) ? po.leg2Mode : 'sea',
        leg2Days: Number(po.leg2Days ?? 0),
        leg3Mode: ['sea', 'air', 'rail'].includes(po.leg3Mode) ? po.leg3Mode : 'sea',
        leg3Days: Number(po.leg3Days ?? 0),
        status: ['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'].includes(po.status) ? po.status : 'ordered',
      }));
      return { id, name, currentStock, unitCost, monthlySales, pos };
    });
}

// ----------------- 本地兜底记忆（避免云端异常导致刷新丢失） -----------------
function loadLocalMemory(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLocalMemory(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

const App = () => {
  // --- 状态管理 ---
  const [viewMode, setViewMode] = useState('detail'); 
  const [selectedSkuId, setSelectedSkuId] = useState(null);
  const [skus, setSkus] = useState([]);
  const [user, setUser] = useState(null);
  // 认证状态：'loading' -> 'unauthenticated' (未登录) -> 'authenticated' (已登录) / 'error'
  const [status, setStatus] = useState('loading'); 
  
  // 登录表单状态
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // 核心锁：标记是否已完成从存储引擎的第一次读取，防止空覆盖
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false); 
  
  const [showSeasonality, setShowSeasonality] = useState(false);
  const [renamingSkuId, setRenamingSkuId] = useState(null);
  const [tempName, setTempName] = useState('');
  const [warning, setWarning] = useState('');

  // 本地兜底：即使云端异常，也不会因为刷新直接丢失
  const localKey = useMemo(() => `inventory_forecast:${appId}:shared_v1`, []);

  // 云端同步状态：'ready' = 就绪，'syncing' = 同步中，'error' = 错误，'offline' = 离线
  const [syncStatus, setSyncStatus] = useState(db ? 'ready' : 'offline');
  const [horizonDays, setHorizonDays] = useState(365);
  const [onlyInboundDays, setOnlyInboundDays] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickFill, setShowQuickFill] = useState(false);
  const [quickFillValue, setQuickFillValue] = useState('');
  const [poSortBy, setPoSortBy] = useState('orderDate'); // 'orderDate' 或 'arrivalDate'
  const [poOverviewFilter, setPoOverviewFilter] = useState('all'); // 'all' | 'followup'
  const [expandedPoId, setExpandedPoId] = useState(null); // 展开的采购单ID
  const [poFilter, setPoFilter] = useState('all'); // 'all', 'pending', 'completed'
  const [dashboardTheme, setDashboardTheme] = useState('dark'); // 'dark' 或 'light'
  const [draggedSkuId, setDraggedSkuId] = useState(null); // 正在拖拽的 SKU ID
  const [poViewMode, setPoViewMode] = useState('card'); // 'card' 或 'table'
  const [expandedPoGroups, setExpandedPoGroups] = useState({ pending: true, completed: false }); // 按状态分组的展开/收起

  // 设置状态 - 运输方式（可扩展）
  const [transportModes, setTransportModes] = useState([
    { id: 'sea', name: '方式1' },
    { id: 'air', name: '方式2' },
    { id: 'rail', name: '方式3' }
  ]);

  // 设置状态 - 预警时间（天）
  const [warningDays, setWarningDays] = useState(225); // 约7.5个月

  // 设置状态 - 预设参数
  const [defaultSettings, setDefaultSettings] = useState({
    defaultProdDays: 30,
    defaultLeg1Days: 30,
    defaultLeg2Days: 15,
    defaultLeg3Days: 0,
    defaultQty: 1000
  });

  // 防止 React.StrictMode 下开发环境 effect 双触发导致“重复初始化”
  const hydratedRef = useRef(false);
  const lastRemoteItemsJSONRef = useRef('');

  const transportOptions = transportModes.map(mode => {
    const iconMap = { sea: Ship, air: Plane, rail: Train };
    const fallbackIcon = Factory;
    return {
      value: mode.id,
      label: mode.name,
      icon: iconMap[mode.id] || fallbackIcon
    };
  });

  const memoryModeText = !db
    ? (missingFirebaseEnv.length
        ? `离线模式（缺少：${missingFirebaseEnv.join(', ')}）`
        : '离线模式（仅本地记忆）')
    : (syncStatus === 'ready' ? '✅ 云端同步已启用（多人共享）' : (syncStatus === 'syncing' ? '⏳ 正在同步中...' : '⚠️ 云端连接异常：已使用本地数据'));

  // 生成 PO 号的函数
  const generatePONumber = (skuId) => {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const sku = skus.find(s => s.id === skuId);
    if (!sku || !sku.pos) return `PO-${today}-001`;
    // 统计今天的 PO 数量
    const todayPOs = sku.pos.filter(p => {
      if (!p.poNumber) return false;
      const parts = String(p.poNumber).split('-');
      return parts[1] === today;
    });
    const count = String(todayPOs.length + 1).padStart(3, '0');
    return `PO-${today}-${count}`;
  };

  const clampNonNegativeInt = (raw, fieldLabel) => {
    let n = Number(raw);
    if (!Number.isFinite(n) || n < 0) n = 0;
    n = Math.floor(n);
    if (n > 1_000_000) {
      setWarning(`${fieldLabel} 超过 1,000,000 ，请确认是否输入有误`);
    }
    return n;
  };

  const clampNonNegativeNumber = (raw, fieldLabel) => {
    let n = Number(raw);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 1_000_000) {
      setWarning(`${fieldLabel} 超过 1,000,000 ，请确认是否输入有误`);
    }
    return n;
  };

  // --- 2. 身份认证逻辑 ---
  useEffect(() => {
    if (!auth) {
      console.warn('⚠️ Auth 未初始化，跳过身份认证');
      setStatus('error');
      return;
    }
    
    const unsubscribe = onAuthStateChanged(auth, (currUser) => {
      console.log('🔐 Auth 状态变化:', currUser ? `已登录 (${currUser.email})` : '未登录');
      if (currUser) {
        // 检查邮箱是否在白名单中
        if (!isEmailAllowed(currUser.email)) {
          console.log('❌ 邮箱不在白名单中:', currUser.email);
          signOut(auth).then(() => {
            setUser(null);
            setStatus('unauthenticated');
            setLoginError('❌ 你的邮箱未被授权访问此应用');
          });
          return;
        }
        setUser(currUser);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('unauthenticated');
      }
    });
    return () => unsubscribe();
  }, []);

  // --- 登录和登出函数 ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      if (!auth) {
        setLoginError('Firebase 未配置，无法登录');
        setIsLoggingIn(false);
        return;
      }
      if (!loginEmail.trim() || !loginPassword.trim()) {
        setLoginError('邮箱和密码不能为空');
        setIsLoggingIn(false);
        return;
      }

      // 检查邮箱是否在白名单中
      if (!isEmailAllowed(loginEmail)) {
        setLoginError(`❌ 邮箱 ${loginEmail} 未被授权访问此应用`);
        setIsLoggingIn(false);
        return;
      }

      console.log('🔐 尝试登录:', loginEmail);
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      console.log('✅ 登录成功');
      setLoginEmail('');
      setLoginPassword('');
    } catch (err) {
      console.error('❌ 登录失败:', err.code, err.message);
      
      if (err.code === 'auth/user-not-found') {
        setLoginError('❌ 该邮箱未注册，请联系管理员');
      } else if (err.code === 'auth/wrong-password') {
        setLoginError('❌ 密码错误');
      } else if (err.code === 'auth/invalid-email') {
        setLoginError('❌ 邮箱格式不正确');
      } else if (err.code === 'auth/too-many-requests') {
        setLoginError('❌ 登录尝试次数过多，请稍后再试');
      } else {
        setLoginError(`❌ 登录失败: ${err.message}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log('✅ 登出成功');
      setSkus([]);
      setSelectedSkuId(null);
      setLoginEmail('');
      setLoginPassword('');
      setLoginError('');
    } catch (err) {
      console.error('❌ 登出失败:', err.message);
      setLoginError('登出失败，请重试');
    }
  };

  // --- 3.0 本地数据初始化（仅一次） ---
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    console.log('📦 开始本地数据初始化...');

    const local = loadLocalMemory(localKey);
    if (local && Array.isArray(local.skus)) {
      const localSkus = sanitizeSkus(local.skus);
      if (localSkus.length > 0) {
        setSkus(localSkus);
        setSelectedSkuId((local.selectedSkuId && localSkus.some(s => s.id === local.selectedSkuId)) ? local.selectedSkuId : (localSkus[0]?.id ?? 1));
      }
      if (local.viewMode === 'detail' || local.viewMode === 'list') setViewMode(local.viewMode);
      // 加载本地设置
      if (local.warningDays) setWarningDays(local.warningDays);
      if (local.defaultSettings) setDefaultSettings(local.defaultSettings);
      if (local.transportModes) setTransportModes(local.transportModes);
      console.log('✅ 从本地恢复成功');
    } else {
      const initialData = sanitizeSkus(DEFAULT_DATA);
      setSkus(initialData);
      setSelectedSkuId(initialData[0]?.id ?? 1);
      setViewMode('detail');
      // 等待 auth 状态回调，避免未认证时短暂进入主界面
      console.log('✅ 使用默认数据');
    }

    if (!db) {
      console.log('⚠️ Firebase 未初始化，仅使用本地数据');
      setSyncStatus('offline');
      setIsInitialLoadDone(true);
    }
  }, [localKey, status]);

  // --- 3.1 Firestore 订阅（当 user 认证成功后执行） ---
  useEffect(() => {
    console.log('🔔 Firestore 订阅 effect 触发，db=', !!db, 'user=', user?.uid || null);
    if (!db) {
      console.log('⚠️ db 不存在，退出');
      return;
    }
    if (!user) {
      console.log('⏳ 等待用户认证...');
      return;
    }

    console.log('🔄 user 已认证，开始 Firestore 订阅，uid:', user.uid);
    const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');
    console.log('📍 Firestore 订阅路径:', 'inventory_apps/' + appId + '/shared/main');
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        setSyncStatus('ready');
        console.log('✅ 云端数据订阅成功');
        if (docSnap.exists()) {
          const remoteData = sanitizeSkus(docSnap.data().items || []);
          lastRemoteItemsJSONRef.current = JSON.stringify(remoteData);
          setSkus(remoteData);
          // 加载云端设置
          if (docSnap.data().warningDays) setWarningDays(docSnap.data().warningDays);
          if (docSnap.data().defaultSettings) setDefaultSettings(docSnap.data().defaultSettings);
          if (docSnap.data().transportModes) setTransportModes(docSnap.data().transportModes);
          if (remoteData.length > 0) {
            setSelectedSkuId(prev => (prev && remoteData.some(s => s.id === prev)) ? prev : remoteData[0].id);
          }
        } else {
          // 云端为空：用“本地现有/默认数据”初始化一次，避免后续刷新又回到初始
          const bootstrap = (() => {
            const local2 = loadLocalMemory(localKey);
            if (local2 && Array.isArray(local2.skus) && local2.skus.length > 0) return sanitizeSkus(local2.skus);
            return sanitizeSkus(DEFAULT_DATA);
          })();
          setSkus(bootstrap);
          setSelectedSkuId(bootstrap[0]?.id ?? 1);
          // 主动写入，确保云端 doc 被创建
          setDoc(docRef, { items: bootstrap, warningDays, defaultSettings, transportModes, lastUpdated: new Date().toISOString() }, { merge: true })
            .then(() => { 
              lastRemoteItemsJSONRef.current = JSON.stringify(bootstrap);
              console.log('✅ 云端初始化成功');
            })
            .catch((e) => {
              console.error('❌ 初始化云端失败:', e.code, e.message);
              setSyncStatus('error');
            });
        }

        setIsInitialLoadDone(true);
      },
      (err) => {
        // 常见：Firestore 配置指向了“没有创建 Firestore 数据库”的项目，或 projectId/authDomain 填错
        console.error('❌ Firestore 订阅错误:', err.code, err.message);
        console.log('🔍 可能的原因：');
        console.log('  1. 安全规则拒绝 (Permission denied)?');
        console.log('  2. Firestore 数据库未创建?');
        console.log('  3. 集合路径错误?');
        setSyncStatus('error');
        setIsInitialLoadDone(true); // 允许继续本地使用
      }
    );

    return () => unsubscribe();
  }, [user, db, appId, localKey]);

  // --- 4.1 本地兜底自动存档（始终开启） ---
  useEffect(() => {
    if (skus.length === 0) return;
    const timer = setTimeout(() => {
      saveLocalMemory(localKey, { skus, selectedSkuId, viewMode, warningDays, defaultSettings, transportModes, savedAt: Date.now() });
    }, 300);
    return () => clearTimeout(timer);
  }, [skus, selectedSkuId, viewMode, warningDays, defaultSettings, transportModes, localKey]);

  // --- 4.2 云端自动存档（多人共享） ---
  // 清理对象中的 undefined 值（Firestore 不支持 undefined）
  const cleanUndefinedValues = (obj) => {
    if (Array.isArray(obj)) {
      return obj.map(cleanUndefinedValues);
    } else if (obj !== null && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, cleanUndefinedValues(value)])
      );
    }
    return obj;
  };

  useEffect(() => {
    if (!db || !user) return;
    // 防丢保护：必须完成初始读取、且数据不为空才允许写回
    if (!isInitialLoadDone || skus.length === 0) return;

    const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');
    const localJSON = JSON.stringify(skus);
    if (localJSON === lastRemoteItemsJSONRef.current) return;

    const remoteTimer = setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        const cleanedSkus = cleanUndefinedValues(skus);
        await setDoc(docRef, { items: cleanedSkus, lastUpdated: new Date().toISOString() }, { merge: true });
        lastRemoteItemsJSONRef.current = localJSON;
        setSyncStatus('ready');
        console.log('✅ 云端数据同步成功');
      } catch (err) {
        console.error('❌ 自动云端存档失败:', err.code, err.message);
        setSyncStatus('error');
      }
    }, 1000);

    return () => clearTimeout(remoteTimer);
  }, [skus, user, isInitialLoadDone, appId, db]);

  // --- 4.3 设置自动云端保存 ---
  useEffect(() => {
    if (!db || !user || !isInitialLoadDone) return;
    
    const settingsTimer = setTimeout(async () => {
      try {
        const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');
        await setDoc(docRef, { 
          warningDays, 
          defaultSettings, 
          transportModes,
          lastUpdated: new Date().toISOString() 
        }, { merge: true });
        console.log('✅ 设置自动同步到云端');
      } catch (err) {
        console.error('⚠️ 设置云端同步失败:', err.message);
      }
    }, 1500);

    return () => clearTimeout(settingsTimer);
  }, [warningDays, defaultSettings, transportModes, user, isInitialLoadDone, appId, db]);

  // --- 5. 业务操作 ---
  const activeSku = useMemo(() => skus.find(s => s.id === (selectedSkuId || (skus[0]?.id))) || null, [skus, selectedSkuId]);

  const updateSku = (id, field, value) => {
    setSkus(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  // 添加新 SKU
  const addSku = () => {
    const newId = Math.max(...skus.map(s => s.id), 0) + 1;
    const newSku = {
      id: newId,
      name: `新建商品 ${newId}`,
      currentStock: 0,
      unitCost: 0,
      monthlySales: Array(12).fill(0),
      pos: []
    };
    setSkus(prev => [...prev, newSku]);
    setSelectedSkuId(newId);
  };

  // 快速填充月度销量
  const quickFillMonthlySales = () => {
    if (!quickFillValue || !activeSku) return;
    const value = Number(quickFillValue);
    if (!Number.isFinite(value) || value < 0) {
      setWarning('请输入有效的数值');
      return;
    }
    const monthlyValue = Math.floor(value / 12);
    const newMonthlySales = Array(12).fill(monthlyValue);
    // 处理余数，分配到各个月份
    const remainder = value % 12;
    for (let i = 0; i < remainder; i++) {
      newMonthlySales[i] += 1;
    }
    updateSku(activeSku.id, 'monthlySales', newMonthlySales);
    setShowQuickFill(false);
    setQuickFillValue('');
  };

  // SKU 删除
  const deleteSku = (skuId) => {
    const skuToDelete = skus.find(s => s.id === skuId);
    if (!skuToDelete) return;
    if (confirm(`确定要删除 "${skuToDelete.name}" 吗？此操作不可撤销。`)) {
      const newSkus = skus.filter(s => s.id !== skuId);
      setSkus(newSkus);
      // 如果删除的是当前选中的，切换到第一个
      if (selectedSkuId === skuId) {
        setSelectedSkuId(newSkus[0]?.id ?? null);
      }
    }
  };

  // SKU 复制
  const duplicateSku = (skuId) => {
    const skuToCopy = skus.find(s => s.id === skuId);
    if (!skuToCopy) return;
    const newId = Math.max(...skus.map(s => s.id), 0) + 1;
    const newSku = {
      ...JSON.parse(JSON.stringify(skuToCopy)),
      id: newId,
      name: `${skuToCopy.name} (副本)`
    };
    setSkus(prev => [...prev, newSku]);
    setSelectedSkuId(newId);
  };

  // 更名系统
  const startRenaming = (sku) => { setRenamingSkuId(sku.id); setTempName(sku.name); };
  const saveRenaming = () => { if (tempName.trim()) updateSku(renamingSkuId, 'name', tempName); setRenamingSkuId(null); };

  // SKU 拖拽排序
  const handleDragStart = (e, skuId) => {
    setDraggedSkuId(skuId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetSkuId) => {
    e.preventDefault();
    if (draggedSkuId === targetSkuId || !draggedSkuId) return;
    
    const draggedIndex = skus.findIndex(s => s.id === draggedSkuId);
    const targetIndex = skus.findIndex(s => s.id === targetSkuId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    const newSkus = [...skus];
    const [removed] = newSkus.splice(draggedIndex, 1);
    newSkus.splice(targetIndex, 0, removed);
    
    setSkus(newSkus);
    setDraggedSkuId(null);
  };

  const handleDragEnd = () => {
    setDraggedSkuId(null);
  };

  // 采购单系统
  const addPO = (skuId) => {
    setSkus(prev => prev.map(s => {
      if (s.id === skuId) {
        const poNumber = generatePONumber(skuId);
        const newPO = { id: Date.now(), poNumber, orderDate: new Date().toISOString().split('T')[0], qty: defaultSettings.defaultQty, prodDays: defaultSettings.defaultProdDays, leg1Mode: 'sea', leg1Days: defaultSettings.defaultLeg1Days, leg2Mode: 'sea', leg2Days: defaultSettings.defaultLeg2Days, leg3Mode: 'sea', leg3Days: defaultSettings.defaultLeg3Days, status: 'ordered' };
        return { ...s, pos: [...(s.pos || []), newPO] };
      }
      return s;
    }));
  };
  const updatePO = (skuId, poId, field, value) => {
    setSkus(prev => prev.map(s => s.id === skuId ? { ...s, pos: (s.pos || []).map(p => p.id === poId ? { ...p, [field]: value } : p) } : s));
  };
  const removePO = (skuId, poId) => setSkus(prev => prev.map(s => s.id === skuId ? { ...s, pos: (s.pos || []).filter(p => p.id !== poId) } : s));
  
  const duplicatePO = (skuId, poId) => {
    const sku = skus.find(s => s.id === skuId);
    if (!sku) return;
    const po = sku.pos?.find(p => p.id === poId);
    if (!po) return;
    const poNumber = generatePONumber(skuId);
    const newPO = {
      ...po,
      id: Date.now(),
      poNumber,
      orderDate: new Date().toISOString().split('T')[0], // 默认今天，方便修改
      status: 'ordered'
    };
    setSkus(prev => prev.map(s => s.id === skuId ? { ...s, pos: [...(s.pos || []), newPO] } : s));
  };

  const exportPOsToJSON = () => {
    if (!activeSku || !activeSku.pos || activeSku.pos.length === 0) {
      setWarning('当前商品没有采购单数据可导出');
      return;
    }
    const dataStr = JSON.stringify(activeSku.pos, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSku.name}_POs_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPOsToCSV = () => {
    if (!activeSku || !activeSku.pos || activeSku.pos.length === 0) {
      setWarning('当前商品没有采购单数据可导出');
      return;
    }
    const headers = ['下单日期', '采购数量', '生产周期(天)', '头程方式', '头程时效(天)', '二程方式', '二程时效(天)', '预计到货日'];
    const rows = activeSku.pos.map(po => {
      const arrivalDate = new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays) + Number(po.leg1Days) + Number(po.leg2Days)) * 86400000);
      return [
        po.orderDate,
        po.qty,
        po.prodDays,
        po.leg1Mode === 'sea' ? '海运' : po.leg1Mode === 'air' ? '空运' : '铁路',
        po.leg1Days,
        po.leg2Mode === 'sea' ? '海运' : po.leg2Mode === 'air' ? '空运' : '铁路',
        po.leg2Days,
        arrivalDate.toISOString().split('T')[0],
      ];
    });
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSku.name}_POs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importPOsFromJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (!Array.isArray(imported)) {
            setWarning('JSON 文件格式错误：应为数组格式');
            return;
          }
          const sanitized = imported.map((po, idx) => ({
            id: Number.isFinite(Number(po.id)) ? Number(po.id) : Date.now() + idx,
            orderDate: String(po.orderDate ?? new Date().toISOString().split('T')[0]).slice(0, 10),
            qty: clampNonNegativeInt(po.qty ?? 0, '采购数量'),
            prodDays: clampNonNegativeInt(po.prodDays ?? 0, '生产周期'),
            leg1Mode: ['sea', 'air', 'rail'].includes(po.leg1Mode) ? po.leg1Mode : 'sea',
            leg1Days: clampNonNegativeInt(po.leg1Days ?? 0, '头程时效'),
            leg2Mode: ['sea', 'air', 'rail'].includes(po.leg2Mode) ? po.leg2Mode : 'sea',
            leg2Days: clampNonNegativeInt(po.leg2Days ?? 0, '二程时效'),
          }));
          setSkus(prev => prev.map(s => s.id === activeSku.id ? { ...s, pos: [...(s.pos || []), ...sanitized] } : s));
        } catch (err) {
          setWarning('JSON 文件解析失败：' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const importPOsFromCSV = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target.result;
          const lines = text.split('\n').filter(l => l.trim());
          if (lines.length < 2) {
            setWarning('CSV 文件至少需要表头和数据行');
            return;
          }
          const imported = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length < 8) continue;
            const modeMap = { '海运': 'sea', '空运': 'air', '铁路': 'rail' };
            imported.push({
              id: Date.now() + i,
              orderDate: cols[0] || new Date().toISOString().split('T')[0],
              qty: clampNonNegativeInt(cols[1] ?? 0, '采购数量'),
              prodDays: clampNonNegativeInt(cols[2] ?? 0, '生产周期'),
              leg1Mode: modeMap[cols[3]] || 'sea',
              leg1Days: clampNonNegativeInt(cols[4] ?? 0, '头程时效'),
              leg2Mode: modeMap[cols[5]] || 'sea',
              leg2Days: clampNonNegativeInt(cols[6] ?? 0, '二程时效'),
            });
          }
          if (imported.length === 0) {
            setWarning('CSV 文件未解析到有效数据');
            return;
          }
          setSkus(prev => prev.map(s => s.id === activeSku.id ? { ...s, pos: [...(s.pos || []), ...imported] } : s));
        } catch (err) {
          setWarning('CSV 文件解析失败：' + err.message);
        }
      };
      reader.readAsText(file, 'UTF-8');
    };
    input.click();
  };

  // --- 6. 预测引擎 ---
  const generateForecast = (sku, days = 400) => {
    if (!sku) return { data: [], currentMonthRate: 0, monthEndStocks: [] };
    const data = [];
    let runningStock = Number(sku.currentStock || 0);
    const today = new Date();
    const dailyRates = (sku.monthlySales || Array(12).fill(0)).map(m => Number(m) / 30); 
    const monthEndStocks = [];

    for (let i = 0; i <= days; i++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dailyConsumption = dailyRates[currentDate.getMonth()];
      
      let incomingQty = 0;
      sku.pos?.forEach(po => {
        // 排除已取消的采购单
        if (po.status === 'cancelled') return;
        const arrival = new Date(po.orderDate);
        const totalLT = Number(po.prodDays || 0) + Number(po.leg1Days || 0) + Number(po.leg2Days || 0) + Number(po.leg3Days || 0);
        arrival.setDate(arrival.getDate() + totalLT);
        if (arrival.toISOString().split('T')[0] === dateStr) incomingQty += Number(po.qty || 0);
      });

      // 物理约束：库存不允许向下“透支”，先扣减再与 0 取最大值，再叠加到货量
      const afterConsumption = Math.max(0, runningStock - dailyConsumption);
      runningStock = afterConsumption + incomingQty;

      const status = runningStock <= 0 ? 'stockout' : (runningStock < dailyConsumption * warningDays ? 'low' : 'ok');
      const displayStock = Math.max(0, runningStock);
      data.push({ date: dateStr, stock: displayStock, status, incomingQty });
      if (new Date(currentDate.getTime() + 86400000).getMonth() !== currentDate.getMonth()) {
        monthEndStocks.push({ year: currentDate.getFullYear(), month: currentDate.getMonth() + 1, stock: runningStock, status });
      }
    }
    return { data, currentMonthRate: dailyRates[today.getMonth()], monthEndStocks };
  };

  const activeForecast = useMemo(() => generateForecast(activeSku, 365), [activeSku, warningDays]);
  const dashboardData = useMemo(() => skus.map(sku => {
    const f = generateForecast(sku, 400);
    
    let orderDateStr = "安全";
    let finalStockOutDate = "安全"; // 最终断货预测日期
    let urgency = 'normal', suggestQty = 0;
    let daysUntilStockout = 400; // 默认400天
    let monthsUntilStockout = (400 / 30).toFixed(1);
    let riskLevel = 'safe'; // 'safe' (绿) / 'warning' (黄) / 'critical' (红)
    let riskText = '12月+ 安全';
    
    // 改进的逻辑：
    // 如果当前库存为0或很低，且有待补货的PO，应该基于补货日期来计算覆盖天数
    let targetDayIndex = 400; // 默认安全
    
    // 检查是否有待补货的PO
    const activePOs = sku.pos?.filter(po => po.status !== 'cancelled') || [];
    
    if (Number(sku.currentStock || 0) === 0 && activePOs.length > 0) {
      // 当前库存为0，有待补货的PO
      // 找最早的补货日期
      let earliestArrivalIndex = -1;
      
      activePOs.forEach(po => {
        const arrival = new Date(po.orderDate);
        const totalLT = Number(po.prodDays || 0) + Number(po.leg1Days || 0) + Number(po.leg2Days || 0) + Number(po.leg3Days || 0);
        arrival.setDate(arrival.getDate() + totalLT);
        const arrivalStr = arrival.toISOString().split('T')[0];
        
        const idx = f.data.findIndex(d => d.date === arrivalStr);
        if (idx >= 0 && (earliestArrivalIndex === -1 || idx < earliestArrivalIndex)) {
          earliestArrivalIndex = idx;
        }
      });
      
      if (earliestArrivalIndex >= 0) {
        // 从最早的补货日期开始，计算还能覆盖多少天
        const remainingDays = f.data.slice(earliestArrivalIndex).findIndex(d => d.stock <= 0);
        targetDayIndex = remainingDays >= 0 ? remainingDays : 400;
      }
    } else {
      // 常规逻辑：查找最后库存>0的时刻
      let lastPositiveIdx = -1;
      for (let i = f.data.length - 1; i >= 0; i--) {
        if (f.data[i].stock > 0) {
          lastPositiveIdx = i;
          break;
        }
      }
      targetDayIndex = Math.max(0, lastPositiveIdx);
    }
    
    daysUntilStockout = Math.max(0, targetDayIndex);
    monthsUntilStockout = (daysUntilStockout / 30).toFixed(1);
    
    // 根据覆盖月数判断风险等级
    if (monthsUntilStockout >= 12) {
      riskLevel = 'safe';
      riskText = `${monthsUntilStockout}月 安全`;
    } else if (monthsUntilStockout >= 6) {
      riskLevel = 'warning';
      riskText = `${monthsUntilStockout}月 预警`;
    } else {
      riskLevel = 'critical';
      riskText = `${monthsUntilStockout}月 紧急`;
    }
    
    // 订单决策计算 - 基于最终断货日期（考虑补货恢复）
    if (targetDayIndex < 400) {
      const finalStockOutData = f.data[targetDayIndex];
      if (finalStockOutData) {
        finalStockOutDate = new Date(finalStockOutData.date).toLocaleDateString();
        orderDateStr = new Date(finalStockOutData.date).toLocaleDateString();
      }
    }

    // 补货建议: 现在下单应该补多少，才能覆盖 6.5 个月（安全周期）
    const safeCoverageMonths = 6.5;
    const safeCoverageDays = Math.ceil(safeCoverageMonths * 30);
    
    // 计算从今天到安全覆盖期末，需要消耗多少
    let cumulativeConsumption = 0;
    for (let i = 0; i < f.data.length && i < safeCoverageDays; i++) {
      const dateData = f.data[i];
      const monthIdx = new Date(dateData.date).getMonth();
      const monthConsumption = (sku.monthlySales?.[monthIdx] || 0) / 30; // 日均消耗
      cumulativeConsumption += monthConsumption;
    }
    
    const currentStock = Number(sku.currentStock || 0);
    suggestQty = Math.max(0, cumulativeConsumption - currentStock);
    
    // 计算每个月的有货状态（从当前日期往后推12个月）
    const monthlyAvailability = Array(12).fill(false);
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    
    // 对于接下来的12个月，检查是否有任何断货
    for (let i = 0; i < 12; i++) {
      let targetDate = new Date(currentYear, currentMonth + i, 1);
      const monthYear = targetDate.getFullYear();
      const monthIdx = targetDate.getMonth();
      
      // 生成该月的起始和结束日期
      const monthStart = new Date(monthYear, monthIdx, 1).toISOString().split('T')[0];
      const monthEnd = new Date(monthYear, monthIdx + 1, 0).toISOString().split('T')[0];
      
      // 检查这个月内是否有任何一天库存=0（断货）
      // 如果存在任何断货，monthlyAvailability为false（显示灰色）
      // 如果整个月都有货（没有任何一天=0），monthlyAvailability为true（显示绿色）
      const hasStockOutDay = f.data.some(d => d.date >= monthStart && d.date <= monthEnd && d.stock === 0);
      monthlyAvailability[i] = !hasStockOutDay;
    }
    
    // 计算PO到货月份（从当前日期往后推12个月）
    const monthlyPOs = Array(12).fill([]);
    activePOs.forEach(po => {
      const arrival = new Date(po.orderDate);
      const totalLT = Number(po.prodDays || 0) + Number(po.leg1Days || 0) + Number(po.leg2Days || 0) + Number(po.leg3Days || 0);
      arrival.setDate(arrival.getDate() + totalLT);
      
      // 检查这个到货日期是否在接下来的12个月内
      const poMonth = arrival.getMonth();
      const poYear = arrival.getFullYear();
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth();
      
      // 计算该PO相对于当前月份的索引
      let monthOffset = (poYear - currentYear) * 12 + (poMonth - currentMonth);
      
      if (monthOffset >= 0 && monthOffset < 12) {
        monthlyPOs[monthOffset] = [...(monthlyPOs[monthOffset] || []), po];
      }
    });
    
    return { ...sku, forecast: f, finalStockOutDate, orderDateStr, urgency, suggestQty, daysUntilStockout, monthsUntilStockout, riskLevel, riskText, monthlyAvailability, monthlyPOs };
  }), [skus, warningDays]);

  const coverageSummary = useMemo(() => {
    if (!activeForecast || !activeForecast.data || activeForecast.data.length === 0) return null;
    const idx = activeForecast.data.findIndex(d => d.stock <= 0);
    if (idx === -1) {
      return { safe: true, days: 365, months: (365 / 30).toFixed(1), stockoutDate: null };
    }
    return {
      safe: false,
      days: idx,
      months: (idx / 30).toFixed(1),
      stockoutDate: activeForecast.data[idx].date,
    };
  }, [activeForecast]);

  const fleetKpi = useMemo(() => {
    const today = new Date();
    const horizonDays = 365;
    const orderWindowDays = 60;
    let stockoutWithinHorizon = 0;
    let needOrderSoon = 0;

    dashboardData.forEach(sku => {
      if (sku.finalStockOutDate && sku.finalStockOutDate !== '安全') {
        const stockoutDate = new Date(sku.finalStockOutDate);
        const diffStockout = (stockoutDate - today) / 86400000;
        if (diffStockout >= 0 && diffStockout <= horizonDays) {
          stockoutWithinHorizon += 1;
        }

        if (sku.orderDateStr && sku.orderDateStr !== '安全') {
          const orderDeadline = new Date(sku.orderDateStr);
          const diffOrder = (orderDeadline - today) / 86400000;
          if (diffOrder <= orderWindowDays) {
            needOrderSoon += 1;
          }
        }
      }
    });

    return { stockoutWithinHorizon, needOrderSoon, orderWindowDays };
  }, [dashboardData]);

  const salesSummary = useMemo(() => {
    const totals = Array(12).fill(0);
    skus.forEach(sku => {
      (sku.monthlySales || []).forEach((v, i) => {
        totals[i] += Number(v) || 0;
      });
    });
    const annualTotal = totals.reduce((sum, v) => sum + v, 0);
    const monthlyAvg = annualTotal / 12;
    return { totals, annualTotal, monthlyAvg };
  }, [skus]);

  const stockSummary = useMemo(() => {
    const onHandStock = skus.reduce((sum, sku) => sum + Number(sku.currentStock || 0), 0);
    return { onHandStock };
  }, [skus]);

  const poSummary = useMemo(() => {
    const statusCounts = { ordered: 0, production: 0, shipping: 0, inspection: 0, completed: 0 };
    const arrivals = [];
    let openQty = 0;
    let openValue = 0;

    dashboardData.forEach(sku => {
      (sku.pos || []).forEach(po => {
        if (po.status === 'cancelled') return;
        const qty = Number(po.qty || 0);
        const totalLT = Number(po.prodDays || 0) + Number(po.leg1Days || 0) + Number(po.leg2Days || 0) + Number(po.leg3Days || 0);
        const arrivalDate = new Date(new Date(po.orderDate).getTime() + totalLT * 86400000).toISOString().split('T')[0];

        arrivals.push({
          skuName: sku.name,
          poNumber: po.poNumber,
          qty,
          arrivalDate,
        });

        if (po.status !== 'shelved') {
          openQty += qty;
          openValue += qty * Number(sku.unitCost || 0);
        }

        if (po.status === 'shelved') statusCounts.completed += 1;
        else if (['in_production', 'prod_complete'].includes(po.status)) statusCounts.production += 1;
        else if (['leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived'].includes(po.status)) statusCounts.shipping += 1;
        else if (['inspecting', 'picking', 'bonded_warehouse', 'pending_shelving'].includes(po.status)) statusCounts.inspection += 1;
        else statusCounts.ordered += 1;
      });
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextMonth = new Date(today);
    nextMonth.setDate(today.getDate() + 30);

    const nextArrivals = arrivals
      .filter(a => {
        const d = new Date(a.arrivalDate);
        return d >= today && d <= nextMonth;
      })
      .sort((a, b) => new Date(a.arrivalDate) - new Date(b.arrivalDate))
      .slice(0, 5);
      
    return { statusCounts, openQty, openValue, nextArrivals };
  }, [dashboardData]);

  const replenishmentRows = useMemo(() => {
    return dashboardData
      .map(sku => ({
        id: sku.id,
        name: sku.name,
        suggestQty: Number(sku.suggestQty || 0),
        stockoutDate: sku.finalStockOutDate || '安全',
      }))
      .filter(row => row.suggestQty > 0)
      .sort((a, b) => b.suggestQty - a.suggestQty);
  }, [dashboardData]);

  const [showAllReplenishment, setShowAllReplenishment] = useState(false);


  const monthlySummary = useMemo(() => {
    const inboundTotals = Array(12).fill(0);
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    dashboardData.forEach(sku => {
      const forecastRows = Array.isArray(sku.forecast?.data) ? sku.forecast.data : [];
      forecastRows.forEach(row => {
        if (!row.incomingQty) return;
        const rowDate = new Date(row.date);
        const monthOffset = (rowDate.getFullYear() - currentYear) * 12 + (rowDate.getMonth() - currentMonth);
        if (monthOffset >= 0 && monthOffset < 12) {
          inboundTotals[monthOffset] += Number(row.incomingQty) || 0;
        }
      });
    });

    const salesTotals = salesSummary.totals.map(v => Number(v) || 0);
    const startStocks = Array(12).fill(0);
    let rollingStock = stockSummary.onHandStock;
    for (let i = 0; i < 12; i++) {
      if (i > 0) {
        rollingStock += (inboundTotals[i - 1] || 0) - (salesTotals[i - 1] || 0);
      }
      startStocks[i] = rollingStock;
    }
    return { startStocks, inboundTotals, salesTotals };
  }, [dashboardData, salesSummary.totals, stockSummary.onHandStock]);

  const hasUnitCost = useMemo(() => dashboardData.some(sku => Number(sku.unitCost || 0) > 0), [dashboardData]);

  const visibleForecastRows = useMemo(() => {
    if (!activeForecast || !activeForecast.data) return [];
    const sliceLen = Math.min(horizonDays + 1, activeForecast.data.length);
    let rows = activeForecast.data.slice(0, sliceLen).map((row, idx) => ({ ...row, __idx: idx }));
    if (onlyInboundDays) {
      rows = rows.filter(r => r.incomingQty > 0);
    }
    return rows;
  }, [activeForecast, horizonDays, onlyInboundDays]);

  const firstStockoutIdx = useMemo(() => {
    if (!activeForecast || !activeForecast.data) return -1;
    return activeForecast.data.findIndex(r => r.stock <= 0);
  }, [activeForecast]);

  const nextInboundIdx = useMemo(() => {
    if (!activeForecast || !activeForecast.data) return -1;
    return activeForecast.data.findIndex(r => r.incomingQty > 0);
  }, [activeForecast]);

  const jumpToFirstStockout = () => {
    if (!activeForecast || !activeForecast.data) return;
    const idx = activeForecast.data.findIndex(d => d.stock <= 0);
    if (idx === -1) return;
    const el = document.getElementById(`forecast-row-${idx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const jumpToNextInbound = () => {
    if (!activeForecast || !activeForecast.data) return;
    const idx = activeForecast.data.findIndex(d => d.incomingQty > 0);
    if (idx === -1) return;
    const el = document.getElementById(`forecast-row-${idx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  // --- 7. UI 渲染 ---
  if (!hasFirebase) return (
    <div className="min-h-screen w-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-3xl shadow-2xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={28} className="text-amber-500" />
          <h1 className="text-2xl font-black text-slate-900">Firebase 配置缺失</h1>
        </div>
        <p className="text-sm text-slate-600 font-medium mb-4">
          当前环境缺少必要的 Firebase 配置，无法继续登录。请先补齐下列变量后重启开发服务器。
        </p>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <ul className="text-xs font-mono text-slate-700 space-y-1">
            {missingFirebaseEnv.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );

  if (status === 'loading') return (
    <div className="min-h-screen w-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 text-center">
        <div className="text-sm font-black text-slate-700 tracking-widest uppercase">正在初始化</div>
        <div className="mt-3 text-xs text-slate-500 font-medium">请稍候，正在确认登录状态</div>
      </div>
    </div>
  );

  if (status === 'error') return (
    <div className="min-h-screen w-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-3xl shadow-2xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={28} className="text-red-500" />
          <h1 className="text-2xl font-black text-slate-900">初始化失败</h1>
        </div>
        <p className="text-sm text-slate-600 font-medium">
          Firebase 初始化失败或认证服务不可用。请检查配置并重启开发服务器。
        </p>
      </div>
    </div>
  );

  // 未认证时显示登录页面
  if (status === 'unauthenticated') return (
    <div className="h-screen w-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        <div className="text-center mb-8">
          <div className="h-16 w-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Lock size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">智策中心</h1>
          <p className="text-slate-500 text-sm mt-2 font-medium">供应链全景指挥系统</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-widest">邮箱地址</label>
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="your@orynda.cn"
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 font-medium text-slate-900"
              disabled={isLoggingIn}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-widest">密码</label>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="你的密码"
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 font-medium text-slate-900"
              disabled={isLoggingIn}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin(e)}
            />
          </div>

          {loginError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">
              {loginError}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black hover:bg-indigo-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed uppercase tracking-widest text-sm"
          >
            {isLoggingIn ? '正在登录...' : '登录'}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-200">
          <p className="text-center text-[12px] text-slate-500 font-medium">
            🔐 仅授权用户可访问
          </p>
          <p className="text-center text-[10px] text-slate-400 mt-2">
            如需访问权限，请联系管理员
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col font-sans text-slate-800 text-sm overflow-y-auto">
      {warning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-100 border border-amber-300 text-amber-800 px-6 py-2 rounded-full text-xs font-bold shadow-xl flex items-center gap-2 animate-in slide-in-from-top-2">
          <AlertCircle size={14} className="text-amber-500" />
          <span>{warning}</span>
          <button onClick={() => setWarning('')} className="ml-2 text-amber-600 hover:text-amber-800">
            <X size={12} />
          </button>
        </div>
      )}
      <div className="flex-1 flex bg-slate-100">
      {viewMode === 'detail' ? (
        <>
          {/* 侧边栏 */}
          <div className="w-80 bg-white border-r border-slate-200 flex flex-col z-20 flex-shrink-0 h-screen sticky top-0 self-start">
            <div className="p-6 bg-indigo-950 text-white">
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-xl font-black flex items-center gap-2 tracking-tight"><BarChart3 size={24}/> 智策中心</h2>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-indigo-800 rounded-lg transition-colors" title="打开设置"><Settings size={18} className="text-slate-300 hover:text-white"/></button>
                  <button onClick={handleLogout} className="p-1.5 hover:bg-red-800 rounded-lg transition-colors" title="登出"><LogOut size={18} className="text-slate-300 hover:text-red-300"/></button>
                  <Save className="text-emerald-500 opacity-50" size={16}/>
                </div>
              </div>
              <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-widest italic leading-relaxed">{memoryModeText}</p>
              <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest mt-2">👤 {user?.email}</p>
            </div>
            
            {/* 图例说明 */}
            <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 space-y-1.5">
              <div className="text-[8px] font-black text-slate-600 uppercase tracking-widest">图例</div>
              
              {/* PO状态指示器 - 两列布局 */}
              <div className="space-y-0.5">
                <div className="text-[7px] font-bold text-slate-500 uppercase">图例：</div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                    <span className="text-[7px] text-slate-600">PO到货</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-1.5 rounded-sm bg-emerald-500" />
                    <span className="text-[7px] text-slate-600">有货</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-1.5 rounded-sm bg-slate-200" />
                    <span className="text-[7px] text-slate-600">断货</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {dashboardData.map(item => (
                <div 
                  key={item.id} 
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, item.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => renamingSkuId !== item.id && setSelectedSkuId(item.id)} 
                  className={`p-3 rounded-xl border-2 transition-all cursor-move group relative ${draggedSkuId === item.id ? 'opacity-50 bg-slate-100' : ''} ${selectedSkuId === item.id ? 'bg-indigo-50 border-indigo-400 shadow-md' : 'bg-white border-transparent hover:border-slate-200'}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    {renamingSkuId === item.id ? (
                      <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                        <input autoFocus value={tempName} onChange={e => setTempName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenaming()} className="w-full text-xs p-1 border rounded outline-none border-indigo-400 font-bold text-indigo-900" />
                        <button onClick={saveRenaming} className="p-1 text-emerald-600"><Check size={14}/></button>
                      </div>
                    ) : (
                      <>
                        <span className="font-black text-sm truncate w-32 text-slate-700 uppercase tracking-tighter">⋮⋮ {item.name}</span>
                        <div className="flex items-center gap-1">
                           <button onClick={(e) => { e.stopPropagation(); startRenaming(item); }} className="p-1 text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity" title="编辑名称"><Edit2 size={12}/></button>
                           <button onClick={(e) => { e.stopPropagation(); duplicateSku(item.id); }} className="p-1 text-slate-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" title="复制SKU"><Trash2 size={12} className="rotate-180"/></button>
                           <button onClick={(e) => { e.stopPropagation(); deleteSku(item.id); }} className="p-1 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" title="删除SKU"><Trash2 size={12}/></button>
                           <span className={`h-2.5 w-2.5 rounded-full ${item.riskLevel === 'safe' ? 'bg-emerald-500' : item.riskLevel === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-widest mb-1">
                    <span className="text-slate-500">库存: {item.currentStock?.toLocaleString()}</span>
                  </div>
                  <div className={`px-2 py-1.5 rounded-lg text-[10px] font-black flex items-center gap-1 text-center ${item.riskLevel === 'safe' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : item.riskLevel === 'warning' ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' : 'bg-red-100 text-red-700 border border-red-300'}`}>
                    <span className="flex-1">{item.riskText}</span>
                  </div>
                  
                  {/* 全年有货月份栏 */}
                  <div className="mt-2 space-y-1">
                    <div className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">12个月货态</div>
                    
                    {/* PO到货月份指示器 - 只显示黄色点 */}
                    <div className="flex gap-0.5 h-3">
                      {item.monthlyPOs?.map((pos, idx) => {
                        if (pos.length === 0) {
                          return <div key={idx} className="flex-1" />;
                        }
                        
                        // 如果这个月有PO，显示黄色点
                        const poQty = pos.reduce((sum, po) => sum + (po.qty || 0), 0);
                        const poInfo = pos.map(po => po.qty).join('+');
                        
                        return (
                          <div
                            key={idx}
                            className="flex-1 rounded-full bg-yellow-400 relative group"
                            title={`${poInfo}件到货`}
                          />
                        );
                      })}
                    </div>
                    
                    {/* 货态条 */}
                    <div className="flex gap-0.5">
                      {item.monthlyAvailability?.map((hasStock, idx) => {
                        // 根据当前日期计算实际月份
                        const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
                        const today = new Date();
                        const targetMonth = (today.getMonth() + idx) % 12;
                        const monthLabel = months[targetMonth];
                        return (
                          <div
                            key={idx}
                            className={`flex-1 h-2 rounded-sm transition-all ${hasStock ? 'bg-emerald-500' : 'bg-slate-200'}`}
                            title={`${monthLabel}: ${hasStock ? '有货' : '缺货'}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t bg-slate-50 text-center flex-shrink-0 space-y-3">
              <button onClick={addSku} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase">
                <Plus size={18}/> 新建 SKU
              </button>
              <button onClick={() => setViewMode('dashboard')} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase">
                <Layout size={18}/> 开启战略全景大屏
              </button>
            </div>
          </div>

          {/* 主工作区 */}
          <div className="flex-1 flex flex-col min-w-0">
            <header className="bg-white border-b px-6 py-5 shadow-sm flex-shrink-0">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase italic">{activeSku?.name || '请选择商品'}</h1>
                  <p className="text-[10px] text-slate-400 mt-1 font-bold">系统已自动记住您的每一项修改</p>
                </div>
                <div className={`px-6 py-3 rounded-xl border-2 flex items-center gap-4 shadow-sm ${activeForecast.data.some(d => d.stock <= 0) ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                  {activeForecast.data.some(d => d.stock <= 0) ? <AlertTriangle className="text-red-500" size={28}/> : <Check className="text-emerald-500" size={28}/>}
                  <div>
                    <div className="font-black text-xs uppercase tracking-wider">供应链安全等级</div>
                    <div className="text-[10px] font-bold opacity-80">
                      {activeForecast.data.some(d => d.stock <= 0)
                        ? `断货窗口: ${activeForecast.data.find(d => d.stock <= 0).date}`
                        : '未来 365 天安全'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between shadow-sm">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">当前商品覆盖能力</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-2xl font-black text-slate-900">
                        {coverageSummary ? coverageSummary.months : '--'}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">月</span>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500 font-medium">
                      {coverageSummary && !coverageSummary.safe
                        ? `预计在 ${coverageSummary.stockoutDate} 见底`
                        : '未来 12 个月内无断货风险'}
                    </div>
                  </div>
                  <div className="h-10 w-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-black text-xs">
                    D
                  </div>
                </div>
              </div>
            </header>
            
            <main className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
               <div className="grid grid-cols-12 gap-6">
                  <div className="col-span-4 space-y-8">
                     {/* 参数配置 */}
                     <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <h3 className="text-lg font-bold mb-8 flex items-center gap-3 text-slate-800 tracking-tighter uppercase"><TrendingDown className="text-indigo-600"/> 核心水位调配</h3>
                        <div className="space-y-6">
                           <div>
                             <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 px-1">当前实物库存（件）</label>
                             <input
                               type="number"
                               value={activeSku?.currentStock || 0}
                               onChange={e => updateSku(activeSku.id, 'currentStock', clampNonNegativeInt(e.target.value, '当前库存'))}
                               className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl p-6 font-mono text-3xl font-black focus:border-indigo-500 outline-none transition-all shadow-inner"
                             />
                           </div>
                             <div>
                               <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 px-1">单位成本</label>
                               <input
                                 type="number"
                                 step="0.01"
                                 value={activeSku?.unitCost ?? 0}
                                 onChange={e => updateSku(activeSku.id, 'unitCost', clampNonNegativeNumber(e.target.value, '单位成本'))}
                                 className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-mono text-xl font-black focus:border-indigo-500 outline-none transition-all shadow-inner"
                               />
                             </div>
                           <button onClick={() => setShowSeasonality(!showSeasonality)} className="text-xs font-black text-indigo-600 hover:underline flex items-center gap-2">{showSeasonality ? '▲ 隐藏季节性配置' : '▼ 点击展开月度销量配置'}</button>
                           {showSeasonality && <button onClick={() => setShowQuickFill(true)} className="text-xs font-black text-emerald-600 hover:text-emerald-700">⚡ 快速填充</button>}
                           {showSeasonality && activeSku && (
                             <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 animate-in slide-in-from-top-2">
                               {(activeSku.monthlySales || Array(12).fill(0)).map((v, i) => (
                                 <div key={i}>
                                   <label className="text-[10px] text-slate-400 font-bold block mb-2">{i+1}月</label>
                                   <input
                                     type="number"
                                     value={v}
                                     onChange={e => {
                                       const n = [...(activeSku.monthlySales || Array(12).fill(0))];
                                       n[i] = clampNonNegativeInt(e.target.value, '月度销量');
                                       updateSku(activeSku.id, 'monthlySales', n);
                                     }}
                                     className="w-full text-sm p-2.5 border rounded-lg font-bold"
                                   />
                                 </div>
                               ))}
                             </div>
                           )}
                        </div>
                     </div>

                     {/* 详细采购单 */}
                     <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <div className="mb-8 border-b pb-4 border-slate-50">
                          <div className="flex justify-between items-center mb-3">
                            <h3 className="text-lg font-bold flex items-center gap-3 text-slate-700 tracking-tighter uppercase"><Clock className="text-indigo-600"/> 详细采购 PO</h3>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-1 bg-slate-50">
                                <button 
                                  onClick={() => setPoFilter('all')} 
                                  className={`text-[11px] px-3 py-1.5 rounded-md font-bold uppercase tracking-tighter transition-colors ${poFilter === 'all' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-transparent text-slate-600 hover:text-slate-900'}`} 
                                  title="显示所有采购单"
                                >
                                  全部
                                </button>
                                <button 
                                  onClick={() => setPoFilter('pending')} 
                                  className={`text-[11px] px-3 py-1.5 rounded-md font-bold uppercase tracking-tighter transition-colors ${poFilter === 'pending' ? 'bg-yellow-500 text-white shadow-sm' : 'bg-transparent text-slate-600 hover:text-slate-900'}`} 
                                  title="显示待完成采购单"
                                >
                                  待完成
                                </button>
                                <button 
                                  onClick={() => setPoFilter('completed')} 
                                  className={`text-[11px] px-3 py-1.5 rounded-md font-bold uppercase tracking-tighter transition-colors ${poFilter === 'completed' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-transparent text-slate-600 hover:text-slate-900'}`} 
                                  title="显示已完成采购单"
                                >
                                  已完成
                                </button>
                              </div>
                              <button onClick={exportPOsToJSON} className="text-[11px] px-2 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 font-bold uppercase tracking-tighter" title="导出数据">导出数据</button>
                              <button onClick={exportPOsToCSV} className="text-[11px] px-2 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 font-bold uppercase tracking-tighter" title="导出表格">导出表格</button>
                              <button onClick={importPOsFromJSON} className="text-[11px] px-2 py-1 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200 font-bold uppercase tracking-tighter" title="导入 JSON">导入</button>
                              <button onClick={() => addPO(activeSku.id)} className="bg-indigo-600 text-white p-2 rounded-xl hover:bg-indigo-700 active:scale-90 transition-all shadow-md"><Plus size={18}/></button>
                            </div>
                          </div>
                          {activeSku?.pos && activeSku.pos.length > 0 && (
                            <div className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                              共 {activeSku.pos.length} 条采购单 · 支持复制上一条快速录入
                            </div>
                          )}
                        </div>
                        <div className="space-y-0 overflow-y-auto pr-2" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                           {(!activeSku?.pos || activeSku.pos.length === 0) && <div className="text-center py-10 text-slate-300 font-bold italic border-2 border-dashed border-slate-100 rounded-3xl text-sm">暂无在途订单数据</div>}
                           
                           {/* 待完成分组 */}
                           {activeSku?.pos?.some(po => po.status !== 'shelved' && po.status !== 'pre_order' && po.status !== 'cancelled') && (poFilter === 'all' || poFilter === 'pending') && (
                             <div className="mb-4">
                               <button
                                 onClick={() => setExpandedPoGroups(prev => ({ ...prev, pending: !prev.pending }))}
                                 className="w-full flex items-center gap-2 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100 transition-colors font-bold text-sm uppercase tracking-tighter text-yellow-800 mb-2"
                               >
                                 <span className={`transition-transform ${expandedPoGroups.pending ? 'rotate-90' : ''}`}>▶</span>
                                 📋 待完成采购单 ({activeSku.pos.filter(p => p.status !== 'shelved' && p.status !== 'pre_order' && p.status !== 'cancelled').length})
                               </button>
                               {expandedPoGroups.pending && (
                                 <div className="space-y-2">
                                   {activeSku?.pos?.filter(po => po.status !== 'shelved' && po.status !== 'pre_order' && po.status !== 'cancelled').map(po => {
                                     const prodEndDate = new Date(new Date(po.orderDate).getTime() + Number(po.prodDays) * 86400000);
                                     const arrivalDate = new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays) + Number(po.leg1Days) + Number(po.leg2Days) + Number(po.leg3Days)) * 86400000).toLocaleDateString();
                                     const daysUntilProdEnd = (prodEndDate - new Date()) / 86400000;
                                     const isProductionWarning = po.status === 'in_production' && daysUntilProdEnd > 0 && daysUntilProdEnd <= 45;
                                     const isExpanded = expandedPoId === po.id;
                                     
                                     return (
                                     <div key={po.id} className={`rounded-xl relative group border transition-all ${isProductionWarning ? 'bg-red-50 border-red-300 shadow-md shadow-red-200' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'} p-3`}>
                                        {isProductionWarning && (
                                          <div className="mb-2 bg-red-100 border border-red-300 rounded-lg px-3 py-1.5 flex items-center gap-2">
                                            <AlertTriangle size={12} className="text-red-600 flex-shrink-0" />
                                            <span className="text-[10px] font-black text-red-700">⚠️ 交期预警：{Math.ceil(daysUntilProdEnd)} 天</span>
                                          </div>
                                        )}
                                        <button 
                                          onClick={() => setExpandedPoId(isExpanded ? null : po.id)}
                                          className="w-full flex items-center justify-between hover:opacity-70 transition-opacity"
                                        >
                                          <span className="flex items-center gap-2 flex-1 text-left">
                                            <span className={`transition-transform text-[10px] ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                            <span className="text-[10px] font-black text-slate-500 uppercase">采购单号 {po.poNumber}</span>
                                          </span>
                                          <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 rounded px-2 py-0.5">{po.qty} 件</span>
                                        </button>
                                        {!isExpanded && (
                                          <div className="flex items-center justify-between gap-2 text-[10px] font-bold mt-2 px-1">
                                            <span className="text-slate-600">下单 {po.orderDate}</span>
                                            <span className="text-slate-600">到货 {arrivalDate}</span>
                                            <span className="text-[9px] bg-slate-100 rounded px-1.5 py-0.5">{['预下订单', '已下单', '取消订单', '生产中', '生产完成', '头程发货', '头程到货', '二程发货', '二程到货', '查验中', '提货中', '到达保税仓', '待理货上架', '已理货上架'].find((_, i) => ['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'][i] === po.status) || po.status}</span>
                                            <button 
                                              onClick={(e) => { e.stopPropagation(); removePO(activeSku.id, po.id); }}
                                              className="p-0.5 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                              title="删除"
                                            >
                                              <Trash2 size={12}/>
                                            </button>
                                          </div>
                                        )}
                                        {isExpanded && (
                                          <>
                                          <input 
                                            type="text" 
                                            value={po.poNumber} 
                                            onChange={e => updatePO(activeSku.id, po.id, 'poNumber', e.target.value)} 
                                            className="text-sm font-black text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2.5 w-full outline-none border border-indigo-200 focus:border-indigo-400 transition-colors mb-3 mt-2" 
                                          />
                                          <div className="grid grid-cols-2 gap-3 mb-3 font-bold uppercase text-xs">
                                            <div>
                                              <label className="text-[9px] font-black text-slate-400 block mb-1">下单日期</label>
                                              <input type="date" value={po.orderDate} onChange={e => updatePO(activeSku.id, po.id, 'orderDate', e.target.value)} className="text-sm text-slate-600 bg-transparent outline-none w-full" />
                                            </div>
                                            <div>
                                              <label className="text-[9px] font-black text-slate-400 block mb-1">采购状态</label>
                                              <select 
                                                value={po.status || 'ordered'} 
                                                onChange={e => updatePO(activeSku.id, po.id, 'status', e.target.value)}
                                                className="text-xs font-black bg-slate-100 rounded px-2 py-1 border border-slate-300 focus:outline-none focus:border-indigo-500 w-full"
                                              >
                                                <option value="pre_order">预下订单</option>
                                                <option value="ordered">已下单</option>
                                                <option value="cancelled">取消订单</option>
                                                <option value="in_production">生产中</option>
                                                <option value="prod_complete">生产完成</option>
                                                <option value="leg1_shipped">头程发货</option>
                                                <option value="leg1_arrived">头程到货</option>
                                                <option value="leg2_shipped">二程发货</option>
                                                <option value="leg2_arrived">二程到货</option>
                                                <option value="inspecting">查验中</option>
                                                <option value="picking">提货中</option>
                                                <option value="bonded_warehouse">到达保税仓</option>
                                                <option value="pending_shelving">待理货上架</option>
                                                <option value="shelved">已理货上架</option>
                                              </select>
                                            </div>
                                          </div>
                                          <div className="grid grid-cols-2 gap-3 mb-3 font-bold text-xs">
                                            <div><label className="text-[9px] font-black text-slate-400 block mb-1"></label></div>
                                            <div className="text-right">
                                              <label className="text-[9px] font-black text-slate-400 block mb-1">采购数量</label>
                                              <input
                                                type="number"
                                                value={po.qty}
                                                onChange={e => updatePO(activeSku.id, po.id, 'qty', clampNonNegativeInt(e.target.value, '采购数量'))}
                                                className="text-indigo-600 font-black bg-transparent w-full text-right outline-none font-mono text-xs"
                                              />
                                            </div>
                                          </div>
                                          <div className="space-y-1 bg-white/50 p-2 rounded-lg border border-slate-100 text-[10px] font-bold mb-3">
                                             <div className="flex justify-between items-center text-slate-500 text-[9px]">
                                                <span><Factory size={9} className="inline mr-1"/>生产周期</span>
                                                <div className="flex items-center gap-1">
                                                  <input
                                                    type="number"
                                                    value={po.prodDays}
                                                    onChange={e => updatePO(activeSku.id, po.id, 'prodDays', clampNonNegativeInt(e.target.value, '生产周期'))}
                                                    className="w-12 text-right bg-transparent border-b border-slate-200 text-xs"
                                                  />天
                                                </div>
                                             </div>
                                             <div className="flex justify-between items-center text-blue-600 text-[9px]">
                                                <span className="flex items-center gap-1">
                                                  <select value={po.leg1Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg1Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer text-[9px]">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>头程
                                                </span>
                                                <div className="flex items-center gap-1">
                                                  <input
                                                    type="number"
                                                    value={po.leg1Days}
                                                    onChange={e => updatePO(activeSku.id, po.id, 'leg1Days', clampNonNegativeInt(e.target.value, '头程时效'))}
                                                    className="w-12 text-right bg-transparent border-b border-blue-100 text-xs"
                                                  />天
                                                </div>
                                             </div>
                                             <div className="flex justify-between items-center text-orange-600 text-[9px]">
                                                <span className="flex items-center gap-1">
                                                  <select value={po.leg2Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg2Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer text-[9px]">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>二程
                                                </span>
                                                <div className="flex items-center gap-1">
                                                  <input
                                                    type="number"
                                                    value={po.leg2Days}
                                                    onChange={e => updatePO(activeSku.id, po.id, 'leg2Days', clampNonNegativeInt(e.target.value, '二程时效'))}
                                                    className="w-12 text-right bg-transparent border-b border-orange-100 text-xs"
                                                  />天
                                                </div>
                                             </div>
                                             <div className="flex justify-between items-center text-emerald-600 text-[9px]">
                                                <span className="flex items-center gap-1">
                                                  <select value={po.leg3Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg3Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer text-[9px]">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>三程
                                                </span>
                                                <div className="flex items-center gap-1">
                                                  <input
                                                    type="number"
                                                    value={po.leg3Days}
                                                    onChange={e => updatePO(activeSku.id, po.id, 'leg3Days', clampNonNegativeInt(e.target.value, '三程时效'))}
                                                    className="w-12 text-right bg-transparent border-b border-emerald-100 text-xs"
                                                  />天
                                                </div>
                                             </div>
                                          </div>
                                          <div className="mt-2 flex items-center justify-between text-[9px]">
                                            <div className="font-black text-indigo-500 italic">
                                              预计到货: {new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays)+Number(po.leg1Days)+Number(po.leg2Days)+Number(po.leg3Days)) * 86400000).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <button 
                                                onClick={() => duplicatePO(activeSku.id, po.id)} 
                                                className="p-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors" 
                                                title="复制"
                                              >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                              </button>
                                              <button 
                                                onClick={() => removePO(activeSku.id, po.id)} 
                                                className="p-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors" 
                                                title="删除"
                                              >
                                                <Trash2 size={12}/>
                                              </button>
                                            </div>
                                          </div>
                                          </>
                                        )}
                                     </div>
                                     );
                                   })}
                                 </div>
                               )}
                             </div>
                           )}
                           
                           {/* 已完成分组 */}
                           {activeSku?.pos?.some(po => po.status === 'shelved') && (poFilter === 'all' || poFilter === 'completed') && (
                             <div className="mb-4">
                               <button
                                 onClick={() => setExpandedPoGroups(prev => ({ ...prev, completed: !prev.completed }))}
                                 className="w-full flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors font-bold text-sm uppercase tracking-tighter text-emerald-800 mb-2"
                               >
                                 <span className={`transition-transform ${expandedPoGroups.completed ? 'rotate-90' : ''}`}>▶</span>
                                 ✓ 已完成采购单 ({activeSku.pos.filter(p => p.status === 'shelved').length})
                               </button>
                               {expandedPoGroups.completed && (
                                 <div className="space-y-2">
                                   {activeSku?.pos?.filter(po => po.status === 'shelved').map(po => {
                                     const arrivalDate = new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays) + Number(po.leg1Days) + Number(po.leg2Days) + Number(po.leg3Days)) * 86400000).toLocaleDateString();
                                     const isExpanded = expandedPoId === po.id;
                                     
                                     return (
                                     <div key={po.id} className="rounded-xl relative group border border-emerald-200 bg-emerald-50/50 hover:border-emerald-300 transition-all p-3">
                                        <button 
                                          onClick={() => setExpandedPoId(isExpanded ? null : po.id)}
                                          className="w-full flex items-center justify-between hover:opacity-70 transition-opacity"
                                        >
                                          <span className="flex items-center gap-2 flex-1 text-left">
                                            <span className={`transition-transform text-[10px] ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                            <span className="text-[10px] font-black text-slate-500 uppercase">采购单号 {po.poNumber}</span>
                                          </span>
                                          <span className="text-[11px] font-bold text-emerald-600 bg-emerald-100 rounded px-2 py-0.5">{po.qty} 件</span>
                                        </button>
                                        {!isExpanded && (
                                          <div className="flex items-center justify-between gap-2 text-[10px] font-bold mt-2 px-1 text-emerald-700">
                                            <span className="text-slate-600">下单 {po.orderDate}</span>
                                            <span className="text-slate-600">到货 {arrivalDate}</span>
                                            <span className="text-[9px] bg-emerald-100 rounded px-1.5 py-0.5">已理货上架</span>
                                          </div>
                                        )}
                                        {isExpanded && (
                                          <div className="mt-2 text-[9px] text-slate-600 italic">
                                            预计到货: {new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays)+Number(po.leg1Days)+Number(po.leg2Days)+Number(po.leg3Days)) * 86400000).toLocaleDateString()}
                                          </div>
                                        )}
                                     </div>
                                     );
                                   })}
                                 </div>
                               )}
                             </div>
                           )}
                        </div>
                     </div>
                  </div>

                  {/* 推演线性表 */}
                  <div className="col-span-8 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-0">
                     <div className="px-6 py-4 border-b bg-slate-50/50">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-black text-slate-700 uppercase tracking-widest text-sm">
                            库存推演
                          </span>
                          <div className="flex gap-2 items-center">
                            <button
                              onClick={() => setHorizonDays(180)}
                              className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold transition-colors ${horizonDays === 180 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                            >
                              180 天
                            </button>
                            <button
                              onClick={() => setHorizonDays(365)}
                              className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold transition-colors ${horizonDays === 365 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                            >
                              365 天
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <span className="text-[10px] text-slate-500 font-medium">
                            {onlyInboundDays ? '仅展示有到货的日期' : '显示所有日期'} · 共 {visibleForecastRows.length} 条记录
                          </span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-medium text-slate-600">
                              <input
                                type="checkbox"
                                checked={onlyInboundDays}
                                onChange={e => setOnlyInboundDays(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500"
                              />
                              <span>仅看有到货</span>
                            </label>
                            <button
                              onClick={jumpToFirstStockout}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors text-[10px] font-bold"
                            >
                              <AlertTriangle size={12}/> 跳到首次断货
                            </button>
                            <button
                              onClick={jumpToNextInbound}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors text-[10px] font-bold"
                            >
                              <ArrowRight size={12}/> 跳到最近到货
                            </button>
                            <div className="flex gap-3 items-center text-[10px] font-medium text-slate-500">
                              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500"/>断货</span>
                              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400"/>低库存</span>
                            </div>
                          </div>
                        </div>
                     </div>
                     <div className="flex-1 overflow-auto px-4 min-h-0">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-white sticky top-0 z-10 text-[10px] uppercase font-bold text-slate-400 border-b">
                            <tr><th className="p-4 pl-6 text-left">推演日期</th><th className="p-4 text-center">预估剩余库存（件）</th><th className="p-4 text-right pr-6">实时判定</th></tr>
                           </thead>
                           <tbody className="divide-y divide-slate-50 font-medium text-sm">
                              {visibleForecastRows.map((row) => (
                                <tr
                                  key={row.__idx}
                                  id={`forecast-row-${row.__idx}`}
                                  className={`hover:bg-indigo-50/30 transition-colors ${row.stock <= 0 ? 'bg-red-50/50' : (row.status === 'low' ? 'bg-amber-50/20' : '')} ${row.incomingQty > 0 ? 'bg-emerald-50/30' : ''} ${(firstStockoutIdx >= 0 && row.__idx >= firstStockoutIdx - 30 && row.__idx <= firstStockoutIdx) ? 'border-l-4 border-amber-300' : ''}`}
                                >
                                  <td className="p-3 pl-6 text-xs font-mono font-bold text-slate-500">{row.date}</td>
                                  <td className="p-3 text-center">
                                    <div className={`font-mono font-black ${row.stock <= 0 ? 'text-red-600' : (row.status === 'low' ? 'text-amber-700' : 'text-slate-900')}`}>
                                      {row.stock.toFixed(0)}
                                    </div>
                                    {row.incomingQty > 0 && (
                                      <div className="mt-1 text-[10px] font-bold text-emerald-600">
                                        +{row.incomingQty.toFixed(0)} 到货
                                      </div>
                                    )}
                                  </td>
                                  <td className="p-3 text-right pr-6">
                                     {row.stock <= 0 ? <span className="text-[10px] bg-red-600 text-white px-3 py-1 rounded-full font-black uppercase shadow-lg tracking-widest">断货</span> : 
                                      (row.status === 'low' ? <span className="text-[10px] bg-amber-400 text-white px-3 py-1 rounded-full font-black uppercase shadow-md tracking-widest">尽快下单</span> : <span className="text-[10px] text-emerald-500 font-black border border-emerald-200 px-3 py-1 rounded-full bg-emerald-50 uppercase tracking-widest leading-none">安全</span>)}
                                  </td>
                                </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            </main>
          </div>
        </>
      ) : (
        /* --- 战略全景大屏 --- */
        <div className={`flex-1 flex flex-col p-6 transition-colors ${dashboardTheme === 'dark' ? 'bg-slate-950 text-white' : 'bg-gray-50 text-slate-900'}`}>
          <div className="flex justify-between items-start mb-6 flex-shrink-0">
            <div className="flex items-start gap-8">
              <div className="flex items-center gap-6">
                <div className={`h-20 w-20 rounded-[2rem] flex items-center justify-center shadow-2xl transform rotate-3 ${dashboardTheme === 'dark' ? 'bg-indigo-600 shadow-indigo-500/50' : 'bg-indigo-500 shadow-indigo-300/50'}`}>
                  <BarChart3 size={40}/>
                </div>
                <div>
                  <h1 className="text-5xl font-black italic tracking-tighter uppercase">战略指挥中心</h1>
                  <p className={`font-bold uppercase tracking-[0.4em] text-[11px] mt-1 italic ${dashboardTheme === 'dark' ? 'text-indigo-500' : 'text-indigo-600'}`}>
                    推演引擎：T-{warningDays}天安全协议已启用
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-[11px]">
                <div className={`rounded-2xl px-5 py-3 shadow-xl border-2 ${dashboardTheme === 'dark' ? 'bg-slate-900/70 border-rose-500/60' : 'bg-red-50 border-red-200'}`}>
                  <div className={`text-[9px] font-black uppercase tracking-[0.2em] mb-1 ${dashboardTheme === 'dark' ? 'text-rose-300' : 'text-red-700'}`}>
                    未来一年内将断货商品
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-black ${dashboardTheme === 'dark' ? 'text-rose-400' : 'text-red-600'}`}>
                      {fleetKpi.stockoutWithinHorizon}
                    </span>
                    <span className={`text-[10px] font-bold ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>条 / {skus.length} 条在管</span>
                  </div>
                </div>
                <div className={`rounded-2xl px-5 py-3 shadow-xl border-2 ${dashboardTheme === 'dark' ? 'bg-slate-900/70 border-amber-400/60' : 'bg-amber-50 border-amber-200'}`}>
                  <div className={`text-[9px] font-black uppercase tracking-[0.2em] mb-1 ${dashboardTheme === 'dark' ? 'text-amber-200' : 'text-amber-700'}`}>
                    未来 {fleetKpi.orderWindowDays} 天需决策下单商品
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-black ${dashboardTheme === 'dark' ? 'text-amber-300' : 'text-amber-600'}`}>
                      {fleetKpi.needOrderSoon}
                    </span>
                    <span className={`text-[10px] font-bold ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>条 · 含红色紧急窗口</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDashboardTheme(dashboardTheme === 'dark' ? 'light' : 'dark')}
                className={`px-4 py-3 rounded-[1.5rem] font-black transition-all active:scale-95 flex items-center gap-2 text-xs uppercase tracking-widest shadow-lg border-2 ${dashboardTheme === 'dark' ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-white' : 'bg-white border-gray-300 hover:bg-gray-100 text-slate-900'}`}
                title={dashboardTheme === 'dark' ? '切换至白天模式' : '切换至黑夜模式'}
              >
                {dashboardTheme === 'dark' ? '☀️ 白天' : '🌙 黑夜'}
              </button>
              <button
                onClick={() => setViewMode('detail')}
                className={`px-10 py-4 rounded-[1.5rem] font-black transition-all active:scale-95 flex items-center gap-4 text-xs uppercase tracking-widest shadow-2xl border-2 ${dashboardTheme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-white' : 'bg-white border-gray-300 hover:bg-gray-100 text-slate-900'}`}
              >
                <List size={20}/> 返回指挥中心视角
              </button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-6 mb-8">
            {/* 核心库存指标 - 占据左侧 */}
            <div className={`col-span-8 rounded-[2rem] border p-6 shadow-sm ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`}>
              <div className="flex items-center justify-between mb-6">
                <h3 className={`text-base font-bold flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                  <div className={`w-2 h-6 rounded-full ${dashboardTheme === 'dark' ? 'bg-indigo-500' : 'bg-indigo-600'}`}></div>
                  库存与销售动态
                </h3>
                <div className={`text-xs font-medium px-3 py-1 rounded-full ${dashboardTheme === 'dark' ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                  商品总数: {skus.length}
                </div>
              </div>
              
              {/* 三大核心指标 */}
              <div className="grid grid-cols-3 gap-6 mb-8">
                <div className={`relative overflow-hidden rounded-2xl p-5 border transition-all hover:scale-[1.02] cursor-default ${dashboardTheme === 'dark' ? 'bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700' : 'bg-gradient-to-br from-indigo-50/50 to-white border-indigo-100'}`}>
                  <div className={`text-xs font-medium mb-2 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>在仓库存 (On Hand)</div>
                  <div className={`text-3xl font-bold tracking-tight ${dashboardTheme === 'dark' ? 'text-emerald-400' : 'text-slate-800'}`}>
                    {Math.round(stockSummary.onHandStock).toLocaleString()}
                  </div>
                  <div className={`absolute bottom-0 right-0 p-4 opacity-10 transform translate-x-1/4 translate-y-1/4`}>
                    <Factory size={80} />
                  </div>
                </div>
                
                <div className={`relative overflow-hidden rounded-2xl p-5 border transition-all hover:scale-[1.02] cursor-default ${dashboardTheme === 'dark' ? 'bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700' : 'bg-gradient-to-br from-blue-50/50 to-white border-blue-100'}`}>
                  <div className={`text-xs font-medium mb-2 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>在途库存 (In Transit)</div>
                  <div className={`text-3xl font-bold tracking-tight ${dashboardTheme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>
                    {Math.round(poSummary.openQty).toLocaleString()}
                  </div>
                  <div className={`absolute bottom-0 right-0 p-4 opacity-10 transform translate-x-1/4 translate-y-1/4`}>
                    <Ship size={80} />
                  </div>
                </div>

                <div className={`relative overflow-hidden rounded-2xl p-5 border transition-all hover:scale-[1.02] cursor-default ${dashboardTheme === 'dark' ? 'bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700' : 'bg-gradient-to-br from-amber-50/50 to-white border-amber-100'}`}>
                  <div className={`text-xs font-medium mb-2 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>预计资金占用</div>
                  <div className={`text-3xl font-bold tracking-tight ${dashboardTheme === 'dark' ? 'text-amber-300' : 'text-amber-600'}`}>
                    {hasUnitCost ? `¥${Math.round(poSummary.openValue/10000).toLocaleString()}w` : '未设置成本'}
                  </div>
                  <div className={`text-[10px] mt-1 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>基于在途数量 * 成本</div>
                </div>
              </div>

              {/* 12个月趋势条 - 重新设计 */}
              <div>
                <div className={`text-xs font-bold mb-4 flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                  <Calendar size={14} /> 未来12个月供需推演 (Supply & Demand)
                </div>
                <div className="grid grid-cols-12 gap-2">
                  {monthlySummary.salesTotals.map((sales, idx) => {
                    const monthDate = new Date();
                    monthDate.setDate(1);
                    monthDate.setMonth(monthDate.getMonth() + idx);
                    const monthLabel = `${monthDate.getFullYear()}/${monthDate.getMonth() + 1}`;
                    const monthStartStock = monthlySummary.startStocks[idx] || 0;
                    const inboundQty = monthlySummary.inboundTotals[idx] || 0;
                    const netChange = inboundQty - sales;
                    const endStock = monthStartStock + netChange;
                    const isNetPositive = netChange >= 0;

                    return (
                      <div key={idx} className={`rounded-xl border flex flex-col p-3 h-32 transition-all group ${dashboardTheme === 'dark' ? 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600' : 'bg-slate-50 border-slate-100 hover:bg-white hover:shadow-lg hover:border-indigo-100'}`}>
                        {/* 顶部月份 */}
                        <div className={`text-[10px] font-black uppercase tracking-wider mb-2 flex justify-between items-center ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                          <span>{monthLabel}</span>
                        </div>
                        
                        {/* 核心数据区 - 纯数字大字体 */}
                        <div className="flex-1 flex flex-col justify-between">
                           {/* 销量 */}
                           <div className="flex justify-between items-baseline">
                              <span className={`text-[10px] font-bold ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>销</span>
                              <span className={`text-sm font-black font-mono ${dashboardTheme === 'dark' ? 'text-rose-300' : 'text-rose-500'}`}>{Math.round(sales)}</span>
                           </div>
                           
                           {/* 到货 */}
                           <div className="flex justify-between items-baseline">
                              <span className={`text-[10px] font-bold ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>到</span>
                              <span className={`text-sm font-black font-mono ${inboundQty > 0 ? (dashboardTheme === 'dark' ? 'text-emerald-300' : 'text-emerald-600') : 'text-slate-300/30'}`}>{Math.round(inboundQty)}</span>
                           </div>

                           {/* 剩余库存 - 突出显示 */}
                           <div className={`flex justify-between items-center pt-2 mt-1 border-t border-dashed ${dashboardTheme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                              <span className={`text-[10px] font-bold ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>余</span>
                              <span className={`text-lg font-black font-mono tracking-tight ${dashboardTheme === 'dark' ? 'text-indigo-200' : 'text-indigo-700'}`}>
                                 {Math.round(endStock).toLocaleString()}
                              </span>
                           </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 采购状态概览 - 占据右侧 */}
            <div className={`col-span-4 rounded-[2rem] border p-6 shadow-sm flex flex-col ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`}>
              <div className="flex items-center justify-between mb-6">
                <h3 className={`text-base font-bold flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                  <div className={`w-2 h-6 rounded-full ${dashboardTheme === 'dark' ? 'bg-emerald-500' : 'bg-emerald-600'}`}></div>
                  采购单进度看板
                </h3>
              </div>

              {/* 状态甜甜圈/列表替代品 */}
              <div className="space-y-3 flex-1">
                {[
                  { label: '已下单 (Ordered)', count: poSummary.statusCounts.ordered, color: 'slate' },
                  { label: '生产中 (In Production)', count: poSummary.statusCounts.production, color: 'amber' },
                  { label: '一线运输中 (Shipping)', count: poSummary.statusCounts.shipping, color: 'blue' },
                  { label: '尾程接收中 (Last Mile)', count: poSummary.statusCounts.inspection, color: 'violet' },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${dashboardTheme === 'dark' ? 'bg-slate-800/30 border-slate-700/50' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full bg-${item.color}-500 shadow-[0_0_8px_rgba(0,0,0,0.3)] shadow-${item.color}-500/50`}></div>
                      <span className={`text-xs font-medium ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{item.label}</span>
                    </div>
                    <span className={`text-lg font-bold font-mono ${dashboardTheme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{item.count}</span>
                  </div>
                ))}
              </div>

              {/* 最近到货小部件 */}
              <div className={`mt-6 pt-6 border-t ${dashboardTheme === 'dark' ? 'border-slate-800' : 'border-slate-100'}`}>
                <div className={`text-xs font-bold mb-3 uppercase tracking-wider ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>未来一个月内到货预告</div>
                <div className="space-y-2">
                  {poSummary.nextArrivals.length === 0 ? (
                    <div className={`text-xs italic ${dashboardTheme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>未来一个月暂无到货</div>
                  ) : (
                    poSummary.nextArrivals.map((po, idx) => (
                      <div key={idx} className={`flex items-center justify-between text-xs ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                        <span className="truncate max-w-[120px] font-medium">{po.skuName}</span>
                        <div className="flex items-center gap-3">
                          <span className={`${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>{new Date(po.arrivalDate).getMonth()+1}/{new Date(po.arrivalDate).getDate()}</span>
                          <span className="font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">+{po.qty}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 采购单总览表 - 重构版 */}
          <div className="grid grid-cols-12 gap-6 mb-8">
          <div className={`col-span-8 rounded-[2rem] border p-0 shadow-sm overflow-hidden flex flex-col ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`} style={{ maxHeight: '600px' }}>
            <div className={`px-6 py-5 border-b flex justify-between items-center ${dashboardTheme === 'dark' ? 'border-slate-800' : 'border-slate-100'}`}>
              <div className="flex items-center gap-4">
                <h3 className={`text-base font-bold flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                  <div className={`w-2 h-6 rounded-full ${dashboardTheme === 'dark' ? 'bg-amber-500' : 'bg-amber-500'}`}></div>
                  全局采购单监控
                </h3>
                
                {/* Tabs */}
                <div className={`flex items-center gap-1 rounded-lg p-1 ${dashboardTheme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}`}>
                    <button
                      onClick={() => setPoOverviewFilter('all')}
                      className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${poOverviewFilter === 'all' ? (dashboardTheme === 'dark' ? 'bg-slate-700 text-white shadow' : 'bg-white text-slate-800 shadow') : (dashboardTheme === 'dark' ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800')}`}
                    >
                      全部
                    </button>
                    <button
                      onClick={() => setPoOverviewFilter('followup')}
                      className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${poOverviewFilter === 'followup' ? 'bg-red-500 text-white shadow' : (dashboardTheme === 'dark' ? 'text-slate-400 hover:text-red-400' : 'text-slate-500 hover:text-red-600')}`}
                    >
                      <AlertCircle size={12} className={poOverviewFilter === 'followup' ? 'animate-pulse' : ''} />
                      需紧急跟进
                    </button>
                </div>
              </div>

              <div className="flex gap-2">
                <select 
                   value={poSortBy}
                   onChange={e => setPoSortBy(e.target.value)}
                   className={`text-xs font-bold px-3 py-2 rounded-lg border focus:outline-none ${dashboardTheme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'}`}
                >
                  <option value="orderDate">按 下单时间 排序</option>
                  <option value="arrivalDate">按 到货时间 排序</option>
                </select>
              </div>
            </div>

            <div className={`flex-1 overflow-y-auto p-0`}>
            {(() => {
              // 收集所有采购单
              const allPos = [];
              dashboardData.forEach(sku => {
                (sku.pos || []).forEach(po => {
                  const arrivalDate = new Date(po.orderDate);
                  const totalLT = Number(po.prodDays || 0) + Number(po.leg1Days || 0) + Number(po.leg2Days || 0) + Number(po.leg3Days || 0);
                  arrivalDate.setDate(arrivalDate.getDate() + totalLT);
                  const prodEndDate = new Date(new Date(po.orderDate).getTime() + Number(po.prodDays || 0) * 86400000);
                  const daysUntilProdEnd = (prodEndDate - new Date()) / 86400000;
                  const needsFollowUp = po.status === 'in_production' && daysUntilProdEnd > 0 && daysUntilProdEnd <= 45;
                  
                  allPos.push({
                    ...po,
                    skuId: sku.id,
                    skuName: sku.name,
                    arrivalDate: arrivalDate.toISOString().split('T')[0],
                    needsFollowUp,
                    followUpDays: Math.ceil(daysUntilProdEnd)
                  });
                });
              });

              // 排序
              const sorted = [...allPos].sort((a, b) => {
                if (poSortBy === 'orderDate') {
                  return new Date(a.orderDate) - new Date(b.orderDate);
                } else {
                  return new Date(a.arrivalDate) - new Date(b.arrivalDate);
                }
              });

              const statusColorMap = {
                 // 定义状态颜色映射，更柔和的版本
                 pre_order: { bg: 'bg-slate-100', text: 'text-slate-600', darkBg: 'bg-slate-800', darkText: 'text-slate-400' },
                 ordered: { bg: 'bg-slate-200', text: 'text-slate-800', darkBg: 'bg-slate-700', darkText: 'text-slate-200' },
                 in_production: { bg: 'bg-amber-50', text: 'text-amber-700', darkBg: 'bg-amber-900/30', darkText: 'text-amber-400' },
                 prod_complete: { bg: 'bg-orange-50', text: 'text-orange-700', darkBg: 'bg-orange-900/30', darkText: 'text-orange-400' },
                 leg1_shipped: { bg: 'bg-blue-50', text: 'text-blue-700', darkBg: 'bg-blue-900/30', darkText: 'text-blue-400' },
                 leg1_arrived: { bg: 'bg-cyan-50', text: 'text-cyan-700', darkBg: 'bg-cyan-900/30', darkText: 'text-cyan-400' },
                 leg2_shipped: { bg: 'bg-violet-50', text: 'text-violet-700', darkBg: 'bg-violet-900/30', darkText: 'text-violet-400' },
                 leg2_arrived: { bg: 'bg-purple-50', text: 'text-purple-700', darkBg: 'bg-purple-900/30', darkText: 'text-purple-400' },
                 shelved: { bg: 'bg-emerald-50', text: 'text-emerald-700', darkBg: 'bg-emerald-900/30', darkText: 'text-emerald-400' },
              }
              const defaultStatusColor = { bg: 'bg-slate-50', text: 'text-slate-600', darkBg: 'bg-slate-800/50', darkText: 'text-slate-500' };

              const statusLabel = {
                pre_order: '预下订单', ordered: '已下单', in_production: '生产中', prod_complete: '生产完成',
                leg1_shipped: '头程发货', leg1_arrived: '头程到货', leg2_shipped: '二程发货', leg2_arrived: '二程到货',
                inspecting: '查验中', bonded_warehouse: '保税仓', pending_shelving: '待理货', shelved: '已上架'
              };

              // 过滤掉预下订单和已理货上架
              let visiblePos = sorted.filter(po => po.status !== 'pre_order' && po.status !== 'shelved');
              if (poOverviewFilter === 'followup') {
                visiblePos = visiblePos.filter(po => po.needsFollowUp);
              }

              return (
                <div className="w-full">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead className={`sticky top-0 z-10 text-xs font-bold uppercase tracking-wider border-b ${dashboardTheme === 'dark' ? 'bg-slate-900/95 text-slate-500 border-slate-800' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                      <tr>
                        <th className="py-3 px-4 font-medium w-56">商品信息</th>
                        <th className="py-3 px-4 font-medium w-32">采购单号</th>
                        <th className="py-3 px-4 font-medium text-right w-24">数量</th>
                        <th className="py-3 px-4 font-medium w-32 text-center">当前状态</th>
                        <th className="py-3 px-4 font-medium w-32">关键节点</th>
                        <th className="py-3 px-4 font-medium w-40">异常/备注</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-xs font-medium ${dashboardTheme === 'dark' ? 'divide-slate-800/50 text-slate-400' : 'divide-slate-100 text-slate-600'}`}>
                      {visiblePos.length === 0 ? (
                        <tr>
                            <td colSpan="6" className="py-12 text-center italic opacity-60">没有找到符合条件的采购单</td>
                        </tr>
                      ) : (
                        visiblePos.map((po, idx) => {
                            const config = statusColorMap[po.status] || defaultStatusColor;
                            const badgeClass = dashboardTheme === 'dark' 
                                ? `${config.darkBg} ${config.darkText} border border-white/5` 
                                : `${config.bg} ${config.text} border border-black/5`;
                            
                            return (
                                <tr key={idx} className={`transition-colors ${dashboardTheme === 'dark' ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                                    <td className="py-3 px-4">
                                      <div className={`font-bold text-sm mb-0.5 truncate max-w-[220px] ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{po.skuName}</div>
                                        <div className="opacity-60 text-[10px]">ID: {po.skuId}</div>
                                    </td>
                                    <td className="py-3 px-4 font-mono opacity-80">{po.poNumber}</td>
                                    <td className="py-3 px-4 text-right font-mono font-bold">{po.qty}</td>
                                    <td className="py-3 px-4 text-center">
                                        <span className={`px-2 py-1 rounded text-[10px] font-bold inline-block ${badgeClass}`}>
                                            {statusLabel[po.status] || po.status}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="flex flex-col gap-0.5 text-[10px]">
                                            <div className="flex justify-between"><span>下单:</span> <span className="font-mono">{po.orderDate}</span></div>
                                            <div className="flex justify-between"><span>预计:</span> <span className={`${dashboardTheme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'} font-mono`}>{po.arrivalDate}</span></div>
                                        </div>
                                    </td>
                                    <td className="py-3 px-4">
                                        {po.needsFollowUp ? (
                                            <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold ${dashboardTheme === 'dark' ? 'bg-red-900/20 border-red-800 text-red-400' : 'bg-red-50 border-red-100 text-red-600'}`}>
                                                <AlertTriangle size={12} className="flex-shrink-0"/>
                                                <span>距完工还剩 {po.followUpDays} 天</span>
                                            </div>
                                        ) : (
                                            <span className="opacity-20">-</span>
                                        )}
                                    </td>
                                </tr>
                            )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            </div>
          </div>

          {/* 右侧信息位 */}
          <div className={`col-span-4 rounded-[2rem] border p-6 shadow-sm flex flex-col ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`}>
            <div className="flex items-center justify-between mb-6">
              <h3 className={`text-base font-bold flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                <div className={`w-2 h-6 rounded-full ${dashboardTheme === 'dark' ? 'bg-rose-500' : 'bg-rose-600'}`}></div>
                补货建议明细
              </h3>
            </div>

            <div className="flex-1 flex flex-col">
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                各 SKU 补货数量建议 与 补货后最早断货日期
              </div>
              <div className={`grid grid-cols-[1fr_110px_110px] items-center text-[10px] font-bold uppercase tracking-wider px-2 pb-2 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                <div>SKU</div>
                <div className="text-right">补货建议</div>
                <div className="text-right">最早断货</div>
              </div>
              <div className={`flex-1 overflow-y-auto pr-1 space-y-2 ${dashboardTheme === 'dark' ? 'scrollbar-thin scrollbar-thumb-slate-700/80' : 'scrollbar-thin scrollbar-thumb-slate-200'}`}>
                {replenishmentRows.length === 0 ? (
                  <div className={`text-xs italic ${dashboardTheme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>暂无需要补货的 SKU</div>
                ) : (
                  replenishmentRows.slice(0, showAllReplenishment ? replenishmentRows.length : 8).map(row => (
                    <div key={row.id} className={`rounded-xl border p-3 ${dashboardTheme === 'dark' ? 'bg-slate-800/40 border-slate-700/50' : 'bg-slate-50 border-slate-100'}`}>
                      <div className="grid grid-cols-[1fr_110px_110px] items-center gap-3">
                        <div className="min-w-0">
                          <div className={`font-bold text-sm truncate ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{row.name}</div>
                          <div className={`text-[10px] mt-0.5 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>ID: {row.id}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-black font-mono ${dashboardTheme === 'dark' ? 'text-rose-300' : 'text-rose-700'}`}>
                            {Math.round(row.suggestQty).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-[11px] font-bold ${row.stockoutDate !== '安全' ? (dashboardTheme === 'dark' ? 'text-amber-300' : 'text-amber-700') : (dashboardTheme === 'dark' ? 'text-emerald-300' : 'text-emerald-700')}`}>
                            {row.stockoutDate}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {replenishmentRows.length > 8 && (
                <button
                  onClick={() => setShowAllReplenishment(!showAllReplenishment)}
                  className={`text-[10px] font-bold mt-3 px-3 py-1.5 rounded-lg transition-all ${dashboardTheme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800'}`}
                >
                  {showAllReplenishment ? '▲ 收起' : `▼ 显示全部 (${replenishmentRows.length})`}
                </button>
              )}
            </div>
          </div>
          </div>

          {/* 战略推演总表 - 重构版 */}
          <div className={`flex-1 overflow-hidden rounded-[2rem] border shadow-sm flex flex-col min-h-0 ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`}>
             <div className="overflow-auto flex-1">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead className={`sticky top-0 z-20 ${dashboardTheme === 'dark' ? 'bg-slate-900 shadow-md shadow-slate-900/10' : 'bg-white shadow-md shadow-slate-200/50'}`}>
                      <tr>
                        <th className={`py-4 pl-8 w-64 text-left text-xs font-bold uppercase tracking-wider ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>商品信息</th>
                        <th className={`py-4 text-center text-xs font-bold uppercase tracking-wider w-32 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>实时库存</th>
                        <th className={`py-4 text-center text-xs font-bold uppercase tracking-wider w-32 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>断货预测</th>
                        <th className={`py-4 text-center text-xs font-bold uppercase tracking-wider w-40 ${dashboardTheme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>下单建议</th>
                        {Array.from({length: 12}).map((_, i) => {
                          const d = new Date(); d.setMonth(d.getMonth() + i);
                          return <th key={i} className={`py-4 text-center text-[10px] font-bold uppercase tracking-wider w-20 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>{(d.getMonth() + 1)}月</th>
                        })}
                      </tr>
                  </thead>
                  <tbody className={`divide-y ${dashboardTheme === 'dark' ? 'divide-slate-800/50' : 'divide-slate-100'}`}>
                    {dashboardData.map(sku => (
                      <tr key={sku.id} className={`group code-font transition-colors ${dashboardTheme === 'dark' ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}`}>
                          {/* 商品名 */}
                          <td className="py-4 pl-8">
                            <div className={`font-bold text-sm mb-1 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{sku.name}</div>
                            <div className={`text-[10px] uppercase font-mono ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>#{String(sku.id).padStart(3, '0')}</div>
                          </td>
                          
                          {/* 实时库存 */}
                          <td className="py-4 text-center">
                              <span className={`font-mono font-bold text-base ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                                {sku.currentStock?.toLocaleString()}
                              </span>
                          </td>
                          
                          {/* 断货预测日 */}
                          <td className="py-4 text-center">
                              {sku.finalStockOutDate !== '安全' ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 animate-pulse">
                                  {sku.finalStockOutDate}
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                                  安全
                                </span>
                              )}
                          </td>
                          
                          {/* 下单决策 */}
                          <td className={`py-4 px-4 text-center border-x ${dashboardTheme === 'dark' ? 'bg-indigo-900/5 border-indigo-900/10' : 'bg-indigo-50/30 border-indigo-50'}`}>
                            {sku.finalStockOutDate !== '安全' ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className={`text-[10px] uppercase font-bold ${dashboardTheme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>截止: {sku.orderDateStr}</span>
                                <span className={`font-mono font-bold text-lg ${sku.urgency === 'critical' ? 'text-red-500' : (dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800')}`}>
                                  {sku.suggestQty.toFixed(0)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-slate-600 font-medium italic">无需操作</span>
                            )}
                          </td>
                          
                          {/* 12个月预测 - 热力图风格 */}
                          {sku.forecast.monthEndStocks.slice(0, 12).map((m, i) => {
                            let cellBg = '';
                            let cellText = dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400';
                            
                            if (m.stock <= 0) {
                              cellBg = dashboardTheme === 'dark' ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-700';
                              cellText = ''; 
                            } else if (m.status === 'low') {
                              cellBg = dashboardTheme === 'dark' ? 'bg-amber-900/40 text-amber-400' : 'bg-amber-100 text-amber-800';
                              cellText = '';
                            }
                            
                            return (
                              <td key={i} className={`p-1 text-center font-mono text-xs ${cellBg || cellText}`}>
                                {m.stock <= 0 ? (
                                  <span className="font-bold">×</span>
                                ) : (
                                  <span className={cellBg ? 'font-bold' : ''}>
                                    {m.stock > 9999 ? (m.stock/1000).toFixed(1)+'k' : m.stock.toFixed(0)}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        </div>
      )}
      </div>

      {/* 设置模态框 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-indigo-950 text-white p-6 flex justify-between items-center border-b border-indigo-900">
              <h3 className="text-2xl font-black tracking-tight flex items-center gap-3">
                <Settings size={28} /> 系统设置
              </h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-indigo-900 rounded-lg transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="p-8 space-y-8">
              {/* 运输方式管理 */}
              <div className="space-y-4">
                <h4 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <Ship size={20} className="text-blue-600"/> 运输方式管理
                </h4>
                <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  {transportModes.map((mode, idx) => (
                    <div key={mode.id} className="flex gap-2 items-center">
                      <span className="text-xs font-bold text-slate-600 w-8">方式{idx+1}</span>
                      <input
                        type="text"
                        value={mode.name}
                        onChange={e => {
                          const newModes = [...transportModes];
                          newModes[idx] = {...mode, name: e.target.value};
                          setTransportModes(newModes);
                        }}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 font-medium text-sm"
                      />
                      {idx >= 3 && (
                        <button
                          onClick={() => setTransportModes(transportModes.filter((_, i) => i !== idx))}
                          className="px-3 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors text-xs font-bold"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const newId = `custom_${Date.now()}`;
                      setTransportModes([...transportModes, { id: newId, name: `方式${transportModes.length + 1}` }]);
                    }}
                    className="w-full px-3 py-2 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 transition-colors text-xs font-bold flex items-center justify-center gap-2 mt-2"
                  >
                    <Plus size={14}/> 新建运输方式
                  </button>
                </div>
              </div>

              {/* 预警时间设置 */}
              <div className="space-y-4">
                <h4 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <AlertTriangle size={20} className="text-red-600"/> 库存预警时间
                </h4>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">预警天数（约{(warningDays/30).toFixed(1)}个月）</label>
                    <input
                      type="number"
                      value={warningDays}
                      onChange={e => setWarningDays(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-red-500 font-medium"
                    />
                    <p className="text-[10px] text-slate-500 mt-2">当库存即将在此天数内用尽时触发预警，默认7.5个月（225天）</p>
                  </div>
                </div>
              </div>

              {/* 默认参数设置 */}
              <div className="space-y-4">
                <h4 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <Factory size={20} className="text-amber-600"/> 采购单默认参数
                </h4>
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">生产周期（天）</label>
                    <input
                      type="number"
                      value={defaultSettings.defaultProdDays}
                      onChange={e => setDefaultSettings({...defaultSettings, defaultProdDays: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-amber-500 font-medium"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">头程时效（天）</label>
                    <input
                      type="number"
                      value={defaultSettings.defaultLeg1Days}
                      onChange={e => setDefaultSettings({...defaultSettings, defaultLeg1Days: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-amber-500 font-medium"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">二程时效（天）</label>
                    <input
                      type="number"
                      value={defaultSettings.defaultLeg2Days}
                      onChange={e => setDefaultSettings({...defaultSettings, defaultLeg2Days: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-amber-500 font-medium"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">三程时效（天）</label>
                    <input
                      type="number"
                      value={defaultSettings.defaultLeg3Days}
                      onChange={e => setDefaultSettings({...defaultSettings, defaultLeg3Days: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-amber-500 font-medium"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">默认采购数量</label>
                    <input
                      type="number"
                      value={defaultSettings.defaultQty}
                      onChange={e => setDefaultSettings({...defaultSettings, defaultQty: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-amber-500 font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* 关闭按钮 */}
              <div className="flex gap-3 pt-6 border-t border-slate-200">
                <button
                  onClick={() => {
                    // 保存设置到本地存储
                    const localData = loadLocalMemory(localKey) || {};
                    saveLocalMemory(localKey, {
                      ...localData,
                      warningDays,
                      defaultSettings,
                      transportModes
                    });
                    
                    // 保存设置到 Firestore
                    if (db && user) {
                      try {
                        const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');
                        setDoc(docRef, { 
                          warningDays, 
                          defaultSettings, 
                          transportModes,
                          lastUpdated: new Date().toISOString() 
                        }, { merge: true })
                          .then(() => {
                            console.log('✅ 设置已保存到云端');
                            setWarning('✅ 设置已保存成功！');
                            setTimeout(() => setWarning(''), 2000);
                          })
                          .catch(err => {
                            console.error('❌ 保存设置失败:', err.message);
                            setWarning('⚠️ 设置已保存到本地（云端保存失败）');
                            setTimeout(() => setWarning(''), 3000);
                          });
                      } catch (err) {
                        console.error('❌ 保存设置异常:', err);
                        setWarning('⚠️ 设置已保存到本地（出现异常）');
                        setTimeout(() => setWarning(''), 3000);
                      }
                    }
                    
                    setShowSettings(false);
                  }}
                  className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-black hover:bg-indigo-700 transition-colors text-sm uppercase tracking-wider"
                >
                  确认保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 快速填充月度销量对话框 */}
      {showQuickFill && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full">
            <div className="bg-emerald-600 text-white p-6 flex justify-between items-center border-b border-emerald-700">
              <h3 className="text-xl font-black tracking-tight flex items-center gap-3">
                ⚡ 快速填充月度销量
              </h3>
              <button onClick={() => setShowQuickFill(false)} className="p-2 hover:bg-emerald-700 rounded-lg transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div>
                <label className="text-sm font-black text-slate-800 block mb-3">
                  输入年度总销量（将均匀分配到12个月）
                </label>
                <input
                  type="number"
                  autoFocus
                  value={quickFillValue}
                  onChange={e => setQuickFillValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && quickFillMonthlySales()}
                  placeholder="请输入数值，如2400"
                  className="w-full px-4 py-3 border-2 border-emerald-200 rounded-xl focus:outline-none focus:border-emerald-500 font-bold text-lg"
                />
                <p className="text-xs text-slate-500 mt-2">
                  如输入2400，每月将分配200件（2400÷12）
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowQuickFill(false);
                    setQuickFillValue('');
                  }}
                  className="flex-1 bg-slate-200 text-slate-700 py-3 rounded-xl font-black hover:bg-slate-300 transition-colors text-sm uppercase tracking-wider"
                >
                  取消
                </button>
                <button
                  onClick={quickFillMonthlySales}
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-black hover:bg-emerald-700 transition-colors text-sm uppercase tracking-wider"
                >
                  确认填充
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- 8. 启动渲染 ---
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

export default App;