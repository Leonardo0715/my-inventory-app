import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  TrendingDown, Clock, Plus, AlertTriangle, BarChart3, 
  Check, X, Layout, List, RefreshCw, Save, Edit2,
  Ship, Plane, Factory, Calendar, AlertCircle, ArrowRight, Train, Trash2, Settings
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
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
  { id: 1, name: '旗舰商品 A (北美线)', currentStock: 1200, monthlySales: Array(12).fill(600), pos: [{ id: 101, poNumber: 'PO-20260214-001', orderDate: new Date().toISOString().split('T')[0], qty: 2500, prodDays: 30, leg1Mode: 'sea', leg1Days: 35, leg2Mode: 'rail', leg2Days: 15 }] },
  { id: 2, name: '高周转新品 B (东南亚)', currentStock: 4000, monthlySales: Array(12).fill(800), pos: [] }
];

function sanitizeSkus(items) {
  const safeArr = Array.isArray(items) ? items : [];
  return safeArr
    .filter(Boolean)
    .map((sku, idx) => {
      const id = Number.isFinite(Number(sku.id)) ? Number(sku.id) : (idx + 1);
      const name = String(sku.name ?? `SKU #${id}`);
      const currentStock = Number(sku.currentStock ?? 0);
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
        status: ['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'].includes(po.status) ? po.status : 'ordered',
      }));
      return { id, name, currentStock, monthlySales, pos };
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
  // 统一走 loading -> ready，让云端/默认两种模式都能明确显示"加载记忆中"
  const [status, setStatus] = useState('loading'); 
  
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
  const [expandedPoId, setExpandedPoId] = useState(null); // 展开的采购单ID
  const [poFilter, setPoFilter] = useState('all'); // 'all', 'pending', 'completed'

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

  // --- 2. 身份认证逻辑 ---
  useEffect(() => {
    if (!auth) {
      console.warn('⚠️ Auth 未初始化，跳过身份认证');
      return;
    }
    
    const initAuth = async () => {
      try {
        console.log('🔐 开始匿名认证...');
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
          console.log('✅ 使用自定义 token 认证成功');
        } else {
          await signInAnonymously(auth);
          console.log('✅ 匿名认证成功');
        }
      } catch (err) { 
        console.error('❌ 认证失败:', err.code, err.message);
        setStatus('error'); 
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currUser) => {
      console.log('👤 认证状态变化: currUser =', currUser ? currUser.uid : 'null');
      setUser(currUser);
    });
    return () => unsubscribe();
  }, []);

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
      setStatus('ready');
      console.log('✅ 从本地恢复成功');
    } else {
      const initialData = sanitizeSkus(DEFAULT_DATA);
      setSkus(initialData);
      setSelectedSkuId(initialData[0]?.id ?? 1);
      setViewMode('detail');
      setStatus('ready');
      console.log('✅ 使用默认数据');
    }

    if (!db) {
      console.log('⚠️ Firebase 未初始化，仅使用本地数据');
      setSyncStatus('offline');
      setIsInitialLoadDone(true);
    }
  }, [localKey]);

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
          setDoc(docRef, { items: bootstrap, lastUpdated: new Date().toISOString() }, { merge: true })
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
      saveLocalMemory(localKey, { skus, selectedSkuId, viewMode, savedAt: Date.now() });
    }, 300);
    return () => clearTimeout(timer);
  }, [skus, selectedSkuId, viewMode, localKey]);

  // --- 4.2 云端自动存档（多人共享） ---
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
        await setDoc(docRef, { items: skus, lastUpdated: new Date().toISOString() }, { merge: true });
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

  // 采购单系统
  const addPO = (skuId) => {
    setSkus(prev => prev.map(s => {
      if (s.id === skuId) {
        const poNumber = generatePONumber(skuId);
        const newPO = { id: Date.now(), poNumber, orderDate: new Date().toISOString().split('T')[0], qty: defaultSettings.defaultQty, prodDays: defaultSettings.defaultProdDays, leg1Mode: 'sea', leg1Days: defaultSettings.defaultLeg1Days, leg2Mode: 'sea', leg2Days: defaultSettings.defaultLeg2Days, status: 'ordered' };
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
      setWarning('当前 SKU 没有采购单数据可导出');
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
      setWarning('当前 SKU 没有采购单数据可导出');
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
        const totalLT = Number(po.prodDays || 0) + Number(po.leg1Days || 0) + Number(po.leg2Days || 0);
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
    const firstStockOut = f.data.find(d => d.stock <= 0);
    let orderDateStr = "安全";
    let urgency = 'normal', suggestQty = 0;
    if (firstStockOut) {
      const d = new Date(new Date(firstStockOut.date).getTime() - warningDays * 86400000);
      orderDateStr = d.toLocaleDateString();
      if (d < new Date()) urgency = 'critical';
      suggestQty = f.currentMonthRate * warningDays;
    }
    return { ...sku, forecast: f, firstStockOut, orderDateStr, urgency, suggestQty };
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
      if (sku.firstStockOut) {
        const stockoutDate = new Date(sku.firstStockOut.date);
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

  const visibleForecastRows = useMemo(() => {
    if (!activeForecast || !activeForecast.data) return [];
    const sliceLen = Math.min(horizonDays + 1, activeForecast.data.length);
    let rows = activeForecast.data.slice(0, sliceLen).map((row, idx) => ({ ...row, __idx: idx }));
    if (onlyInboundDays) {
      rows = rows.filter(r => r.incomingQty > 0);
    }
    return rows;
  }, [activeForecast, horizonDays, onlyInboundDays]);

  const jumpToFirstStockout = () => {
    if (!activeForecast || !activeForecast.data) return;
    const idx = activeForecast.data.findIndex(d => d.stock <= 0);
    if (idx === -1) return;
    const el = document.getElementById(`forecast-row-${idx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // --- 7. UI 渲染 ---
  if (status === 'loading') return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white font-bold animate-pulse">
       <RefreshCw className="animate-spin mb-4 text-indigo-400" size={48} />
       <span className="tracking-widest">系统正在加载记忆数据...</span>
    </div>
  );

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col font-sans text-slate-800 text-sm overflow-hidden">
      {warning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-100 border border-amber-300 text-amber-800 px-6 py-2 rounded-full text-xs font-bold shadow-xl flex items-center gap-2 animate-in slide-in-from-top-2">
          <AlertCircle size={14} className="text-amber-500" />
          <span>{warning}</span>
          <button onClick={() => setWarning('')} className="ml-2 text-amber-600 hover:text-amber-800">
            <X size={12} />
          </button>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden bg-slate-100">
      {viewMode === 'detail' ? (
        <>
          {/* 侧边栏 */}
          <div className="w-80 bg-white border-r border-slate-200 flex flex-col z-20 flex-shrink-0">
            <div className="p-6 bg-indigo-950 text-white">
              <div className="flex justify-between items-center mb-1">
                <h2 className="text-xl font-black flex items-center gap-2 tracking-tight"><BarChart3 size={24}/> 智策中心</h2>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-indigo-800 rounded-lg transition-colors" title="打开设置"><Settings size={18} className="text-slate-300 hover:text-white"/></button>
                  <Save className="text-emerald-500 opacity-50" size={16}/>
                </div>
              </div>
              <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-widest italic leading-relaxed">{memoryModeText}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {dashboardData.map(item => (
                <div key={item.id} onClick={() => renamingSkuId !== item.id && setSelectedSkuId(item.id)} className={`p-3 rounded-xl border-2 transition-all cursor-pointer group relative ${selectedSkuId === item.id ? 'bg-indigo-50 border-indigo-400 shadow-md' : 'bg-white border-transparent hover:border-slate-200'}`}>
                  <div className="flex justify-between items-center mb-1">
                    {renamingSkuId === item.id ? (
                      <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                        <input autoFocus value={tempName} onChange={e => setTempName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRenaming()} className="w-full text-xs p-1 border rounded outline-none border-indigo-400 font-bold text-indigo-900" />
                        <button onClick={saveRenaming} className="p-1 text-emerald-600"><Check size={14}/></button>
                      </div>
                    ) : (
                      <>
                        <span className="font-black text-sm truncate w-32 text-slate-700 uppercase tracking-tighter">{item.name}</span>
                        <div className="flex items-center gap-1">
                           <button onClick={(e) => { e.stopPropagation(); startRenaming(item); }} className="p-1 text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity" title="编辑名称"><Edit2 size={12}/></button>
                           <button onClick={(e) => { e.stopPropagation(); duplicateSku(item.id); }} className="p-1 text-slate-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" title="复制SKU"><Trash2 size={12} className="rotate-180"/></button>
                           <button onClick={(e) => { e.stopPropagation(); deleteSku(item.id); }} className="p-1 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" title="删除SKU"><Trash2 size={12}/></button>
                           <span className={`h-2.5 w-2.5 rounded-full ${item.firstStockOut ? 'bg-red-500' : 'bg-emerald-500'}`} />
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <span>库存: {item.currentStock?.toLocaleString()}</span>
                    <span className={item.firstStockOut ? 'text-red-500' : 'text-emerald-600'}>{item.firstStockOut ? '注意' : '稳健'}</span>
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
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">当前 SKU 覆盖能力</div>
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
               <div className="grid grid-cols-12 gap-6 h-full">
                  <div className="col-span-4 space-y-8">
                     {/* 参数配置 */}
                     <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <h3 className="text-lg font-bold mb-8 flex items-center gap-3 text-slate-800 tracking-tighter uppercase"><TrendingDown className="text-indigo-600"/> 核心水位调配</h3>
                        <div className="space-y-6">
                           <div>
                             <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 px-1">当前实物库存 PCS</label>
                             <input
                               type="number"
                               value={activeSku?.currentStock || 0}
                               onChange={e => updateSku(activeSku.id, 'currentStock', clampNonNegativeInt(e.target.value, '当前库存'))}
                               className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl p-6 font-mono text-3xl font-black focus:border-indigo-500 outline-none transition-all shadow-inner"
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
                                       const n = [...activeSku.monthlySales];
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
                              <button onClick={exportPOsToJSON} className="text-[11px] px-2 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 font-bold uppercase tracking-tighter" title="导出 JSON">JSON</button>
                              <button onClick={exportPOsToCSV} className="text-[11px] px-2 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 font-bold uppercase tracking-tighter" title="导出 CSV">CSV</button>
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
                        <div className="space-y-3 overflow-y-auto pr-2" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                           {(!activeSku?.pos || activeSku.pos.length === 0) && <div className="text-center py-10 text-slate-300 font-bold italic border-2 border-dashed border-slate-100 rounded-3xl text-sm">暂无在途订单数据</div>}
                           {activeSku?.pos?.filter(po => {
                             // 筛选逻辑：待完成（未shelved）/ 已完成（shelved）
                             if (poFilter === 'pending') return po.status !== 'shelved' && po.status !== 'pre_order' && po.status !== 'cancelled';
                             if (poFilter === 'completed') return po.status === 'shelved';
                             return true; // all
                           }).map(po => {
                             // 计算预警：距离生产完成日期1.5个月（45天）内
                             const prodEndDate = new Date(new Date(po.orderDate).getTime() + Number(po.prodDays) * 86400000);
                             const daysUntilProdEnd = (prodEndDate - new Date()) / 86400000;
                             const isProductionWarning = po.status !== 'cancelled' && po.status !== 'pre_order' && po.status !== 'shelved' && daysUntilProdEnd > 0 && daysUntilProdEnd <= 45;
                             const isExpanded = expandedPoId === po.id;
                             
                             return (
                             <div key={po.id} className={`rounded-xl relative group border transition-all ${isProductionWarning ? 'bg-red-50 border-red-300 shadow-md shadow-red-200' : 'bg-slate-50 border-slate-200 hover:border-indigo-300'} p-4`}>
                                {isProductionWarning && (
                                  <div className="mb-3 bg-red-100 border border-red-300 rounded-lg px-3 py-2 flex items-center gap-2">
                                    <AlertTriangle size={14} className="text-red-600 flex-shrink-0" />
                                    <span className="text-[11px] font-black text-red-700">⚠️ 交期预警：距离生产完成仅 {Math.ceil(daysUntilProdEnd)} 天！</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200">
                                  <button 
                                    onClick={() => setExpandedPoId(isExpanded ? null : po.id)}
                                    className="flex items-center gap-2 flex-1 text-left hover:opacity-70 transition-opacity"
                                  >
                                    <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                    <label className="text-[10px] font-black text-slate-400 block">PO 号</label>
                                  </button>
                                  <span className="text-sm font-black text-indigo-700 bg-indigo-50 rounded-lg px-3 py-1.5">{po.poNumber}</span>
                                </div>
                                {!isExpanded && (
                                  <div className="grid grid-cols-3 gap-3 mb-1 text-[12px]">
                                    <div>
                                      <label className="text-[10px] font-black text-slate-400 block mb-1.5">下单日期</label>
                                      <span className="font-mono text-slate-600 text-sm">{po.orderDate}</span>
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-black text-slate-400 block mb-1.5">采购数量</label>
                                      <span className="font-black text-indigo-600 font-mono text-sm">{po.qty}</span>
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-black text-slate-400 block mb-1.5">采购状态</label>
                                      <span className="text-[11px] font-black bg-slate-100 rounded px-2.5 py-1.5">{['预下订单', '已下单', '取消订单', '生产中', '生产完成', '头程发货', '头程到货', '二程发货', '二程到货', '查验中', '提货中', '到达保税仓', '待理货上架', '已理货上架'].find((_, i) => ['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'][i] === po.status) || po.status}</span>
                                    </div>
                                  </div>
                                )}
                                {isExpanded && (
                                  <>
                                  <input 
                                    type="text" 
                                    value={po.poNumber} 
                                    onChange={e => updatePO(activeSku.id, po.id, 'poNumber', e.target.value)} 
                                    className="text-sm font-black text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2.5 w-full outline-none border border-indigo-200 focus:border-indigo-400 transition-colors mb-3" 
                                  />
                                  <div className="grid grid-cols-2 gap-3 mb-3 font-bold uppercase">
                                    <div>
                                      <label className="text-[10px] font-black text-slate-400 block mb-1.5">下单日期</label>
                                      <input type="date" value={po.orderDate} onChange={e => updatePO(activeSku.id, po.id, 'orderDate', e.target.value)} className="text-sm text-slate-600 bg-transparent outline-none" />
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-black text-slate-400 block mb-1.5">采购单状态</label>
                                      <select 
                                        value={po.status || 'ordered'} 
                                        onChange={e => updatePO(activeSku.id, po.id, 'status', e.target.value)}
                                        className="text-sm font-black bg-slate-100 rounded px-2 py-1 border border-slate-300 focus:outline-none focus:border-indigo-500"
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
                                  <div className="grid grid-cols-2 gap-3 mb-3 font-bold uppercase">
                                    <div>
                                      <label className="text-[10px] font-black text-slate-400 block mb-1.5"></label>
                                    </div>
                                    <div className="text-right">
                                      <label className="text-[10px] font-black text-slate-400 block mb-1.5 text-right">采购数量</label>
                                      <input
                                        type="number"
                                        value={po.qty}
                                        onChange={e => updatePO(activeSku.id, po.id, 'qty', clampNonNegativeInt(e.target.value, '采购数量'))}
                                        className="text-indigo-600 font-black bg-transparent w-full text-right outline-none font-mono text-sm"
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1.5 bg-white/50 p-3 rounded-xl border border-slate-100 text-[11px] font-bold">
                                     <div className="flex justify-between items-center text-slate-500">
                                        <span className="uppercase tracking-tighter"><Factory size={11} className="inline mr-1"/>生产周期</span>
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number"
                                            value={po.prodDays}
                                            onChange={e => updatePO(activeSku.id, po.id, 'prodDays', clampNonNegativeInt(e.target.value, '生产周期'))}
                                            className="w-8 text-right bg-transparent border-b border-slate-200"
                                          />天
                                        </div>
                                     </div>
                                     <div className="flex justify-between items-center text-blue-600">
                                        <span className="flex items-center gap-1 uppercase tracking-tighter">
                                          <select value={po.leg1Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg1Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>时效 (头程)
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number"
                                            value={po.leg1Days}
                                            onChange={e => updatePO(activeSku.id, po.id, 'leg1Days', clampNonNegativeInt(e.target.value, '头程时效'))}
                                            className="w-8 text-right bg-transparent border-b border-blue-100"
                                          />天
                                        </div>
                                     </div>
                                     <div className="flex justify-between items-center text-orange-600">
                                        <span className="flex items-center gap-1 uppercase tracking-tighter">
                                          <select value={po.leg2Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg2Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>时效 (二程)
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number"
                                            value={po.leg2Days}
                                            onChange={e => updatePO(activeSku.id, po.id, 'leg2Days', clampNonNegativeInt(e.target.value, '二程时效'))}
                                            className="w-8 text-right bg-transparent border-b border-orange-100"
                                          />天
                                        </div>
                                     </div>
                                  </div>
                                  <div className="mt-3 flex items-center justify-between">
                                    <div className="text-[11px] font-black text-indigo-500 uppercase tracking-tighter italic leading-none">
                                      预计到货日: {new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays)+Number(po.leg1Days)+Number(po.leg2Days)) * 86400000).toLocaleDateString()}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button 
                                        onClick={() => duplicatePO(activeSku.id, po.id)} 
                                        className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors" 
                                        title="复制此采购单"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                        </svg>
                                      </button>
                                      <button 
                                        onClick={() => removePO(activeSku.id, po.id)} 
                                        className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors" 
                                        title="删除此采购单"
                                      >
                                        <Trash2 size={14}/>
                                      </button>
                                    </div>
                                  </div>
                                  </>
                                )}
                             </div>
                             );
                           })}
                        </div>
                     </div>
                  </div>

                  {/* 推演线性表 */}
                  <div className="col-span-8 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-0">
                     <div className="px-6 py-4 border-b bg-slate-50/50">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-black text-slate-700 uppercase tracking-widest text-sm">
                            Inventory Dynamics
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
                              <tr><th className="p-4 pl-6 text-left">推演日期</th><th className="p-4 text-center">预估剩余库存 PCS</th><th className="p-4 text-right pr-6">实时判定</th></tr>
                           </thead>
                           <tbody className="divide-y divide-slate-50 font-medium text-sm">
                              {visibleForecastRows.map((row) => (
                                <tr
                                  key={row.__idx}
                                  id={`forecast-row-${row.__idx}`}
                                  className={`hover:bg-indigo-50/30 transition-colors ${row.stock <= 0 ? 'bg-red-50/50' : (row.status === 'low' ? 'bg-amber-50/20' : '')}`}
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
                                     {row.stock <= 0 ? <span className="text-[10px] bg-red-600 text-white px-3 py-1 rounded-full font-black uppercase shadow-lg tracking-widest">Stockout</span> : 
                                      (row.status === 'low' ? <span className="text-[10px] bg-amber-400 text-white px-3 py-1 rounded-full font-black uppercase shadow-md tracking-widest">Order Now</span> : <span className="text-[10px] text-emerald-500 font-black border border-emerald-200 px-3 py-1 rounded-full bg-emerald-50 uppercase tracking-widest leading-none">Safe</span>)}
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
        <div className="flex-1 flex flex-col bg-slate-950 text-white overflow-hidden p-6">
          <div className="flex justify-between items-start mb-6 flex-shrink-0">
            <div className="flex items-start gap-8">
              <div className="flex items-center gap-6">
                <div className="h-20 w-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-indigo-500/50 transform rotate-3">
                  <BarChart3 size={40}/>
                </div>
                <div>
                  <h1 className="text-5xl font-black italic tracking-tighter uppercase">Strategic Command</h1>
                  <p className="text-indigo-500 font-bold uppercase tracking-[0.4em] text-[11px] mt-1 italic">
                    Deductive Engine: {warningDays}-Day Safe protocol active
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-[11px]">
                <div className="bg-slate-900/70 border border-rose-500/60 rounded-2xl px-5 py-3 shadow-xl">
                  <div className="text-[9px] font-black uppercase tracking-[0.2em] text-rose-300 mb-1">
                    未来一年内将断货 SKU
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-rose-400">
                      {fleetKpi.stockoutWithinHorizon}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">条 / {skus.length} 条在管</span>
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-amber-400/60 rounded-2xl px-5 py-3 shadow-xl">
                  <div className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-200 mb-1">
                    未来 {fleetKpi.orderWindowDays} 天需决策下单 SKU
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-amber-300">
                      {fleetKpi.needOrderSoon}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">条 · 含红色紧急窗口</span>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() => setViewMode('detail')}
              className="bg-slate-900 border-2 border-slate-800 px-10 py-4 rounded-[1.5rem] font-black hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-4 text-xs uppercase tracking-widest shadow-2xl"
            >
              <List size={20}/> 返回指挥中心视角
            </button>
          </div>

          {/* 采购单总览表 */}
          <div className="mb-6 bg-slate-900/50 rounded-3xl border border-slate-800 p-6 shadow-inner">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-700">
              <h3 className="text-lg font-black text-slate-200 flex items-center gap-3">
                📦 全部采购单总览
              </h3>
              <div className="flex gap-3">
                <button
                  onClick={() => setPoSortBy('orderDate')}
                  className={`px-4 py-2 rounded-lg text-xs font-black transition-colors ${poSortBy === 'orderDate' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                >
                  按下单时间
                </button>
                <button
                  onClick={() => setPoSortBy('arrivalDate')}
                  className={`px-4 py-2 rounded-lg text-xs font-black transition-colors ${poSortBy === 'arrivalDate' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                >
                  按到货时间
                </button>
              </div>
            </div>

            {(() => {
              // 收集所有采购单
              const allPos = [];
              dashboardData.forEach(sku => {
                (sku.pos || []).forEach(po => {
                  const arrivalDate = new Date(po.orderDate);
                  const totalLT = Number(po.prodDays || 0) + Number(po.leg1Days || 0) + Number(po.leg2Days || 0);
                  arrivalDate.setDate(arrivalDate.getDate() + totalLT);
                  
                  allPos.push({
                    ...po,
                    skuId: sku.id,
                    skuName: sku.name,
                    arrivalDate: arrivalDate.toISOString().split('T')[0]
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

              // 状态配色
              const statusColor = {
                pre_order: 'bg-gray-700 text-gray-200',
                ordered: 'bg-slate-700 text-slate-200',
                in_production: 'bg-yellow-900/50 text-yellow-200 border border-yellow-700',
                prod_complete: 'bg-orange-900/50 text-orange-200 border border-orange-700',
                leg1_shipped: 'bg-blue-900/50 text-blue-200 border border-blue-700',
                leg1_arrived: 'bg-cyan-900/50 text-cyan-200 border border-cyan-700',
                leg2_shipped: 'bg-violet-900/50 text-violet-200 border border-violet-700',
                leg2_arrived: 'bg-purple-900/50 text-purple-200 border border-purple-700',
                inspecting: 'bg-rose-900/50 text-rose-200 border border-rose-700',
                bonded_warehouse: 'bg-indigo-900/50 text-indigo-200 border border-indigo-700',
                pending_shelving: 'bg-green-900/50 text-green-200 border border-green-700',
                shelved: 'bg-emerald-900/50 text-emerald-200 border border-emerald-700'
              };

              const statusLabel = {
                pre_order: '预下订单',
                ordered: '已下单',
                in_production: '生产中',
                prod_complete: '生产完成',
                leg1_shipped: '头程发货',
                leg1_arrived: '头程到货',
                leg2_shipped: '二程发货',
                leg2_arrived: '二程到货',
                inspecting: '查验中',
                bonded_warehouse: '保税仓',
                pending_shelving: '待理货',
                shelved: '已上架'
              };

              // 过滤掉预下订单和已理货上架
              const visiblePos = sorted.filter(po => po.status !== 'pre_order' && po.status !== 'shelved');

              return (
                <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
                  {visiblePos.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 font-bold text-sm">暂无采购单</div>
                  ) : (
                    visiblePos.map((po, idx) => (
                      <div key={idx} className="flex items-center gap-4 px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-colors text-[11px]">
                        <span className="font-bold text-indigo-300 min-w-[120px]">{po.skuName}</span>
                        <span className="text-slate-400">PO: {po.poNumber}</span>
                        <span className="text-slate-400">数量: {po.qty}</span>
                        <span className="text-slate-400">下单: {po.orderDate}</span>
                        <span className="text-slate-400">到货: {po.arrivalDate}</span>
                        <span className={`px-2 py-1 rounded-lg font-bold flex-shrink-0 ${statusColor[po.status] || statusColor.pending}`}>
                          {statusLabel[po.status] || '未知'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              );
            })()}
          </div>

          <div className="flex-1 overflow-auto bg-slate-900/50 rounded-3xl border border-slate-800 p-6 shadow-inner min-h-0">
             <table className="w-full text-left border-collapse min-w-[1600px]">
                <thead>
                   <tr className="text-slate-600 text-[11px] uppercase font-black tracking-widest border-b border-slate-800/50 pb-8">
                      <th className="pb-8 pl-8 w-80 text-left">SKU 名称 / 全球 Reference</th><th className="pb-8 text-center font-black">实时库存</th><th className="pb-8 text-center font-black">断货预测日</th><th className="pb-8 bg-indigo-950/30 text-center rounded-t-[2.5rem] border-x border-indigo-900/20 shadow-xl font-black">下单决策 (T-{warningDays}D)</th>
                      {Array.from({length: 12}).map((_, i) => {
                        const d = new Date(); d.setMonth(d.getMonth() + i);
                        return <th key={i} className="pb-8 text-center w-28 text-slate-400 font-black tracking-tighter">{(d.getMonth() + 1)}月预演</th>
                      })}
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                   {dashboardData.map(sku => (
                     <tr key={sku.id} className="hover:bg-slate-800/30 transition-all group">
                        <td className="py-10 pl-8 font-black"><div className="text-2xl text-white group-hover:text-indigo-400 transition-colors uppercase tracking-tight">{sku.name}</div><div className="text-[10px] text-slate-500 mt-2 font-bold tracking-widest uppercase">Global_ID: #00{sku.id}</div></td>
                        <td className="py-10 text-center font-mono text-4xl font-black text-slate-200">{sku.currentStock?.toLocaleString()}</td>
                        <td className="py-10 text-center">{sku.firstStockOut ? <div className="text-red-500 font-black text-2xl drop-shadow-lg animate-pulse">{sku.firstStockOut.date}</div> : <div className="text-emerald-500 font-black text-2xl uppercase tracking-tighter flex items-center justify-center gap-3"><Check size={28}/> Secure</div>}</td>
                        <td className="py-10 px-6 bg-indigo-900/10 border-x border-indigo-900/20 shadow-inner">
                           {sku.firstStockOut ? (
                             <div className={`p-6 rounded-[2.5rem] border-4 shadow-2xl ${sku.urgency === 'critical' ? 'bg-red-900/40 border-red-500 animate-pulse' : 'bg-indigo-900/40 border-indigo-500'}`}>
                                <div className="text-[10px] font-black uppercase mb-2 opacity-80 text-center tracking-widest text-inherit leading-none">下单截止日</div>
                                <div className="text-2xl font-black text-center mb-4 text-inherit">{sku.orderDateStr}</div>
                                <div className="mt-2 pt-4 border-t border-white/10 flex justify-between items-center text-inherit"><span className="text-[10px] font-black opacity-60 uppercase tracking-tighter">建议补货量</span><span className="text-2xl font-mono font-black">{sku.suggestQty.toFixed(0)}</span></div>
                             </div>
                           ) : <div className="text-center text-slate-700 font-black text-[10px] uppercase tracking-[0.5em] py-10 italic">Strategic Stable</div>}
                        </td>
                        {sku.forecast.monthEndStocks.slice(0, 12).map((m, i) => (
                           <td key={i} className="py-10 text-center">
                              <div className={`w-16 h-12 mx-auto rounded-2xl flex items-center justify-center text-[11px] font-black shadow-2xl transition-all hover:scale-125 cursor-default ${m.stock <= 0 ? 'bg-red-600 text-white border-4 border-red-400 animate-pulse' : (m.status === 'low' ? 'bg-amber-500 text-white border-4 border-amber-300 shadow-amber-500/50' : 'bg-slate-800 text-slate-500 border border-slate-700 hover:bg-indigo-600 hover:text-white transition-colors')}`}>
                                 {m.stock <= 0 ? '断' : (m.stock > 9999 ? '1w+' : m.stock.toFixed(0))}
                              </div>
                           </td>
                        ))}
                     </tr>
                   ))}
                </tbody>
             </table>
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
                  onClick={() => setShowSettings(false)}
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