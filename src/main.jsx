import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  TrendingDown, Clock, Plus, AlertTriangle, BarChart3, 
  Check, X, Layout, List, RefreshCw, Save, Edit2,
  Ship, Plane, Factory, Calendar, AlertCircle, ArrowRight, Train, Trash2, Settings, LogOut, Lock, Menu, ChevronLeft, Home, Compass
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';

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
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const DEFAULT_ADMIN_EMAILS = ADMIN_EMAILS.length > 0 ? ADMIN_EMAILS : (ALLOWED_EMAILS.length > 0 ? [ALLOWED_EMAILS[0]] : []);
const ROLE_OPTIONS = ['admin', 'editor', 'viewer'];
const ALL_FEATURES = [
  { key: 'detail', label: '指挥中心' },
  { key: 'sales', label: '年度销量页' },
  { key: 'offline', label: '线下库存页' },
  { key: 'recipient-library', label: '客户信息库' },
  { key: 'approval', label: '审批中心' },
  { key: 'dashboard', label: '全景大屏' },
  { key: 'po', label: '采购单管理' },
  { key: 'sku', label: 'SKU 管理' },
];
const ALL_FEATURE_KEYS = ALL_FEATURES.map(f => f.key);

// 出库用途选项
const PURPOSE_OPTIONS = [
  { key: 'sample', label: '寄样' },
  { key: 'offline_shipping', label: '线下发货' },
  { key: 'photo', label: '拍摄领用' },
  { key: 'return', label: '退货处理' },
  { key: 'gift', label: '赠品' },
  { key: 'scrap', label: '损耗报废' },
];
const PURPOSE_KEYS = PURPOSE_OPTIONS.map(p => p.key);
const getPurposeLabel = (purpose) => PURPOSE_OPTIONS.find(p => p.key === purpose)?.label || purpose || '寄样';

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
    // 🔒 设置会话级别登录持久化：关闭浏览器标签页后需重新登录
    setPersistence(auth, browserSessionPersistence).catch(e => console.warn('⚠️ setPersistence 失败:', e.message));
    console.log('✅ Firebase Auth 初始化成功（会话级持久化）');

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

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function createEmptyYearSales(defaultForecast = 0) {
  return Array.from({ length: 12 }).map(() => ({ actual: null, forecast: defaultForecast }));
}

function normalizeSalesCell(cell, fallbackForecast = null) {
  if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
    const actualRaw = cell.actual;
    const forecastRaw = cell.forecast;
    const actualNum = (actualRaw === null || actualRaw === '' || typeof actualRaw === 'undefined') ? null : Number(actualRaw);
    const forecastNum = (forecastRaw === null || forecastRaw === '' || typeof forecastRaw === 'undefined') ? null : Number(forecastRaw);
    return {
      actual: Number.isFinite(actualNum) && actualNum >= 0 ? Math.floor(actualNum) : null,
      forecast: Number.isFinite(forecastNum) && forecastNum >= 0 ? Math.floor(forecastNum) : null,
    };
  }

  const legacyNum = Number(cell);
  const normalizedFallback = Number(fallbackForecast);
  const fallback = Number.isFinite(normalizedFallback) && normalizedFallback >= 0 ? Math.floor(normalizedFallback) : null;
  return {
    actual: null,
    forecast: Number.isFinite(legacyNum) && legacyNum >= 0 ? Math.floor(legacyNum) : fallback,
  };
}

function sanitizeOfflineInventoryItems(items) {
  const safeArr = Array.isArray(items) ? items : [];
  return safeArr
    .filter(Boolean)
    .map((item, idx) => {
      const id = Number.isFinite(Number(item.id)) ? Number(item.id) : Date.now() + idx;
      const name = String(item.name ?? `线下品项${idx + 1}`).trim();
      const currentStock = Math.max(0, Number(item.currentStock ?? 0) || 0);
      const inboundTotal = Math.max(0, Number(item.inboundTotal ?? 0) || 0);
      const outboundTotal = Math.max(0, Number(item.outboundTotal ?? 0) || 0);
      const lastOutboundAccount = String(item.lastOutboundAccount ?? '');
      const remark = String(item.remark ?? '');
      const updatedAt = String(item.updatedAt ?? '');
      return { id, name, currentStock, inboundTotal, outboundTotal, lastOutboundAccount, remark, updatedAt };
    })
    .filter(item => item.name.length > 0);
}

function sanitizeOfflineInventoryLogs(logs) {
  const safeArr = Array.isArray(logs) ? logs : [];
  return safeArr
    .filter(Boolean)
    .map((log, idx) => {
      const id = Number.isFinite(Number(log.id)) ? Number(log.id) : Date.now() + idx;
      const itemId = Number.isFinite(Number(log.itemId)) ? Number(log.itemId) : null;
      const itemName = String(log.itemName ?? '');
      const type = log.type === 'out' ? 'out' : 'in';
      const purpose = log.purpose === 'restock' ? 'restock' : (PURPOSE_KEYS.includes(log.purpose) ? log.purpose : 'sample');
      const qty = Math.max(0, Number(log.qty ?? 0) || 0);
      const account = String(log.account ?? '');
      const customerId = Number.isFinite(Number(log.customerId)) ? Number(log.customerId) : null;
      const customerName = String(log.customerName ?? '');
      const customerPlatform = String(log.customerPlatform ?? '');
      const customerIdentity = String(log.customerIdentity ?? '');
      const customerPhone = String(log.customerPhone ?? '');
      const profileId = Number.isFinite(Number(log.profileId)) ? Number(log.profileId) : null;
      const profileLabel = String(log.profileLabel ?? '');
      const profileReceiver = String(log.profileReceiver ?? '');
      const profilePhone = String(log.profilePhone ?? '');
      const profileAddress = String(log.profileAddress ?? '');
      const trackingNo = String(log.trackingNo ?? '');
      const remark = String(log.remark ?? '');
      const operator = String(log.operator ?? '');
      const happenedAt = String(log.happenedAt ?? new Date().toISOString());
      return { id, itemId, itemName, type, purpose, qty, account, customerId, customerName, customerPlatform, customerIdentity, customerPhone, profileId, profileLabel, profileReceiver, profilePhone, profileAddress, trackingNo, remark, operator, happenedAt };
    })
    .filter(log => log.itemName && log.qty > 0);
}

function sanitizeRecipientDirectory(customers) {
  const safeArr = Array.isArray(customers) ? customers : [];

  const pickFirstText = (...values) => {
    for (const value of values) {
      const normalized = String(value ?? '').trim();
      if (normalized) return normalized;
    }
    return '';
  };

  return safeArr
    .filter(Boolean)
    .map((customer, idx) => {
      const customerId = Number.isFinite(Number(customer.id)) ? Number(customer.id) : Date.now() + idx;
      const customerPlatform = String(customer.platform ?? '').trim();
      const customerName = String(customer.name ?? `客户${idx + 1}`).trim();
      const customerIdentity = String(customer.identity ?? '').trim();
      const customerPhone = String(customer.phone ?? '').trim();
      const customerRemark = String(customer.remark ?? '').trim();
      const rawProfiles = Array.isArray(customer.profiles) ? customer.profiles : [];
      const profiles = rawProfiles
        .filter(Boolean)
        .map((profile, pIdx) => {
          const profileId = Number.isFinite(Number(profile.id)) ? Number(profile.id) : Date.now() + idx * 100 + pIdx;
          const label = pickFirstText(profile.label, profile.name, profile.tag, `地址${pIdx + 1}`);
          const receiver = pickFirstText(profile.receiver, profile.receiverName, profile.consignee, profile.contact, profile.contactName);
          const phone = pickFirstText(profile.phone, profile.mobile, profile.tel, profile.phoneNo, profile.contactPhone);
          const address = pickFirstText(profile.address, profile.fullAddress, profile.detailAddress, profile.addr);
          const remark = String(profile.remark ?? '').trim();
          const isDefault = Boolean(profile.isDefault);
          return { id: profileId, label, receiver, phone, address, remark, isDefault };
        })
        .filter(profile => profile.label || profile.address || profile.receiver || profile.phone);

      const legacyCustomerAddress = pickFirstText(customer.address, customer.fullAddress, customer.detailAddress, customer.addr);
      const legacyCustomerReceiver = pickFirstText(customer.receiver, customer.receiverName, customer.consignee, customer.contact, customer.contactName, customer.name);
      const legacyCustomerPhone = pickFirstText(customer.phone, customer.mobile, customer.tel, customer.phoneNo, customer.contactPhone);
      const legacyCustomerLabel = pickFirstText(customer.profileLabel, customer.label, '默认地址');
      const legacyCustomerRemark = pickFirstText(customer.profileRemark, customer.addressRemark, customer.remark);

      const withLegacyProfile = (profiles.length === 0 && (legacyCustomerAddress || legacyCustomerReceiver || legacyCustomerPhone))
        ? [{
            id: Date.now() + idx * 1000,
            label: legacyCustomerLabel,
            receiver: legacyCustomerReceiver,
            phone: legacyCustomerPhone,
            address: legacyCustomerAddress,
            remark: legacyCustomerRemark,
            isDefault: true,
          }]
        : profiles;

      const hasDefault = withLegacyProfile.some(profile => profile.isDefault);
      const normalizedProfiles = withLegacyProfile.map((profile, pIdx) => ({
        ...profile,
        isDefault: hasDefault ? profile.isDefault : pIdx === 0,
      }));

      return {
        id: customerId,
        platform: customerPlatform,
        name: customerName,
        identity: customerIdentity,
        phone: customerPhone,
        remark: customerRemark,
        profiles: normalizedProfiles,
      };
    })
    .filter(customer => customer.name.length > 0);
}

function sanitizeDeleteApprovals(approvals) {
  const safeArr = Array.isArray(approvals) ? approvals : [];
  const allowedStatus = ['pending', 'approved', 'rejected'];
  const allowedType = ['sku', 'offline_sku', 'po', 'customer_edit', 'customer_delete', 'profile_delete'];
  const RETENTION_DAYS = 90;
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  return safeArr
    .filter(Boolean)
    .map((item, idx) => {
      const id = Number.isFinite(Number(item.id)) ? Number(item.id) : Date.now() + idx;
      const status = allowedStatus.includes(item.status) ? item.status : 'pending';
      const actionType = allowedType.includes(item.actionType) ? item.actionType : 'sku';
      const entityName = String(item.entityName ?? '');
      const payload = (item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)) ? item.payload : {};
      const requestedBy = String(item.requestedBy ?? '');
      const requestedAt = String(item.requestedAt ?? new Date().toISOString());
      const reviewedBy = String(item.reviewedBy ?? '');
      const reviewedAt = String(item.reviewedAt ?? '');
      return { id, status, actionType, entityName, payload, requestedBy, requestedAt, reviewedBy, reviewedAt };
    })
    // 清理已完成超过 90 天的审批记录，防止无限增长
    .filter(item => {
      if (item.status === 'pending') return true;
      const ts = new Date(item.reviewedAt || item.requestedAt).getTime();
      return ts > cutoff;
    })
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

function sanitizeSkus(items) {
  const safeArr = Array.isArray(items) ? items : [];
  const currentYear = String(new Date().getFullYear());
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

      const salesByYearRaw = (sku.salesByYear && typeof sku.salesByYear === 'object' && !Array.isArray(sku.salesByYear)) ? sku.salesByYear : {};
      const salesByYear = {};
      Object.keys(salesByYearRaw).forEach((yearKey) => {
        const yearArr = Array.isArray(salesByYearRaw[yearKey]) ? salesByYearRaw[yearKey] : [];
        salesByYear[String(yearKey)] = Array.from({ length: 12 }).map((_, i) => normalizeSalesCell(yearArr[i]));
      });

      if (!salesByYear[currentYear]) {
        salesByYear[currentYear] = Array.from({ length: 12 }).map((_, i) => normalizeSalesCell(undefined, monthlySales[i] ?? 0));
      }

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
      return { id, name, currentStock, unitCost, monthlySales, salesByYear, pos };
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
  const [viewMode, setViewMode] = useState('home'); 
  const [salesSelectedYear, setSalesSelectedYear] = useState(new Date().getFullYear());
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
  const [offlineInventoryItems, setOfflineInventoryItems] = useState([]);
  const [offlineInventoryLogs, setOfflineInventoryLogs] = useState([]);
  const [offlineRecipientDirectory, setOfflineRecipientDirectory] = useState([]);
  const [offlineItemName, setOfflineItemName] = useState('');
  const [offlineItemStock, setOfflineItemStock] = useState('');
  const [offlineItemRemark, setOfflineItemRemark] = useState('');
  const [offlineCustomerPlatform, setOfflineCustomerPlatform] = useState('');
  const [offlineCustomerName, setOfflineCustomerName] = useState('');
  const [offlineCustomerIdentity, setOfflineCustomerIdentity] = useState('');
  const [offlineCustomerPhone, setOfflineCustomerPhone] = useState('');
  const [offlineCustomerRemark, setOfflineCustomerRemark] = useState('');
  const [offlineRecipientQuery, setOfflineRecipientQuery] = useState('');
  const [offlineSelectedCustomerId, setOfflineSelectedCustomerId] = useState('');
  const [editingCustomerModal, setEditingCustomerModal] = useState(null);
  const [offlineProfileLabel, setOfflineProfileLabel] = useState('');
  const [offlineProfileReceiver, setOfflineProfileReceiver] = useState('');
  const [offlineProfilePhone, setOfflineProfilePhone] = useState('');
  const [offlineProfileAddress, setOfflineProfileAddress] = useState('');
  const [offlineProfileRemark, setOfflineProfileRemark] = useState('');
  const [offlineEditingProfileId, setOfflineEditingProfileId] = useState('');
  const [offlineTxItemId, setOfflineTxItemId] = useState('');
  const [offlineTxType, setOfflineTxType] = useState('in');
  const [offlineTxPurpose, setOfflineTxPurpose] = useState('sample');
  const [offlineTxQty, setOfflineTxQty] = useState('');
  const [offlineTxRemark, setOfflineTxRemark] = useState('');
  const [offlineTxCustomerId, setOfflineTxCustomerId] = useState('');
  const [offlineTxProfileId, setOfflineTxProfileId] = useState('');
  const [offlineTxTrackingNo, setOfflineTxTrackingNo] = useState('');
  const [offlineSelectedItemId, setOfflineSelectedItemId] = useState(null);
  const [offlineOverviewQuery, setOfflineOverviewQuery] = useState('');
  const [deleteApprovals, setDeleteApprovals] = useState([]);
  const [userRoles, setUserRoles] = useState({});
  const [roleTargetEmail, setRoleTargetEmail] = useState('');
  const [roleTargetValue, setRoleTargetValue] = useState('viewer');
  const [poSortBy, setPoSortBy] = useState('orderDate'); // 'orderDate' 或 'arrivalDate'
  const [poOverviewFilter, setPoOverviewFilter] = useState('all'); // 'all' | 'followup'
  const [expandedPoId, setExpandedPoId] = useState(null); // 展开的采购单ID
  const [poFilter, setPoFilter] = useState('all'); // 'all', 'pending', 'completed'
  const [dashboardTheme, setDashboardTheme] = useState('dark'); // 'dark' 或 'light'
  const [sideMenuOpen, setSideMenuOpen] = useState(false); // 侧边抽屉菜单
  const [draggedSkuId, setDraggedSkuId] = useState(null); // 正在拖拽的 SKU ID
  const [poViewMode, setPoViewMode] = useState('card'); // 'card' 或 'table'
  const [expandedPoGroups, setExpandedPoGroups] = useState({ pending: true, completed: false }); // 按状态分组的展开/收起
  const [editingOfflineLog, setEditingOfflineLog] = useState(null); // 正在编辑的出库记录

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
  const hasPendingChangesRef = useRef(false);
  const hasPendingSettingsRef = useRef(false);
  // 🔒 核心防护：只有成功接收过云端数据后才允许写回云端
  const cloudDataLoadedRef = useRef(false);
  // 🔒 跟踪云端数据规模，防止少量数据覆盖大量数据
  const remoteSkuCountRef = useRef(0);
  // 备份状态
  const [lastBackupInfo, setLastBackupInfo] = useState(null);
  const lastBackupSkuCountRef = useRef(0);
  // 🛡️ 安全备份（仅在数据量健康时更新的"保险箱"备份）
  const lastSafeBackupCountRef = useRef(0);
  const [lastSafeBackupInfo, setLastSafeBackupInfo] = useState(null);

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

  const currentUserEmail = (user?.email || '').toLowerCase();
  const { currentUserRole, currentUserFeatures } = useMemo(() => {
    if (!currentUserEmail) return { currentUserRole: 'viewer', currentUserFeatures: [] };
    if (DEFAULT_ADMIN_EMAILS.includes(currentUserEmail)) return { currentUserRole: 'admin', currentUserFeatures: ALL_FEATURE_KEYS };
    const mapped = userRoles[currentUserEmail];
    // 兼容旧格式 string 和新格式 { role, features }
    if (typeof mapped === 'string') {
      if (ROLE_OPTIONS.includes(mapped)) return { currentUserRole: mapped, currentUserFeatures: ALL_FEATURE_KEYS };
    } else if (mapped && typeof mapped === 'object') {
      const role = ROLE_OPTIONS.includes(mapped.role) ? mapped.role : 'editor';
      const features = Array.isArray(mapped.features) ? mapped.features.filter(f => ALL_FEATURE_KEYS.includes(f)) : ALL_FEATURE_KEYS;
      return { currentUserRole: role, currentUserFeatures: features };
    }
    return { currentUserRole: 'viewer', currentUserFeatures: [] };
  }, [currentUserEmail, userRoles]);

  const hasFeature = (featureKey) => currentUserRole === 'admin' || currentUserFeatures.includes(featureKey);

  const canEditData = currentUserRole === 'admin' || currentUserRole === 'editor';
  const canManagePermissions = currentUserRole === 'admin';
  const canApproveDeletion = currentUserRole === 'admin';

  const ensureEditPermission = () => {
    if (canEditData) return true;
    setWarning('当前账号为只读权限，无法修改数据');
    return false;
  };

  // 生成 PO 号的函数
  const generatePONumber = (skuId) => {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    // 搜索所有 SKU 的 PO，找到今天最大的序号，避免跨 SKU 或删除后编号重复
    let maxSeq = 0;
    for (const s of skus) {
      if (!s.pos) continue;
      for (const p of s.pos) {
        if (!p.poNumber) continue;
        const parts = String(p.poNumber).split('-');
        if (parts[1] === today) {
          const seq = parseInt(parts[2], 10);
          if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
        }
      }
    }
    return `PO-${today}-${String(maxSeq + 1).padStart(3, '0')}`;
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
      
      if (err.code === 'auth/invalid-credential') {
        setLoginError('❌ 账号不存在或密码错误，请检查后重试');
      } else if (err.code === 'auth/user-not-found') {
        setLoginError('❌ 该邮箱未注册，请联系管理员');
      } else if (err.code === 'auth/wrong-password') {
        setLoginError('❌ 密码错误');
      } else if (err.code === 'auth/invalid-email') {
        setLoginError('❌ 邮箱格式不正确');
      } else if (err.code === 'auth/user-disabled') {
        setLoginError('❌ 该账号已被禁用，请联系管理员');
      } else if (err.code === 'auth/too-many-requests') {
        setLoginError('❌ 登录尝试次数过多，请稍后再试');
      } else {
        setLoginError(`❌ 登录失败: ${err.message}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 🔄 自动备份：将当前数据写入 Firestore 独立备份文档
  const saveBackupToCloud = async (trigger = 'manual') => {
    if (!db || !user) { console.warn('⚠️ 备份跳过：未连接云端'); return false; }
    if (skus.length === 0) { console.warn('⚠️ 备份跳过：数据为空'); return false; }
    try {
      const backupDocRef = doc(db, 'inventory_apps', appId, 'shared', 'backup');

      // 🔒 防空机制：首次调用时从 Firestore 初始化备份基准，之后用本地 ref 跟踪（省 Firestore 读取）
      if (lastBackupSkuCountRef.current === 0) {
        try {
          const existingBackup = await getDoc(backupDocRef);
          if (existingBackup.exists()) {
            lastBackupSkuCountRef.current = existingBackup.data()?._backup_meta?.skuCount || 0;
            console.log('💾 备份基准初始化:', lastBackupSkuCountRef.current, 'SKUs');
          }
        } catch (readErr) {
          console.warn('⚠️ 读取旧备份基准失败:', readErr.message);
        }
      }
      if (trigger === 'auto') {
        if (lastBackupSkuCountRef.current > 5 && skus.length < lastBackupSkuCountRef.current * 0.5) {
          console.error('🚨 备份防空拦截：当前 SKU(' + skus.length + ') 远少于备份基准(' + lastBackupSkuCountRef.current + ')，拒绝自动覆盖备份');
          return false;
        }
      } else if (trigger === 'manual') {
        if (lastBackupSkuCountRef.current > 5 && skus.length < lastBackupSkuCountRef.current * 0.5) {
          const ok = window.confirm(
            '⚠️ 安全警告！\n\n当前 SKU 数量(' + skus.length + ') 远少于备份基准(' + lastBackupSkuCountRef.current + ')。\n\n覆盖备份可能导致数据永久丢失！确定要继续吗？'
          );
          if (!ok) return false;
        }
      }
      const clean = (obj) => {
        if (Array.isArray(obj)) return obj.map(clean);
        if (obj !== null && typeof obj === 'object') {
          return Object.fromEntries(
            Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)])
          );
        }
        return obj;
      };
      const backupPayload = {
        items: clean(skus),
        offlineInventoryItems: clean(offlineInventoryItems),
        offlineInventoryLogs: clean(offlineInventoryLogs),
        offlineRecipientDirectory: clean(offlineRecipientDirectory),
        deleteApprovals: clean(deleteApprovals),
        warningDays,
        defaultSettings,
        transportModes,
        userRoles,
        _backup_meta: {
          trigger,
          userEmail: user.email || '未知',
          timestamp: new Date().toISOString(),
          skuCount: skus.length,
          offlineItemCount: offlineInventoryItems.length,
          logCount: offlineInventoryLogs.length,
          approvalCount: deleteApprovals.length,
        },
      };
      await setDoc(backupDocRef, backupPayload);
      lastBackupSkuCountRef.current = skus.length;
      const info = `${new Date().toLocaleString('zh-CN')} (${trigger === 'auto' ? '自动' : trigger === 'login' ? '上线' : trigger === 'logout' ? '下线' : '手动'}) by ${user.email}`;
      setLastBackupInfo(info);
      console.log('💾 备份成功:', info, '| SKU:', skus.length, '| 线下品项:', offlineInventoryItems.length, '| 日志:', offlineInventoryLogs.length);

      // --- 🛡️ 安全备份（backup_safe）：仅在数据量健康时更新 ---
      const backupSafeDocRef = doc(db, 'inventory_apps', appId, 'shared', 'backup_safe');
      // 首次运行时从 Firestore 读取安全备份基准值
      if (lastSafeBackupCountRef.current === 0) {
        try {
          const existingSafe = await getDoc(backupSafeDocRef);
          if (existingSafe.exists()) {
            const safeMeta = existingSafe.data()?._backup_meta;
            lastSafeBackupCountRef.current = safeMeta?.skuCount || 0;
            const safeTs = safeMeta?.timestamp || '未知';
            setLastSafeBackupInfo(`${safeTs} | SKU: ${lastSafeBackupCountRef.current}`);
            console.log('🛡️ 安全备份基准初始化:', lastSafeBackupCountRef.current, 'SKUs');
          }
        } catch (e) { console.warn('⚠️ 读取安全备份基准失败:', e.message); }
      }
      // 安全备份仅在数据量 >= 上次的 80% 或首次时写入
      const shouldUpdateSafe = lastSafeBackupCountRef.current === 0 || skus.length >= lastSafeBackupCountRef.current * 0.8;
      if (shouldUpdateSafe) {
        try {
          const safePayload = { ...backupPayload, _backup_meta: { ...backupPayload._backup_meta, type: 'safe' } };
          await setDoc(backupSafeDocRef, safePayload);
          lastSafeBackupCountRef.current = skus.length;
          const safeInfo = `${new Date().toLocaleString('zh-CN')} | SKU: ${skus.length}`;
          setLastSafeBackupInfo(safeInfo);
          console.log('🛡️ 安全备份已更新:', safeInfo);
        } catch (safeErr) {
          console.warn('⚠️ 安全备份写入失败:', safeErr.message);
        }
      } else {
        console.log('🛡️ 安全备份保持冻结（当前SKU:' + skus.length + ' < 安全基准:' + lastSafeBackupCountRef.current + ' × 80%）');
      }

      return true;
    } catch (err) {
      console.error('❌ 自动备份失败:', err.message);
      return false;
    }
  };

  // 🔄 从云端备份恢复（支持选择常规备份或安全备份）
  const restoreFromCloudBackup = async (source = 'choose') => {
    if (!canManagePermissions) { window.alert('❌ 仅管理员可执行数据恢复'); return; }
    if (!db || !user) { window.alert('❌ 未连接云端'); return; }
    try {
      const backupDocRef = doc(db, 'inventory_apps', appId, 'shared', 'backup');
      const backupSafeDocRef = doc(db, 'inventory_apps', appId, 'shared', 'backup_safe');
      // 并行读取两份备份
      const [backupSnap, safeSnap] = await Promise.all([getDoc(backupDocRef), getDoc(backupSafeDocRef)]);
      const hasBackup = backupSnap.exists() && ((backupSnap.data()?.items?.length || 0) > 0);
      const hasSafe = safeSnap.exists() && ((safeSnap.data()?.items?.length || 0) > 0);

      if (!hasBackup && !hasSafe) {
        window.alert('❌ 云端没有找到任何备份数据');
        return;
      }

      const fmtMeta = (meta) => `📅 ${meta?.timestamp || '未知'}  👤 ${meta?.userEmail || '未知'}\n📊 SKU: ${meta?.skuCount || '?'}  线下: ${meta?.offlineItemCount || '?'}  日志: ${meta?.logCount || '?'}`;

      let chosenData;
      if (source === 'safe') {
        if (!hasSafe) { window.alert('❌ 没有安全备份'); return; }
        const safeMeta = safeSnap.data()._backup_meta || {};
        if (!window.confirm('🛡️ 从安全备份恢复：\n\n' + fmtMeta(safeMeta) + '\n\n确定恢复吗？')) return;
        chosenData = safeSnap.data();
      } else if (source === 'latest') {
        if (!hasBackup) { window.alert('❌ 没有常规备份'); return; }
        const meta = backupSnap.data()._backup_meta || {};
        if (!window.confirm('📥 从最新备份恢复：\n\n' + fmtMeta(meta) + '\n\n确定恢复吗？')) return;
        chosenData = backupSnap.data();
      } else {
        // 让用户选择
        const backupMeta = hasBackup ? (backupSnap.data()._backup_meta || {}) : null;
        const safeMeta = hasSafe ? (safeSnap.data()._backup_meta || {}) : null;
        let msg = '选择要恢复的备份：\n\n';
        if (hasBackup) msg += '【1】最新备份\n' + fmtMeta(backupMeta) + '\n\n';
        if (hasSafe) msg += '【2】🛡️ 安全备份（数据量最稳定的版本）\n' + fmtMeta(safeMeta) + '\n\n';
        if (hasBackup && hasSafe) {
          const choice = window.prompt(msg + '输入 1 或 2 选择：');
          if (choice === '2') chosenData = safeSnap.data();
          else if (choice === '1') chosenData = backupSnap.data();
          else { if (choice !== null) window.alert('无效选择'); return; }
        } else {
          chosenData = hasBackup ? backupSnap.data() : safeSnap.data();
          const meta = chosenData._backup_meta || {};
          if (!window.confirm('找到云端备份：\n\n' + fmtMeta(meta) + '\n\n确定恢复吗？')) return;
        }
      }

      if (!chosenData) return;
      const jsonForRestore = JSON.stringify({
        skus: chosenData.items || [],
        offlineInventoryItems: chosenData.offlineInventoryItems || [],
        offlineInventoryLogs: chosenData.offlineInventoryLogs || [],
        offlineRecipientDirectory: chosenData.offlineRecipientDirectory || [],
        deleteApprovals: chosenData.deleteApprovals || [],
        warningDays: chosenData.warningDays,
        defaultSettings: chosenData.defaultSettings,
        transportModes: chosenData.transportModes,
        userRoles: chosenData.userRoles,
      });
      await restoreFromBackup(jsonForRestore);
    } catch (err) {
      console.error('❌ 从云端备份恢复失败:', err);
      window.alert('❌ 从云端备份恢复失败: ' + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      console.log('✅ 登出成功');
      // 🔒 完全重置所有数据状态和同步标记，防止下一个用户登录时旧数据覆盖云端
      setSkus([]);
      setSelectedSkuId(null);
      setOfflineInventoryItems([]);
      setOfflineInventoryLogs([]);
      setOfflineRecipientDirectory([]);
      setDeleteApprovals([]);
      setIsInitialLoadDone(false);
      cloudDataLoadedRef.current = false;
      hasPendingChangesRef.current = false;
      hasPendingSettingsRef.current = false;
      lastRemoteItemsJSONRef.current = '';
      remoteSkuCountRef.current = 0;
      hydratedRef.current = false; // 允许重新初始化本地数据
      setLoginEmail('');
      setLoginPassword('');
      setLoginError('');
      setLastBackupInfo(null);
      setLastSafeBackupInfo(null);
      lastBackupSkuCountRef.current = 0;
      lastSafeBackupCountRef.current = 0;
    } catch (err) {
      console.error('❌ 登出失败:', err.message);
      setLoginError('登出失败，请重试');
    }
  };

  // --- 3.0 本地数据初始化（仅一次） ---

  // 🔧 管理员专用：从备份 JSON 恢复数据到云端
  const isRestoringRef = useRef(false);
  const restoreFromBackup = async (jsonText) => {
    if (!canManagePermissions) { window.alert('❌ 仅管理员可执行数据恢复'); return; }
    if (!db || !user) { window.alert('❌ 未连接云端，无法恢复'); return; }
    if (isRestoringRef.current) { window.alert('⏳ 恢复正在进行中，请稍候'); return; }

    try {
      isRestoringRef.current = true;
      console.log('🔄 开始恢复数据... 输入长度:', jsonText.length);

      // -------- 1. 解析 JSON --------
      let data;
      try {
        data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
      } catch (parseErr) {
        window.alert('❌ JSON 解析失败，请检查粘贴的内容是否完整。\n\n错误：' + parseErr.message);
        isRestoringRef.current = false;
        return;
      }

      // 兼容两种格式：localStorage 格式 (skus) 和 Firestore 格式 (items)
      const rawSkus = data.skus || data.items || [];
      if (!Array.isArray(rawSkus) || rawSkus.length === 0) {
        window.alert('❌ 备份数据无效：找不到 skus/items 数组，或数组为空。\n\n检测到的顶级字段: ' + Object.keys(data).join(', '));
        isRestoringRef.current = false;
        return;
      }

      console.log('📋 解析成功，顶级字段:', Object.keys(data).join(', '));

      // -------- 2. 清洗数据 --------
      const restoredSkus = sanitizeSkus(rawSkus);
      const restoredOfflineItems = sanitizeOfflineInventoryItems(data.offlineInventoryItems || []);
      const restoredOfflineLogs = sanitizeOfflineInventoryLogs(data.offlineInventoryLogs || []);
      const restoredRecipientDir = sanitizeRecipientDirectory(data.offlineRecipientDirectory || []);
      const restoredApprovals = sanitizeDeleteApprovals(data.deleteApprovals || []);

      console.log('📋 清洗完毕:', restoredSkus.length, 'SKU,', restoredOfflineItems.length, '线下品项,', restoredOfflineLogs.length, '日志,', restoredApprovals.length, '审批');

      // -------- 3. 先写入云端（防止 onSnapshot 竞争） --------
      // 锁住：阻止 onSnapshot 和自动保存 effect 干扰
      hasPendingChangesRef.current = true;
      hasPendingSettingsRef.current = true;

      const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');

      // 递归清除 undefined（Firestore 不支持）
      const clean = (obj) => {
        if (Array.isArray(obj)) return obj.map(clean);
        if (obj !== null && typeof obj === 'object') {
          return Object.fromEntries(
            Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)])
          );
        }
        return obj;
      };

      const payload = {
        items: clean(restoredSkus),
        offlineInventoryItems: clean(restoredOfflineItems),
        offlineInventoryLogs: clean(restoredOfflineLogs),
        offlineRecipientDirectory: clean(restoredRecipientDir),
        deleteApprovals: clean(restoredApprovals),
        warningDays: data.warningDays || warningDays,
        defaultSettings: data.defaultSettings || defaultSettings,
        transportModes: data.transportModes || transportModes,
        userRoles: data.userRoles || userRoles,
        lastUpdated: new Date().toISOString(),
      };

      console.log('🚀 正在写入 Firestore...', 'inventory_apps/' + appId + '/shared/main');

      // 在写入前先更新快照引用，防止 onSnapshot 竞争覆盖
      const snapshotJSON = JSON.stringify({
        items: sanitizeSkus(payload.items),
        offlineInventoryItems: sanitizeOfflineInventoryItems(payload.offlineInventoryItems),
        offlineInventoryLogs: sanitizeOfflineInventoryLogs(payload.offlineInventoryLogs),
        offlineRecipientDirectory: sanitizeRecipientDirectory(payload.offlineRecipientDirectory),
        deleteApprovals: sanitizeDeleteApprovals(payload.deleteApprovals),
      });
      lastRemoteItemsJSONRef.current = snapshotJSON;

      await setDoc(docRef, payload, { merge: true });

      console.log('✅ Firestore 写入成功！');

      // -------- 4. 更新 React 状态 --------
      setSkus(restoredSkus);
      setOfflineInventoryItems(restoredOfflineItems);
      setOfflineInventoryLogs(restoredOfflineLogs);
      setOfflineRecipientDirectory(restoredRecipientDir);
      setDeleteApprovals(restoredApprovals);
      if (data.warningDays) setWarningDays(data.warningDays);
      if (data.defaultSettings) setDefaultSettings(data.defaultSettings);
      if (data.transportModes) setTransportModes(data.transportModes);
      if (data.userRoles && typeof data.userRoles === 'object') setUserRoles(data.userRoles);
      setSelectedSkuId(restoredSkus[0]?.id ?? 1);

      // -------- 5. 标记完成 --------
      cloudDataLoadedRef.current = true;
      // 更新所有计数基准为恢复后的数据量，避免安全检查误拦截后续操作
      remoteSkuCountRef.current = restoredSkus.length;
      lastBackupSkuCountRef.current = restoredSkus.length;
      lastSafeBackupCountRef.current = restoredSkus.length;
      lastBackupJSONRef.current = ''; // 触发恢复后的自动备份
      // 延迟解锁，确保 React 渲染完毕后自动保存不会立即触发冲突
      setTimeout(() => {
        hasPendingChangesRef.current = false;
        hasPendingSettingsRef.current = false;
        isRestoringRef.current = false;
      }, 3000);

      const msg = `✅ 数据恢复成功！\n\n${restoredSkus.length} 个 SKU\n${restoredOfflineItems.length} 个线下品项\n${restoredOfflineLogs.length} 条出入库记录\n${restoredApprovals.length} 条审批记录\n\n数据已同步到云端。`;
      console.log(msg);
      setWarning(msg.replace(/\n/g, ' '));
      window.alert(msg);
    } catch (err) {
      console.error('❌ 数据恢复失败:', err);
      isRestoringRef.current = false;
      hasPendingChangesRef.current = false;
      hasPendingSettingsRef.current = false;
      const errMsg = '❌ 数据恢复失败!\n\n错误信息: ' + err.message + '\n错误码: ' + (err.code || '无');
      setWarning(errMsg.replace(/\n/g, ' '));
      window.alert(errMsg);
    }
  };

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
      if (['home', 'detail', 'dashboard', 'sales', 'offline', 'recipient-library', 'approval'].includes(local.viewMode)) { /* 不再恢复 viewMode，始终从首页开始 */ }
      // 加载本地设置
      if (local.warningDays) setWarningDays(local.warningDays);
      if (local.defaultSettings) setDefaultSettings(local.defaultSettings);
      if (local.transportModes) setTransportModes(local.transportModes);
      if (local.userRoles && typeof local.userRoles === 'object') setUserRoles(local.userRoles);
      if (Array.isArray(local.offlineInventoryItems)) setOfflineInventoryItems(sanitizeOfflineInventoryItems(local.offlineInventoryItems));
      if (Array.isArray(local.offlineInventoryLogs)) setOfflineInventoryLogs(sanitizeOfflineInventoryLogs(local.offlineInventoryLogs));
      if (Array.isArray(local.offlineRecipientDirectory)) setOfflineRecipientDirectory(sanitizeRecipientDirectory(local.offlineRecipientDirectory));
      if (Array.isArray(local.deleteApprovals)) setDeleteApprovals(sanitizeDeleteApprovals(local.deleteApprovals));
      console.log('✅ 从本地恢复成功');
    } else {
      const initialData = sanitizeSkus(DEFAULT_DATA);
      setSkus(initialData);
      setSelectedSkuId(initialData[0]?.id ?? 1);
      setViewMode('home');
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

          // 🔒 云端文档存在但 items 为空：视为异常，尝试从备份恢复
          if (remoteData.length === 0) {
            console.warn('⚠️ 云端文档存在但 items 为空，视为异常，尝试从备份恢复...');
            const tryRestoreEmpty = async () => {
              const backupsToTry = [
                { path: 'backup', label: '常规备份' },
                { path: 'backup_safe', label: '安全备份' },
              ];
              for (const { path, label } of backupsToTry) {
                try {
                  const bRef = doc(db, 'inventory_apps', appId, 'shared', path);
                  const bSnap = await getDoc(bRef);
                  if (bSnap.exists()) {
                    const bd = bSnap.data();
                    const bItems = sanitizeSkus(bd.items || []);
                    if (bItems.length > 0) {
                      console.log('🔄 云端 items 为空，从' + label + '恢复中... SKU:', bItems.length);
                      const bOfflineItems = sanitizeOfflineInventoryItems(bd.offlineInventoryItems || []);
                      const bOfflineLogs = sanitizeOfflineInventoryLogs(bd.offlineInventoryLogs || []);
                      const bRecipientDir = sanitizeRecipientDirectory(bd.offlineRecipientDirectory || []);
                      const bApprovals = sanitizeDeleteApprovals(bd.deleteApprovals || []);
                      const clean = (o) => { if (Array.isArray(o)) return o.map(clean); if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined).map(([k,v])=>[k,clean(v)])); return o; };
                      await setDoc(docRef, { items: clean(bItems), offlineInventoryItems: clean(bOfflineItems), offlineInventoryLogs: clean(bOfflineLogs), offlineRecipientDirectory: clean(bRecipientDir), deleteApprovals: clean(bApprovals), warningDays: bd.warningDays || warningDays, defaultSettings: bd.defaultSettings || defaultSettings, transportModes: bd.transportModes || transportModes, userRoles: bd.userRoles || userRoles, lastUpdated: new Date().toISOString() }, { merge: true });
                      setWarning('⚠️ 云端数据异常清空，已从' + label + '自动恢复（' + bItems.length + ' 个SKU）');
                      // onSnapshot 会再次触发并加载恢复后的数据
                      return true;
                    }
                  }
                } catch (e) {
                  console.warn('⚠️ 从' + label + '恢复失败:', e.message);
                }
              }
              return false;
            };
            tryRestoreEmpty();
            // 不设置 cloudDataLoadedRef，阻止空数据写回云端
            setIsInitialLoadDone(true);
            return;
          }

          const remoteOfflineItems = sanitizeOfflineInventoryItems(docSnap.data().offlineInventoryItems || []);
          const remoteOfflineLogs = sanitizeOfflineInventoryLogs(docSnap.data().offlineInventoryLogs || []);
          const remoteRecipientDirectory = sanitizeRecipientDirectory(docSnap.data().offlineRecipientDirectory || []);
          const remoteDeleteApprovals = sanitizeDeleteApprovals(docSnap.data().deleteApprovals || []);
          const remoteJSON = JSON.stringify({
            items: remoteData,
            offlineInventoryItems: remoteOfflineItems,
            offlineInventoryLogs: remoteOfflineLogs,
            offlineRecipientDirectory: remoteRecipientDirectory,
            deleteApprovals: remoteDeleteApprovals,
          });
          
          // 防竞态：如果本地有待发送的更改，不要用远程数据覆盖
          if (!hasPendingChangesRef.current) {
            // 仅当远程数据确实更新了才覆盖本地
            if (remoteJSON !== lastRemoteItemsJSONRef.current) {
              setSkus(remoteData);
              setOfflineInventoryItems(remoteOfflineItems);
              setOfflineInventoryLogs(remoteOfflineLogs);
              setOfflineRecipientDirectory(remoteRecipientDirectory);
              setDeleteApprovals(remoteDeleteApprovals);
              lastRemoteItemsJSONRef.current = remoteJSON;
              console.log('📥 从云端拉取新数据');
            }
          } else {
            // 有待同步更改，只记录远程版本，待同步完成后再检查
            lastRemoteItemsJSONRef.current = remoteJSON;
            console.log('⏸️ 本地有待同步更改，跳过远程数据导入');
          }
          // 🔒 标记：已成功接收到云端数据，后续才允许云端写入
          cloudDataLoadedRef.current = true;
          // 直接跟踪云端实际数量（而非峻值），避免正常删除后安全检查永久拦截
          remoteSkuCountRef.current = remoteData.length;
          console.log('🔒 cloudDataLoadedRef = true，允许云端写入，云端 SKU 数:', remoteData.length);
          // 加载云端设置
          if (!hasPendingSettingsRef.current) {
            if (docSnap.data().warningDays) setWarningDays(docSnap.data().warningDays);
            if (docSnap.data().defaultSettings) setDefaultSettings(docSnap.data().defaultSettings);
            if (docSnap.data().transportModes) setTransportModes(docSnap.data().transportModes);
            if (docSnap.data().userRoles && typeof docSnap.data().userRoles === 'object') {
              const remoteRoles = docSnap.data().userRoles;
              // 自动将 ALLOWED_EMAILS 中未注册的用户补充到 userRoles
              const merged = { ...remoteRoles };
              ALLOWED_EMAILS.forEach(e => {
                if (!merged[e]) merged[e] = { role: DEFAULT_ADMIN_EMAILS.includes(e) ? 'admin' : 'editor', features: DEFAULT_ADMIN_EMAILS.includes(e) ? [...ALL_FEATURE_KEYS] : [] };
              });
              // 确保当前登录用户也在列表中
              const curEmail = (user?.email || '').toLowerCase();
              if (curEmail && !merged[curEmail]) merged[curEmail] = { role: 'editor', features: [] };
              setUserRoles(merged);
            }
          } else {
            console.log('⏸️ 本地有待同步的设置更改，跳过远程设置导入');
          }
          if (remoteData.length > 0) {
            setSelectedSkuId(prev => (prev && remoteData.some(s => s.id === prev)) ? prev : remoteData[0].id);
          }
        } else {
          // 🔒 云端文档不存在：可能是真新项目，也可能是 Firestore 异常
          // 安全策略：先尝试从备份恢复，否则仅加载本地数据但不写入云端
          console.warn('⚠️ 云端文档不存在 (docSnap.exists() === false)');
          console.warn('⚠️ 当前用户:', user?.email);
          
          const tryRestoreFromBackup = async () => {
            // 依次尝试：常规备份 → 安全备份
            const backupsToTry = [
              { path: 'backup', label: '常规备份' },
              { path: 'backup_safe', label: '安全备份' },
            ];
            for (const { path, label } of backupsToTry) {
              try {
                const bRef = doc(db, 'inventory_apps', appId, 'shared', path);
                const bSnap = await getDoc(bRef);
                if (bSnap.exists()) {
                  const bd = bSnap.data();
                  const bItems = sanitizeSkus(bd.items || []);
                  if (bItems.length > 0) {
                    console.log('🔄 发现云端' + label + '，自动恢复中... SKU:', bItems.length);
                    const bOfflineItems = sanitizeOfflineInventoryItems(bd.offlineInventoryItems || []);
                    const bOfflineLogs = sanitizeOfflineInventoryLogs(bd.offlineInventoryLogs || []);
                    const bRecipientDir = sanitizeRecipientDirectory(bd.offlineRecipientDirectory || []);
                    const bApprovals = sanitizeDeleteApprovals(bd.deleteApprovals || []);
                    setSkus(bItems);
                    setOfflineInventoryItems(bOfflineItems);
                    setOfflineInventoryLogs(bOfflineLogs);
                    setOfflineRecipientDirectory(bRecipientDir);
                    setDeleteApprovals(bApprovals);
                    setSelectedSkuId(bItems[0]?.id ?? 1);
                    if (bd.warningDays) setWarningDays(bd.warningDays);
                    if (bd.defaultSettings) setDefaultSettings(bd.defaultSettings);
                    if (bd.transportModes) setTransportModes(bd.transportModes);
                    if (bd.userRoles) setUserRoles(bd.userRoles);
                    const clean = (o) => { if (Array.isArray(o)) return o.map(clean); if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined).map(([k,v])=>[k,clean(v)])); return o; };
                    await setDoc(docRef, { items: clean(bItems), offlineInventoryItems: clean(bOfflineItems), offlineInventoryLogs: clean(bOfflineLogs), offlineRecipientDirectory: clean(bRecipientDir), deleteApprovals: clean(bApprovals), warningDays: bd.warningDays || warningDays, defaultSettings: bd.defaultSettings || defaultSettings, transportModes: bd.transportModes || transportModes, userRoles: bd.userRoles || userRoles, lastUpdated: new Date().toISOString() }, { merge: true });
                    lastRemoteItemsJSONRef.current = JSON.stringify({ items: bItems, offlineInventoryItems: bOfflineItems, offlineInventoryLogs: bOfflineLogs, offlineRecipientDirectory: bRecipientDir, deleteApprovals: bApprovals });
                    cloudDataLoadedRef.current = true;
                    remoteSkuCountRef.current = bItems.length;
                    console.log('✅ 从云端' + label + '自动恢复成功！SKU:', bItems.length);
                    setWarning('✅ 云端数据已从' + label + '自动恢复（' + bItems.length + ' 个SKU）');
                    return true;
                  }
                }
              } catch (e) {
                console.warn('⚠️ 尝试从' + label + '恢复失败:', e.message);
              }
            }
            return false;
          };

          tryRestoreFromBackup().then((restored) => {
            if (!restored) {
              const local2 = loadLocalMemory(localKey);
              if (local2 && Array.isArray(local2.skus) && local2.skus.length > 0) {
                const localSkus = sanitizeSkus(local2.skus);
                setSkus(localSkus);
                setSelectedSkuId(localSkus[0]?.id ?? 1);
                if (local2.offlineInventoryItems) setOfflineInventoryItems(sanitizeOfflineInventoryItems(local2.offlineInventoryItems));
                if (local2.offlineInventoryLogs) setOfflineInventoryLogs(sanitizeOfflineInventoryLogs(local2.offlineInventoryLogs));
                if (local2.offlineRecipientDirectory) setOfflineRecipientDirectory(sanitizeRecipientDirectory(local2.offlineRecipientDirectory));
                if (local2.deleteApprovals) setDeleteApprovals(sanitizeDeleteApprovals(local2.deleteApprovals));
                console.log('📂 已加载本地缓存数据，但不写入云端');
              } else {
                setSkus(sanitizeSkus(DEFAULT_DATA));
                setSelectedSkuId(1);
                console.log('📂 全新项目，使用默认数据但不自动写入云端');
              }
              // cloudDataLoadedRef 保持 false，禁止自动云端写入
              console.warn('⚠️ 云端文档为空且无备份，cloudDataLoadedRef=false，禁止自动写入');
            }
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
        // 🔒 注意：这里只设 isInitialLoadDone 允许本地使用，但 cloudDataLoadedRef 保持 false
        // 这样即使本地有默认数据，也不会覆盖云端真实数据
        setIsInitialLoadDone(true); // 允许继续本地浏览
        console.warn('⚠️ cloudDataLoadedRef 保持 false，禁止云端写入，防止空数据覆盖');
      }
    );

    return () => {
      unsubscribe();
      // 用户切换时重置云端数据标记，确保新用户需要重新接收云端数据
      cloudDataLoadedRef.current = false;
    };
  }, [user, db, appId, localKey]);

  // --- 4.1 本地兜底自动存档（始终开启） ---
  useEffect(() => {
    if (skus.length === 0) return;
    const timer = setTimeout(() => {
      saveLocalMemory(localKey, { skus, offlineInventoryItems, offlineInventoryLogs, offlineRecipientDirectory, deleteApprovals, selectedSkuId, viewMode, warningDays, defaultSettings, transportModes, userRoles, savedAt: Date.now() });
    }, 300);
    return () => clearTimeout(timer);
  }, [skus, offlineInventoryItems, offlineInventoryLogs, offlineRecipientDirectory, deleteApprovals, selectedSkuId, viewMode, warningDays, defaultSettings, transportModes, userRoles, localKey]);

  // --- 4.1.1 云端自动备份（数据变化时每30秒自动备份一次） ---
  const lastBackupJSONRef = useRef('');
  useEffect(() => {
    if (!db || !user || !cloudDataLoadedRef.current || skus.length === 0) return;
    if (isRestoringRef.current) return;
    // 🔒 防空：如果已知云端有大量数据，但当前 state 数据骤降，不触发自动备份
    if (remoteSkuCountRef.current > 5 && skus.length < remoteSkuCountRef.current * 0.5) {
      console.warn('⚠️ 自动备份跳过：SKU(' + skus.length + ') 远少于云端实际数(' + remoteSkuCountRef.current + ')');
      return;
    }
    // 生成当前完整数据快照（包含内容），任何字段变化都会触发备份
    const currentJSON = JSON.stringify({
      skus,
      offlineInventoryItems,
      offlineInventoryLogs,
      offlineRecipientDirectory,
      deleteApprovals,
      warningDays,
      defaultSettings,
      transportModes,
      userRoles,
    });
    if (currentJSON === lastBackupJSONRef.current) return;
    const timer = setTimeout(() => {
      lastBackupJSONRef.current = currentJSON;
      saveBackupToCloud('auto');
    }, 30000); // 30秒防抖，避免频繁写入
    return () => clearTimeout(timer);
  }, [skus, offlineInventoryItems, offlineInventoryLogs, offlineRecipientDirectory, deleteApprovals, warningDays, defaultSettings, transportModes, userRoles, db, user]);

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
    // 🔒 防丢保护：必须完成初始读取、成功接收过云端数据、且数据不为空才允许写回
    if (!isInitialLoadDone || skus.length === 0) return;
    if (!cloudDataLoadedRef.current) {
      console.log('⏸️ 尚未成功接收云端数据，跳过云端写入（防止空数据覆盖）');
      return;
    }
    // 🔒 恢复操作进行中，跳过自动保存以防冲突
    if (isRestoringRef.current) {
      console.log('⏸️ 数据恢复进行中，跳过自动云端同步');
      return;
    }
    // 🔒 数据量安全检查：防止少量数据覆盖大量数据
    if (remoteSkuCountRef.current > 5 && skus.length < remoteSkuCountRef.current * 0.5) {
      console.error('🚨 安全拦截：当前 SKU 数(' + skus.length + ') 远少于云端(' + remoteSkuCountRef.current + ')，禁止写入以防数据丢失');
      return;
    }

    const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');
    const localJSON = JSON.stringify({ items: skus, offlineInventoryItems, offlineInventoryLogs, offlineRecipientDirectory, deleteApprovals });
    if (localJSON === lastRemoteItemsJSONRef.current) {
      hasPendingChangesRef.current = false;
      return;
    }

    hasPendingChangesRef.current = true; // 立即标记，防止 onSnapshot 在防抖窗口内覆盖本地数据

    const remoteTimer = setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        const cleanedSkus = cleanUndefinedValues(skus);
        const cleanedOfflineItems = cleanUndefinedValues(offlineInventoryItems);
        const cleanedOfflineLogs = cleanUndefinedValues(offlineInventoryLogs);
        const cleanedRecipientDirectory = cleanUndefinedValues(offlineRecipientDirectory);
        const cleanedDeleteApprovals = cleanUndefinedValues(deleteApprovals);
        await setDoc(docRef, { items: cleanedSkus, offlineInventoryItems: cleanedOfflineItems, offlineInventoryLogs: cleanedOfflineLogs, offlineRecipientDirectory: cleanedRecipientDirectory, deleteApprovals: cleanedDeleteApprovals, lastUpdated: new Date().toISOString() }, { merge: true });
        // 使用与 onSnapshot 一致的方式生成 JSON，防止 sanitize 差异导致多余同步
        lastRemoteItemsJSONRef.current = JSON.stringify({
          items: sanitizeSkus(cleanedSkus),
          offlineInventoryItems: sanitizeOfflineInventoryItems(cleanedOfflineItems),
          offlineInventoryLogs: sanitizeOfflineInventoryLogs(cleanedOfflineLogs),
          offlineRecipientDirectory: sanitizeRecipientDirectory(cleanedRecipientDirectory),
          deleteApprovals: sanitizeDeleteApprovals(cleanedDeleteApprovals),
        });
        hasPendingChangesRef.current = false; // 同步成功，清除标记
        setSyncStatus('ready');
        console.log('✅ 云端数据同步成功');
      } catch (err) {
        console.error('❌ 自动云端存档失败:', err.code, err.message);
        hasPendingChangesRef.current = false; // 失败时也清除标记，避免永久屏蔽远程数据
        setSyncStatus('error');
      }
    }, 1000);

    return () => clearTimeout(remoteTimer);
  }, [skus, offlineInventoryItems, offlineInventoryLogs, offlineRecipientDirectory, deleteApprovals, user, isInitialLoadDone, appId, db]);

  // --- 4.3 设置自动云端保存 ---
  useEffect(() => {
    if (!db || !user || !isInitialLoadDone || !canManagePermissions) return;
    // 🔒 必须在成功接收云端数据后才允许写入设置
    if (!cloudDataLoadedRef.current) {
      console.log('⏸️ 尚未接收云端数据，跳过设置云端写入');
      return;
    }
    hasPendingSettingsRef.current = true; // 立即标记，防止 onSnapshot 覆盖本地设置
    
    const settingsTimer = setTimeout(async () => {
      try {
        const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');
        await setDoc(docRef, { 
          warningDays, 
          defaultSettings, 
          transportModes,
          userRoles,
          lastUpdated: new Date().toISOString() 
        }, { merge: true });
        hasPendingSettingsRef.current = false;
        console.log('✅ 设置自动同步到云端');
      } catch (err) {
        hasPendingSettingsRef.current = false;
        console.error('⚠️ 设置云端同步失败:', err.message);
      }
    }, 1500);

    return () => clearTimeout(settingsTimer);
  }, [warningDays, defaultSettings, transportModes, userRoles, user, isInitialLoadDone, appId, db, canManagePermissions]);

  // --- 5. 业务操作 ---
  const activeSku = useMemo(() => skus.find(s => s.id === (selectedSkuId || (skus[0]?.id))) || null, [skus, selectedSkuId]);

  const salesYearOptions = useMemo(() => {
    const yearSet = new Set([String(new Date().getFullYear())]);
    skus.forEach(sku => {
      Object.keys(sku.salesByYear || {}).forEach(y => yearSet.add(String(y)));
    });
    return Array.from(yearSet).map(y => Number(y)).filter(Number.isFinite).sort((a, b) => a - b);
  }, [skus]);

  const activeSalesSku = useMemo(() => skus.find(s => s.id === (selectedSkuId || skus[0]?.id)) || null, [skus, selectedSkuId]);

  useEffect(() => {
    if (salesYearOptions.length === 0) return;
    if (!salesYearOptions.includes(Number(salesSelectedYear))) {
      setSalesSelectedYear(salesYearOptions[salesYearOptions.length - 1]);
    }
  }, [salesYearOptions, salesSelectedYear]);

  const upsertUserRole = (email, role, features = null) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      setWarning('请输入账号邮箱');
      return;
    }
    if (!ROLE_OPTIONS.includes(role)) {
      setWarning('权限类型无效');
      return;
    }
    setUserRoles(prev => {
      const existing = prev[normalizedEmail];
      const prevFeatures = (existing && typeof existing === 'object' && Array.isArray(existing.features)) ? existing.features : [];
      const prevNickname = (existing && typeof existing === 'object') ? (existing.nickname || '') : '';
      return { ...prev, [normalizedEmail]: { role, features: features !== null ? features : prevFeatures, nickname: prevNickname } };
    });
    setRoleTargetEmail('');
    setRoleTargetValue('viewer');
  };

  const updateUserFeatures = (email, features) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    setUserRoles(prev => {
      const existing = prev[normalizedEmail];
      const role = (existing && typeof existing === 'object') ? (existing.role || 'editor') : (typeof existing === 'string' ? existing : 'editor');
      const nickname = (existing && typeof existing === 'object') ? (existing.nickname || '') : '';
      return { ...prev, [normalizedEmail]: { role, features, nickname } };
    });
  };

  const updateUserNickname = (email, nickname) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    setUserRoles(prev => {
      const existing = prev[normalizedEmail];
      const role = (existing && typeof existing === 'object') ? (existing.role || 'editor') : (typeof existing === 'string' ? existing : 'editor');
      const features = (existing && typeof existing === 'object' && Array.isArray(existing.features)) ? existing.features : [];
      return { ...prev, [normalizedEmail]: { role, features, nickname: String(nickname || '').trim() } };
    });
  };

  // 根据邮箱获取备注名（优先备注，否则邮箱）
  const getUserNickname = (email) => {
    if (!email) return '';
    const normalized = String(email).trim().toLowerCase();
    const data = userRoles[normalized];
    if (data && typeof data === 'object' && data.nickname) return data.nickname;
    return normalized;
  };

  const removeUserRole = (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    setUserRoles(prev => {
      const next = { ...prev };
      delete next[normalizedEmail];
      return next;
    });
  };

  const getDeleteActionLabel = (actionType) => {
    if (actionType === 'offline_sku') return '删除线下SKU';
    if (actionType === 'po') return '删除采购单';
    if (actionType === 'customer_edit') return '编辑客户信息';
    if (actionType === 'customer_delete') return '删除客户';
    if (actionType === 'profile_delete') return '删除地址';
    return '删除SKU';
  };

  const requestDeleteApproval = (actionType, entityName, payload) => {
    if (!ensureEditPermission()) return false;
    const requester = String(user?.email || '').trim().toLowerCase();
    if (!requester) {
      setWarning('当前未获取到登录账号，无法提交删除审批');
      return false;
    }
    const now = new Date().toISOString();
    const request = {
      id: Date.now(),
      status: 'pending',
      actionType,
      entityName: String(entityName || '').trim(),
      payload: payload && typeof payload === 'object' ? payload : {},
      requestedBy: requester,
      requestedAt: now,
      reviewedBy: '',
      reviewedAt: '',
    };
    setDeleteApprovals(prev => [request, ...prev]);
    setWarning(`已提交审批：${getDeleteActionLabel(actionType)}，等待管理员处理`);
    return true;
  };

  const executeApprovedDelete = (approval) => {
    if (!approval || !approval.payload) return;
    if (approval.actionType === 'sku') {
      const skuId = Number(approval.payload.skuId);
      if (!Number.isFinite(skuId)) return;
      setSkus(prev => {
        const next = prev.filter(s => s.id !== skuId);
        setSelectedSkuId(curr => (curr === skuId ? (next[0]?.id ?? null) : curr));
        return next;
      });
      return;
    }
    if (approval.actionType === 'offline_sku') {
      const itemId = Number(approval.payload.itemId);
      if (!Number.isFinite(itemId)) return;
      setOfflineInventoryItems(prev => prev.filter(item => item.id !== itemId));
      setOfflineInventoryLogs(prev => prev.filter(log => Number(log.itemId) !== itemId));
      return;
    }
    if (approval.actionType === 'po') {
      const skuId = Number(approval.payload.skuId);
      const poId = Number(approval.payload.poId);
      if (!Number.isFinite(skuId) || !Number.isFinite(poId)) return;
      setSkus(prev => prev.map(s => s.id === skuId ? { ...s, pos: (s.pos || []).filter(p => p.id !== poId) } : s));
      return;
    }
    if (approval.actionType === 'customer_edit') {
      const { customerId, platform, name, identity, phone, remark } = approval.payload;
      const trimmedName = String(name || '').trim();
      const targetId = Number(customerId);
      if (!Number.isFinite(targetId)) return;
      if (!trimmedName) {
        setWarning('审批执行失败：客户名称为空');
        return;
      }
      const exists = offlineRecipientDirectory.some(c => c.id === targetId);
      if (!exists) {
        setWarning('审批执行失败：该客户已被删除，编辑无法生效');
        return;
      }
      setOfflineRecipientDirectory(prev => prev.map(c => {
        if (c.id !== targetId) return c;
        return { ...c, platform: String(platform || '').trim(), name: trimmedName, identity: String(identity || '').trim(), phone: String(phone || '').trim(), remark: String(remark || '').trim() };
      }));
      return;
    }
    if (approval.actionType === 'profile_delete') {
      const customerIdNum = Number(approval.payload.customerId);
      const profileIdNum = Number(approval.payload.profileId);
      if (!Number.isFinite(customerIdNum) || !Number.isFinite(profileIdNum)) return;
      setOfflineRecipientDirectory(prev => prev.map(customer => {
        if (customer.id !== customerIdNum) return customer;
        const profiles = (customer.profiles || []).filter(profile => profile.id !== profileIdNum);
        const hasDefault = profiles.some(profile => profile.isDefault);
        const normalized = profiles.map((profile, idx) => ({ ...profile, isDefault: hasDefault ? profile.isDefault : idx === 0 }));
        return { ...customer, profiles: normalized };
      }));
      if (String(offlineEditingProfileId) === String(profileIdNum)) {
        setOfflineEditingProfileId('');
        setOfflineProfileLabel('');
        setOfflineProfileReceiver('');
        setOfflineProfilePhone('');
        setOfflineProfileAddress('');
        setOfflineProfileRemark('');
      }
      return;
    }
    if (approval.actionType === 'customer_delete') {
      const targetId = Number(approval.payload.customerId);
      if (!Number.isFinite(targetId)) return;
      setOfflineRecipientDirectory(prev => prev.filter(c => c.id !== targetId));
      if (String(offlineSelectedCustomerId) === String(targetId)) {
        setOfflineSelectedCustomerId('');
      }
      if (String(offlineTxCustomerId) === String(targetId)) {
        setOfflineTxCustomerId('');
        setOfflineTxProfileId('');
      }
      setOfflineEditingProfileId('');
      setOfflineProfileLabel('');
      setOfflineProfileReceiver('');
      setOfflineProfilePhone('');
      setOfflineProfileAddress('');
      setOfflineProfileRemark('');
      return;
    }
  };

  const reviewDeleteApproval = (approvalId, decision) => {
    if (!canApproveDeletion) {
      setWarning('仅管理员可审批删除申请');
      return;
    }
    const target = deleteApprovals.find(item => item.id === approvalId);
    if (!target || target.status !== 'pending') return;

    if (decision === 'approved') {
      executeApprovedDelete(target);
    }

    const now = new Date().toISOString();
    const reviewer = String(user?.email || '').trim().toLowerCase();
    setDeleteApprovals(prev => prev.map(item => {
      if (item.id !== approvalId) return item;
      return {
        ...item,
        status: decision === 'approved' ? 'approved' : 'rejected',
        reviewedBy: reviewer,
        reviewedAt: now,
      };
    }));
    setWarning(decision === 'approved' ? '审批通过，操作已执行' : '审批已驳回');
  };

  const updateSku = (id, field, value) => {
    if (!ensureEditPermission()) return;
    setSkus(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const addOfflineInventoryItem = () => {
    if (!ensureEditPermission()) return;
    const name = String(offlineItemName || '').trim();
    const initialStock = Math.max(0, Number(offlineItemStock || 0) || 0);
    if (!name) {
      setWarning('请输入线下库存品项名称');
      return;
    }
    if (offlineInventoryItems.some(item => item.name === name)) {
      setWarning('该线下品项已存在，请直接做入库/出库');
      return;
    }
    const now = new Date().toISOString();
    const newItem = {
      id: Date.now(),
      name,
      currentStock: initialStock,
      inboundTotal: initialStock,
      outboundTotal: 0,
      lastOutboundAccount: '',
      remark: String(offlineItemRemark || '').trim(),
      updatedAt: now,
    };
    setOfflineInventoryItems(prev => [newItem, ...prev]);
    if (initialStock > 0) {
      setOfflineInventoryLogs(prev => [{
        id: Date.now() + 1,
        itemId: newItem.id,
        itemName: newItem.name,
        type: 'in',
        qty: initialStock,
        account: '系统初始化',
        remark: '初始化库存',
        operator: user?.email || '',
        happenedAt: now,
      }, ...prev]);
    }
    setOfflineItemName('');
    setOfflineItemStock('');
    setOfflineItemRemark('');
    if (!offlineTxItemId) setOfflineTxItemId(String(newItem.id));
    if (!offlineSelectedItemId) setOfflineSelectedItemId(newItem.id);
  };

  const addOfflineRecipientCustomer = () => {
    if (!ensureEditPermission()) return;
    const platform = String(offlineCustomerPlatform || '').trim();
    const name = String(offlineCustomerName || '').trim();
    const identity = String(offlineCustomerIdentity || '').trim();
    const phone = String(offlineCustomerPhone || '').trim();
    const remark = String(offlineCustomerRemark || '').trim();
    const profileLabel = String(offlineProfileLabel || '').trim() || '默认地址';
    const profileReceiver = String(offlineProfileReceiver || '').trim() || name;
    const profilePhone = String(offlineProfilePhone || '').trim() || phone;
    const profileAddress = String(offlineProfileAddress || '').trim();
    const profileRemark = String(offlineProfileRemark || '').trim();
    if (!name) {
      setWarning('请输入客户名称');
      return;
    }
    if (offlineRecipientDirectory.some(customer => customer.name === name)) {
      setWarning('客户已存在，可直接在该客户下新增地址信息');
      return;
    }
    const profiles = profileAddress
      ? [{
          id: Date.now() + 1,
          label: profileLabel,
          receiver: profileReceiver,
          phone: profilePhone,
          address: profileAddress,
          remark: profileRemark,
          isDefault: true,
        }]
      : [];
    const newCustomer = {
      id: Date.now(),
      platform,
      name,
      identity,
      phone,
      remark,
      profiles,
    };
    setOfflineRecipientDirectory(prev => [newCustomer, ...prev]);
    setOfflineSelectedCustomerId(String(newCustomer.id));
    setOfflineTxCustomerId(String(newCustomer.id));
    setOfflineCustomerPlatform('');
    setOfflineCustomerName('');
    setOfflineCustomerIdentity('');
    setOfflineCustomerPhone('');
    setOfflineCustomerRemark('');
    setOfflineProfileLabel('');
    setOfflineProfileReceiver('');
    setOfflineProfilePhone('');
    setOfflineProfileAddress('');
    setOfflineProfileRemark('');
    setOfflineEditingProfileId('');
  };

  const openEditCustomerModal = (customerId) => {
    if (!ensureEditPermission()) return;
    const target = offlineRecipientDirectory.find(c => c.id === Number(customerId));
    if (!target) return;
    setEditingCustomerModal({
      id: target.id,
      platform: target.platform || '',
      name: target.name || '',
      identity: target.identity || '',
      phone: target.phone || '',
      remark: target.remark || '',
    });
  };

  const saveEditCustomerModal = () => {
    if (!editingCustomerModal) return;
    const { id, platform, name, identity, phone, remark } = editingCustomerModal;
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      setWarning('客户名称不能为空');
      return;
    }
    if (offlineRecipientDirectory.some(c => c.id !== id && c.name === trimmedName)) {
      setWarning('已存在同名客户，请修改名称后再保存');
      return;
    }
    const ok = requestDeleteApproval('customer_edit', trimmedName, { customerId: id, platform, name: trimmedName, identity: String(identity || '').trim(), phone: String(phone || '').trim(), remark: String(remark || '').trim() });
    if (ok) setEditingCustomerModal(null);
  };

  const deleteOfflineRecipientCustomer = (customerId) => {
    if (!ensureEditPermission()) return;
    const targetId = Number(customerId);
    const target = offlineRecipientDirectory.find(customer => customer.id === targetId);
    if (!target) return;
    const ok = window.confirm(`确定提交删除客户「${target.name}」的审批请求吗？`);
    if (!ok) return;
    requestDeleteApproval('customer_delete', target.name, { customerId: targetId });
  };

  const deleteOfflineRecipientProfile = (customerId, profileId) => {
    if (!ensureEditPermission()) return;
    const customerIdNum = Number(customerId);
    const profileIdNum = Number(profileId);
    if (!Number.isFinite(customerIdNum) || !Number.isFinite(profileIdNum)) return;
    const targetCustomer = offlineRecipientDirectory.find(c => c.id === customerIdNum);
    const targetProfile = (targetCustomer?.profiles || []).find(p => p.id === profileIdNum);
    if (!targetCustomer || !targetProfile) return;
    requestDeleteApproval('profile_delete', `${targetCustomer.name} - ${targetProfile.label || targetProfile.address || '地址'}`, { customerId: customerIdNum, profileId: profileIdNum });
  };

  const startEditOfflineRecipientProfile = (customerId, profileId) => {
    if (!ensureEditPermission()) return;
    const customerIdNum = Number(customerId);
    const profileIdNum = Number(profileId);
    if (!Number.isFinite(customerIdNum) || !Number.isFinite(profileIdNum)) return;
    const targetCustomer = offlineRecipientDirectory.find(customer => customer.id === customerIdNum);
    const targetProfile = (targetCustomer?.profiles || []).find(profile => profile.id === profileIdNum);
    if (!targetCustomer || !targetProfile) {
      setWarning('地址不存在，请刷新后重试');
      return;
    }
    setOfflineSelectedCustomerId(String(customerIdNum));
    setOfflineProfileLabel(String(targetProfile.label || ''));
    setOfflineProfileReceiver(String(targetProfile.receiver || ''));
    setOfflineProfilePhone(String(targetProfile.phone || ''));
    setOfflineProfileAddress(String(targetProfile.address || ''));
    setOfflineProfileRemark(String(targetProfile.remark || ''));
    setOfflineEditingProfileId(String(profileIdNum));
  };

  const cancelEditOfflineRecipientProfile = () => {
    setOfflineEditingProfileId('');
    setOfflineProfileLabel('');
    setOfflineProfileReceiver('');
    setOfflineProfilePhone('');
    setOfflineProfileAddress('');
    setOfflineProfileRemark('');
  };

  const addOfflineRecipientProfile = () => {
    if (!ensureEditPermission()) return;
    const customerId = Number(offlineSelectedCustomerId);
    const editingProfileId = Number(offlineEditingProfileId);
    const isEditing = !!offlineEditingProfileId && Number.isFinite(editingProfileId);
    if (!Number.isFinite(customerId)) {
      setWarning('请先选择客户');
      return;
    }
    const label = String(offlineProfileLabel || '').trim();
    const receiver = String(offlineProfileReceiver || '').trim();
    const phone = String(offlineProfilePhone || '').trim();
    const address = String(offlineProfileAddress || '').trim();
    const remark = String(offlineProfileRemark || '').trim();
    if (!label) {
      setWarning('请输入地址标签（如：广州仓 / 深圳办公室）');
      return;
    }
    if (!address) {
      setWarning('请输入详细收件地址');
      return;
    }

    const targetCustomer = offlineRecipientDirectory.find(customer => customer.id === customerId);
    if (!targetCustomer) {
      setWarning('客户不存在，请刷新后重试');
      return;
    }
    if (isEditing && !(targetCustomer.profiles || []).some(profile => profile.id === editingProfileId)) {
      setWarning('待编辑地址不存在，请刷新后重试');
      return;
    }
    if ((targetCustomer.profiles || []).some(profile => String(profile.label || '').trim() === label && profile.id !== editingProfileId)) {
      setWarning('该客户下已存在同名地址标签，请更换标签');
      return;
    }

    const newProfileId = Date.now();
    setOfflineRecipientDirectory(prev => prev.map(customer => {
      if (customer.id !== customerId) return customer;
      const profiles = Array.isArray(customer.profiles) ? customer.profiles : [];
      if (isEditing) {
        const updatedProfiles = profiles.map(profile => {
          if (profile.id !== editingProfileId) return profile;
          return { ...profile, label, receiver, phone, address, remark };
        });
        return { ...customer, profiles: updatedProfiles };
      }
      const shouldDefault = profiles.length === 0;
      const newProfile = { id: newProfileId, label, receiver, phone, address, remark, isDefault: shouldDefault };
      return { ...customer, profiles: [...profiles, newProfile] };
    }));
    setOfflineTxProfileId(String(isEditing ? editingProfileId : newProfileId));
    setOfflineProfileLabel('');
    setOfflineProfileReceiver('');
    setOfflineProfilePhone('');
    setOfflineProfileAddress('');
    setOfflineProfileRemark('');
    setOfflineEditingProfileId('');
    if (isEditing) setWarning('地址信息已更新');
  };

  const deleteOfflineInventoryItem = (itemId) => {
    const targetId = Number(itemId);
    const targetItem = offlineInventoryItems.find(item => item.id === targetId);
    if (!targetItem) return;
    const ok = window.confirm(`确定提交审批删除线下SKU「${targetItem.name}」吗？审批通过后将同时删除该SKU全部出入库记录。`);
    if (!ok) return;
    requestDeleteApproval('offline_sku', targetItem.name, { itemId: targetId });
  };

  const recordOfflineInventoryTx = () => {
    if (!ensureEditPermission()) return;
    const itemIdNum = Number(offlineTxItemId);
    const qty = Math.max(0, Number(offlineTxQty || 0) || 0);
    const txType = offlineTxType === 'out' ? 'out' : 'in';
    const txPurpose = PURPOSE_KEYS.includes(offlineTxPurpose) ? offlineTxPurpose : 'normal';
    const account = String(user?.email || '').trim();
    const remark = String(offlineTxRemark || '').trim();
    const txCustomerIdNum = Number(offlineTxCustomerId);
    const txProfileIdNum = Number(offlineTxProfileId);
    const trackingNo = String(offlineTxTrackingNo || '').trim();
    if (!Number.isFinite(itemIdNum)) {
      setWarning('请选择线下库存品项');
      return;
    }
    if (qty <= 0) {
      setWarning('请输入有效数量');
      return;
    }
    if (!account) {
      setWarning('当前未获取到登录账号，请重新登录后再操作');
      return;
    }
    const targetItem = offlineInventoryItems.find(item => item.id === itemIdNum);
    if (!targetItem) {
      setWarning('线下库存品项不存在');
      return;
    }
    if (txType === 'out' && qty > Number(targetItem.currentStock || 0)) {
      setWarning('出库数量超过当前库存');
      return;
    }

    const selectedCustomer = Number.isFinite(txCustomerIdNum)
      ? offlineRecipientDirectory.find(customer => customer.id === txCustomerIdNum)
      : null;
    const selectedProfile = selectedCustomer && Number.isFinite(txProfileIdNum)
      ? (selectedCustomer.profiles || []).find(profile => profile.id === txProfileIdNum)
      : null;

    if (txType === 'out' && txPurpose === 'sample') {
      if (!selectedCustomer) {
        setWarning('寄样出库请选择客户');
        return;
      }
      if (!selectedProfile) {
        setWarning('寄样出库请选择客户收件信息');
        return;
      }
      if (!trackingNo) {
        setWarning('寄样出库请填写快递单号');
        return;
      }
    }

    const now = new Date().toISOString();
    setOfflineInventoryItems(prev => prev.map(item => {
      if (item.id !== itemIdNum) return item;
      const currentStock = Number(item.currentStock || 0);
      const inboundTotal = Number(item.inboundTotal || 0);
      const outboundTotal = Number(item.outboundTotal || 0);
      if (txType === 'in') {
        return {
          ...item,
          currentStock: currentStock + qty,
          inboundTotal: inboundTotal + qty,
          remark: remark || item.remark,
          updatedAt: now,
        };
      }
      return {
        ...item,
        currentStock: Math.max(0, currentStock - qty),
        outboundTotal: outboundTotal + (qty <= currentStock ? qty : currentStock),
        lastOutboundAccount: account,
        remark: remark || item.remark,
        updatedAt: now,
      };
    }));

    setOfflineInventoryLogs(prev => [{
      id: Date.now(),
      itemId: targetItem.id,
      itemName: targetItem.name,
      type: txType,
      purpose: txType === 'out' ? txPurpose : 'restock',
      qty,
      account,
      customerId: selectedCustomer?.id || null,
      customerName: selectedCustomer?.name || '',
      customerPlatform: selectedCustomer?.platform || '',
      customerIdentity: selectedCustomer?.identity || '',
      customerPhone: selectedCustomer?.phone || '',
      profileId: selectedProfile?.id || null,
      profileLabel: selectedProfile?.label || '',
      profileReceiver: selectedProfile?.receiver || '',
      profilePhone: selectedProfile?.phone || '',
      profileAddress: selectedProfile?.address || '',
      trackingNo: txType === 'out' ? trackingNo : '',
      remark,
      operator: user?.email || '',
      happenedAt: now,
    }, ...prev]);

    setOfflineTxQty('');
    setOfflineTxRemark('');
  };

  // 管理员编辑出库记录（同步回退/补偿库存）
  const saveEditingOfflineLog = () => {
    if (!editingOfflineLog) return;
    const { id, ...updates } = editingOfflineLog;
    const oldLog = offlineInventoryLogs.find(log => log.id === id);
    if (!oldLog) return;
    const oldQty = Number(oldLog.qty || 0);
    const newQty = Math.max(0, Number(updates.qty) || 0);
    const qtyDelta = newQty - oldQty;
    if (qtyDelta !== 0) {
      setOfflineInventoryItems(prev => prev.map(item => {
        if (item.id !== oldLog.itemId) return item;
        const currentStock = Number(item.currentStock || 0);
        const outboundTotal = Number(item.outboundTotal || 0);
        const inboundTotal = Number(item.inboundTotal || 0);
        if (oldLog.type === 'out') {
          return { ...item, currentStock: Math.max(0, currentStock - qtyDelta), outboundTotal: Math.max(0, outboundTotal + qtyDelta) };
        }
        return { ...item, currentStock: Math.max(0, currentStock + qtyDelta), inboundTotal: Math.max(0, inboundTotal + qtyDelta) };
      }));
    }
    setOfflineInventoryLogs(prev => prev.map(log => {
      if (log.id !== id) return log;
      return { ...log, ...updates, qty: newQty };
    }));
    setEditingOfflineLog(null);
  };

  // 管理员删除出库记录（回退库存）
  const deleteOfflineLog = (logId) => {
    if (!confirm('确认删除此记录？库存将自动回退。')) return;
    const targetLog = offlineInventoryLogs.find(log => log.id === logId);
    if (targetLog) {
      const qty = Number(targetLog.qty || 0);
      if (qty > 0) {
        setOfflineInventoryItems(prev => prev.map(item => {
          if (item.id !== targetLog.itemId) return item;
          const currentStock = Number(item.currentStock || 0);
          const outboundTotal = Number(item.outboundTotal || 0);
          const inboundTotal = Number(item.inboundTotal || 0);
          if (targetLog.type === 'out') {
            return { ...item, currentStock: currentStock + qty, outboundTotal: Math.max(0, outboundTotal - qty) };
          }
          return { ...item, currentStock: Math.max(0, currentStock - qty), inboundTotal: Math.max(0, inboundTotal - qty) };
        }));
      }
    }
    setOfflineInventoryLogs(prev => prev.filter(log => log.id !== logId));
    setEditingOfflineLog(null);
  };

  const offlineInventorySummary = useMemo(() => {
    const itemCount = offlineInventoryItems.length;
    const currentTotal = offlineInventoryItems.reduce((sum, item) => sum + Number(item.currentStock || 0), 0);
    const inboundTotal = offlineInventoryItems.reduce((sum, item) => sum + Number(item.inboundTotal || 0), 0);
    const outboundTotal = offlineInventoryItems.reduce((sum, item) => sum + Number(item.outboundTotal || 0), 0);
    return { itemCount, currentTotal, inboundTotal, outboundTotal };
  }, [offlineInventoryItems]);

  const offlineRecipientSummary = useMemo(() => {
    const customerCount = offlineRecipientDirectory.length;
    const profileCount = offlineRecipientDirectory.reduce((sum, customer) => sum + (customer.profiles || []).length, 0);
    return { customerCount, profileCount };
  }, [offlineRecipientDirectory]);

  const filteredOfflineRecipients = useMemo(() => {
    const query = String(offlineRecipientQuery || '').trim().toLowerCase();
    if (!query) return offlineRecipientDirectory;
    return offlineRecipientDirectory.filter(customer => {
      const basic = [
        customer.platform,
        customer.name,
        customer.identity,
        customer.phone,
        customer.remark,
      ].map(v => String(v || '').toLowerCase()).join(' ');
      const profileText = (customer.profiles || []).map(profile => [
        profile.label,
        profile.receiver,
        profile.phone,
        profile.address,
        profile.remark,
      ].map(v => String(v || '').toLowerCase()).join(' ')).join(' ');
      return `${basic} ${profileText}`.includes(query);
    });
  }, [offlineRecipientDirectory, offlineRecipientQuery]);

  const offlineSelectedCustomer = useMemo(() => {
    const customerId = Number(offlineSelectedCustomerId);
    if (!Number.isFinite(customerId)) return null;
    return offlineRecipientDirectory.find(customer => customer.id === customerId) || null;
  }, [offlineRecipientDirectory, offlineSelectedCustomerId]);

  const offlineTxSelectedCustomer = useMemo(() => {
    const customerId = Number(offlineTxCustomerId);
    if (!Number.isFinite(customerId)) return null;
    return offlineRecipientDirectory.find(customer => customer.id === customerId) || null;
  }, [offlineRecipientDirectory, offlineTxCustomerId]);

  const offlineSelectedItem = useMemo(() => {
    if (!Number.isFinite(Number(offlineSelectedItemId))) return null;
    return offlineInventoryItems.find(item => item.id === Number(offlineSelectedItemId)) || null;
  }, [offlineInventoryItems, offlineSelectedItemId]);

  const selectedOfflineLogs = useMemo(() => {
    if (!offlineSelectedItem) return [];
    return offlineInventoryLogs.filter(log => Number(log.itemId) === Number(offlineSelectedItem.id));
  }, [offlineInventoryLogs, offlineSelectedItem]);

  const offlineOutboundSummaryLogs = useMemo(() => {
    return offlineInventoryLogs.filter(log => log.type === 'out');
  }, [offlineInventoryLogs]);

  const pendingDeleteApprovals = useMemo(() => deleteApprovals.filter(item => item.status === 'pending'), [deleteApprovals]);
  const reviewedDeleteApprovals = useMemo(() => deleteApprovals.filter(item => item.status !== 'pending'), [deleteApprovals]);

  const filteredOfflineInventoryItems = useMemo(() => {
    const query = String(offlineOverviewQuery || '').trim().toLowerCase();
    if (!query) return offlineInventoryItems;
    return offlineInventoryItems.filter(item => String(item.name || '').toLowerCase().includes(query));
  }, [offlineInventoryItems, offlineOverviewQuery]);

  useEffect(() => {
    if (offlineInventoryItems.length === 0) {
      setOfflineTxItemId('');
      return;
    }
    const hasTxItem = offlineInventoryItems.some(item => String(item.id) === String(offlineTxItemId));
    if (!hasTxItem) {
      setOfflineTxItemId(String(offlineInventoryItems[0].id));
    }
  }, [offlineInventoryItems, offlineTxItemId]);

  useEffect(() => {
    if (offlineRecipientDirectory.length === 0) {
      setOfflineSelectedCustomerId('');
      setOfflineTxCustomerId('');
      setOfflineTxProfileId('');
      return;
    }

    const hasSelectedCustomer = offlineRecipientDirectory.some(customer => String(customer.id) === String(offlineSelectedCustomerId));
    if (!hasSelectedCustomer) {
      setOfflineSelectedCustomerId(String(offlineRecipientDirectory[0].id));
    }

    const hasTxCustomer = offlineRecipientDirectory.some(customer => String(customer.id) === String(offlineTxCustomerId));
    if (!hasTxCustomer) {
      setOfflineTxCustomerId(String(offlineRecipientDirectory[0].id));
    }
  }, [offlineRecipientDirectory, offlineSelectedCustomerId, offlineTxCustomerId]);

  useEffect(() => {
    if (!offlineTxSelectedCustomer) {
      setOfflineTxProfileId('');
      return;
    }
    const profiles = offlineTxSelectedCustomer.profiles || [];
    if (profiles.length === 0) {
      setOfflineTxProfileId('');
      return;
    }
    const hasProfile = profiles.some(profile => String(profile.id) === String(offlineTxProfileId));
    if (!hasProfile) {
      const defaultProfile = profiles.find(profile => profile.isDefault) || profiles[0];
      setOfflineTxProfileId(String(defaultProfile.id));
    }
  }, [offlineTxSelectedCustomer, offlineTxProfileId]);



  useEffect(() => {
    if (offlineInventoryItems.length === 0) {
      setOfflineSelectedItemId(null);
      return;
    }
    const hasSelected = offlineInventoryItems.some(item => item.id === Number(offlineSelectedItemId));
    if (!hasSelected) {
      setOfflineSelectedItemId(offlineInventoryItems[0].id);
    }
  }, [offlineInventoryItems, offlineSelectedItemId]);

  const getMonthlySalesForForecast = (sku, baseDate = new Date()) => {
    if (!sku) return Array(12).fill(0);
    const yearKey = String(baseDate.getFullYear());
    const monthIdxNow = baseDate.getMonth();
    const yearCells = sku.salesByYear?.[yearKey];

    if (!Array.isArray(yearCells)) {
      return (sku.monthlySales || Array(12).fill(0)).map(v => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      });
    }

    return Array.from({ length: 12 }).map((_, monthIdx) => {
      const cell = normalizeSalesCell(yearCells[monthIdx]);
      if (monthIdx < monthIdxNow) {
        return Number.isFinite(Number(cell.actual)) ? Number(cell.actual) : 0;
      }
      return Number.isFinite(Number(cell.forecast)) ? Number(cell.forecast) : 0;
    });
  };

  const setSalesCellValue = (skuId, year, monthIdx, field, rawValue) => {
    if (!ensureEditPermission()) return;
    const yearKey = String(year);
    setSkus(prev => prev.map(sku => {
      if (sku.id !== skuId) return sku;

      if (rawValue !== '' && rawValue !== null && rawValue !== undefined) {
        const num = Number(rawValue);
        if (!Number.isFinite(num) || num < 0) {
          setWarning('请输入非负数字，或留空为未填');
          return sku;
        }
      }

      const nextValue = (rawValue === '' || rawValue === null || typeof rawValue === 'undefined') ? null : Math.floor(Number(rawValue));
      const currentYear = String(new Date().getFullYear());
      const salesByYear = { ...(sku.salesByYear || {}) };
      const baseYearCells = Array.isArray(salesByYear[yearKey]) ? salesByYear[yearKey] : createEmptyYearSales(null);
      const yearCells = Array.from({ length: 12 }).map((_, idx) => normalizeSalesCell(baseYearCells[idx]));
      yearCells[monthIdx] = {
        ...yearCells[monthIdx],
        [field]: nextValue,
      };
      salesByYear[yearKey] = yearCells;

      let monthlySales = sku.monthlySales || Array(12).fill(0);
      if (yearKey === currentYear) {
        monthlySales = getMonthlySalesForForecast({ ...sku, salesByYear }, new Date());
      }

      return { ...sku, salesByYear, monthlySales };
    }));
  };

  const createNextSalesYear = () => {
    if (!ensureEditPermission()) return;
    const yearSet = new Set([String(new Date().getFullYear())]);
    skus.forEach(sku => {
      Object.keys(sku.salesByYear || {}).forEach(y => yearSet.add(String(y)));
    });
    const maxYear = Math.max(...Array.from(yearSet).map(y => Number(y)).filter(Number.isFinite));
    const nextYear = maxYear + 1;
    const prevYearKey = String(nextYear - 1);
    const nextYearKey = String(nextYear);

    setSkus(prev => prev.map(sku => {
      const salesByYear = { ...(sku.salesByYear || {}) };
      if (Array.isArray(salesByYear[nextYearKey])) return sku;

      const prevCells = Array.isArray(salesByYear[prevYearKey]) ? salesByYear[prevYearKey] : createEmptyYearSales(null);
      salesByYear[nextYearKey] = Array.from({ length: 12 }).map((_, idx) => {
        const prevCell = normalizeSalesCell(prevCells[idx]);
        return {
          actual: null,
          forecast: Number.isFinite(Number(prevCell.forecast)) ? Number(prevCell.forecast) : null,
        };
      });

      return { ...sku, salesByYear };
    }));

    setSalesSelectedYear(nextYear);
  };

  // 添加新 SKU
  const addSku = () => {
    if (!ensureEditPermission()) return;
    const newId = Math.max(...skus.map(s => s.id), 0) + 1;
    const currentYear = String(new Date().getFullYear());
    const newSku = {
      id: newId,
      name: `新建商品 ${newId}`,
      currentStock: 0,
      unitCost: 0,
      monthlySales: Array(12).fill(0),
      salesByYear: {
        [currentYear]: createEmptyYearSales(0),
      },
      pos: []
    };
    setSkus(prev => [...prev, newSku]);
    setSelectedSkuId(newId);
  };

  // 快速填充月度销量
  const quickFillMonthlySales = () => {
    if (!ensureEditPermission()) return;
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
    const currentYear = String(new Date().getFullYear());
    setSkus(prev => prev.map(sku => {
      if (sku.id !== activeSku.id) return sku;
      const salesByYear = { ...(sku.salesByYear || {}) };
      const yearCells = Array.from({ length: 12 }).map((_, idx) => ({
        actual: normalizeSalesCell(salesByYear[currentYear]?.[idx]).actual,
        forecast: newMonthlySales[idx],
      }));
      salesByYear[currentYear] = yearCells;
      return { ...sku, monthlySales: newMonthlySales, salesByYear };
    }));
    setShowQuickFill(false);
    setQuickFillValue('');
  };

  // SKU 删除
  const deleteSku = (skuId) => {
    const skuToDelete = skus.find(s => s.id === skuId);
    if (!skuToDelete) return;
    if (!confirm(`确定提交审批删除 "${skuToDelete.name}" 吗？审批通过后才会执行删除。`)) return;
    requestDeleteApproval('sku', skuToDelete.name, { skuId: Number(skuId) });
  };

  // SKU 复制
  const duplicateSku = (skuId) => {
    if (!ensureEditPermission()) return;
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
    if (!ensureEditPermission()) return;
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
    if (!ensureEditPermission()) return;
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
    if (!ensureEditPermission()) return;
    setSkus(prev => prev.map(s => s.id === skuId ? { ...s, pos: (s.pos || []).map(p => p.id === poId ? { ...p, [field]: value } : p) } : s));
  };
  const removePO = (skuId, poId) => {
    const sku = skus.find(s => s.id === skuId);
    const po = sku?.pos?.find(p => p.id === poId);
    if (!po) return;
    if (!confirm(`确定提交审批删除采购单「${po.poNumber}」吗？审批通过后才会执行删除。`)) return;
    requestDeleteApproval('po', `${sku?.name || 'SKU'} / ${po.poNumber}`, { skuId: Number(skuId), poId: Number(poId), poNumber: String(po.poNumber || '') });
  };
  
  const duplicatePO = (skuId, poId) => {
    if (!ensureEditPermission()) return;
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
    const headers = ['PO编号', '下单日期', '采购数量', '生产周期(天)', '头程方式', '头程时效(天)', '二程方式', '二程时效(天)', '三程方式', '三程时效(天)', '状态', '预计到货日'];
    const modeLabel = (m) => m === 'sea' ? '海运' : m === 'air' ? '空运' : '铁路';
    const statusLabelMap = { pre_order: '预下订单', ordered: '已下单', cancelled: '已取消', in_production: '生产中', prod_complete: '生产完成', leg1_shipped: '头程已发', leg1_arrived: '头程到达', leg2_shipped: '二程已发', leg2_arrived: '二程到达', inspecting: '验货中', picking: '装柜中', bonded_warehouse: '保税仓', pending_shelving: '待上架', shelved: '已上架' };
    const rows = activeSku.pos.map(po => {
      const arrivalDate = new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays) + Number(po.leg1Days) + Number(po.leg2Days) + Number(po.leg3Days || 0)) * 86400000);
      return [
        po.poNumber || '',
        po.orderDate,
        po.qty,
        po.prodDays,
        modeLabel(po.leg1Mode),
        po.leg1Days,
        modeLabel(po.leg2Mode),
        po.leg2Days,
        modeLabel(po.leg3Mode),
        po.leg3Days || 0,
        statusLabelMap[po.status] || po.status || '已下单',
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
    if (!ensureEditPermission()) return;
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
          const validStatuses = ['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'];
          const sanitized = imported.map((po, idx) => ({
            id: Number.isFinite(Number(po.id)) ? Number(po.id) : Date.now() + idx,
            poNumber: String(po.poNumber ?? ''),
            orderDate: String(po.orderDate ?? new Date().toISOString().split('T')[0]).slice(0, 10),
            qty: clampNonNegativeInt(po.qty ?? 0, '采购数量'),
            prodDays: clampNonNegativeInt(po.prodDays ?? 0, '生产周期'),
            leg1Mode: ['sea', 'air', 'rail'].includes(po.leg1Mode) ? po.leg1Mode : 'sea',
            leg1Days: clampNonNegativeInt(po.leg1Days ?? 0, '头程时效'),
            leg2Mode: ['sea', 'air', 'rail'].includes(po.leg2Mode) ? po.leg2Mode : 'sea',
            leg2Days: clampNonNegativeInt(po.leg2Days ?? 0, '二程时效'),
            leg3Mode: ['sea', 'air', 'rail'].includes(po.leg3Mode) ? po.leg3Mode : 'sea',
            leg3Days: clampNonNegativeInt(po.leg3Days ?? 0, '三程时效'),
            status: validStatuses.includes(po.status) ? po.status : 'ordered',
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
    if (!ensureEditPermission()) return;
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
          const statusMap = { '预下订单': 'pre_order', '已下单': 'ordered', '已取消': 'cancelled', '生产中': 'in_production', '生产完成': 'prod_complete', '头程已发': 'leg1_shipped', '头程到达': 'leg1_arrived', '二程已发': 'leg2_shipped', '二程到达': 'leg2_arrived', '验货中': 'inspecting', '装柜中': 'picking', '保税仓': 'bonded_warehouse', '待上架': 'pending_shelving', '已上架': 'shelved' };
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length < 10) continue;
            const modeMap = { '海运': 'sea', '空运': 'air', '铁路': 'rail' };
            imported.push({
              id: Date.now() + i,
              poNumber: cols[0] || '',
              orderDate: cols[1] || new Date().toISOString().split('T')[0],
              qty: clampNonNegativeInt(cols[2] ?? 0, '采购数量'),
              prodDays: clampNonNegativeInt(cols[3] ?? 0, '生产周期'),
              leg1Mode: modeMap[cols[4]] || 'sea',
              leg1Days: clampNonNegativeInt(cols[5] ?? 0, '头程时效'),
              leg2Mode: modeMap[cols[6]] || 'sea',
              leg2Days: clampNonNegativeInt(cols[7] ?? 0, '二程时效'),
              leg3Mode: modeMap[cols[8]] || 'sea',
              leg3Days: clampNonNegativeInt(cols[9] ?? 0, '三程时效'),
              status: statusMap[cols[10]] || 'ordered',
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
    const rawDailyRates = getMonthlySalesForForecast(sku, today).map(m => Number(m) / 30);
    // 对过去月份 actual=0 的情况，用非零月份的平均日消耗率替代，避免某月不消耗
    const nonZeroRates = rawDailyRates.filter(r => r > 0);
    const avgDailyRate = nonZeroRates.length > 0 ? nonZeroRates.reduce((a, b) => a + b, 0) / nonZeroRates.length : 0;
    const dailyRates = rawDailyRates.map(r => r > 0 ? r : avgDailyRate);
    const monthEndStocks = [];

    for (let i = 0; i <= days; i++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];
      const dailyConsumption = dailyRates[currentDate.getMonth()];
      
      let incomingQty = 0;
      sku.pos?.forEach(po => {
        // 排除已取消和预下单的采购单
        if (po.status === 'cancelled' || po.status === 'pre_order') return;
        const arrival = new Date(po.orderDate);
        if (isNaN(arrival.getTime())) return; // 无效日期跳过
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
      // 常规逻辑：查找第一个库存归零的时刻
      const stockoutIdx = f.data.findIndex(d => d.stock <= 0);
      if (stockoutIdx >= 0) {
        targetDayIndex = stockoutIdx;
      } else {
        // 预测窗口内库存从未归零，用逐月消耗精确计算实际覆盖天数
        const lastStock = f.data[f.data.length - 1].stock;
        const lastDate = new Date(f.data[f.data.length - 1].date);
        const monthlySales = getMonthlySalesForForecast(sku, new Date());
        // 计算非零月份的平均消耗，作为过去月份 actual=0 的备用值
        const nonZero = monthlySales.filter(v => v > 0);
        const avgMonthly = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
        let remaining = lastStock;
        let extraMonths = 0;
        let counter = 120;
        let mIdx = lastDate.getMonth();
        while (remaining > 0 && counter-- > 0) {
          const c = Number(monthlySales[mIdx] || 0) || avgMonthly;
          if (c <= 0) break; // 所有月份都是0，无法计算
          if (remaining >= c) { remaining -= c; extraMonths += 1; }
          else { extraMonths += remaining / c; remaining = 0; }
          mIdx = (mIdx + 1) % 12;
        }
        targetDayIndex = Math.round(((f.data.length - 1) / 30 + extraMonths) * 30);
      }
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
    if (!activeForecast || !activeForecast.data || activeForecast.data.length === 0 || !activeSku) return null;
    const idx = activeForecast.data.findIndex(d => d.stock <= 0);
    if (idx === -1) {
      // 预测窗口内库存从未归零，用逐月消耗精确计算实际覆盖月数
      const lastStock = activeForecast.data[activeForecast.data.length - 1].stock;
      const lastDate = new Date(activeForecast.data[activeForecast.data.length - 1].date);
      const monthlySales = getMonthlySalesForForecast(activeSku, new Date());
      // 计算非零月份的平均消耗，作为过去月份 actual=0 的备用值
      const nonZero = monthlySales.filter(v => v > 0);
      const avgMonthly = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
      let remaining = lastStock;
      let extraMonths = 0;
      let counter = 120; // 安全上限 10 年
      let mIdx = lastDate.getMonth();
      while (remaining > 0 && counter-- > 0) {
        const c = Number(monthlySales[mIdx] || 0) || avgMonthly;
        if (c <= 0) break; // 所有月份都是0，无法计算
        if (remaining >= c) { remaining -= c; extraMonths += 1; }
        else { extraMonths += remaining / c; remaining = 0; }
        mIdx = (mIdx + 1) % 12;
      }
      const forecastMonths = (activeForecast.data.length - 1) / 30;
      const totalMonths = forecastMonths + extraMonths;
      return { safe: true, days: Math.round(totalMonths * 30), months: totalMonths >= 999 ? '999+' : totalMonths.toFixed(1), stockoutDate: null };
    }
    return {
      safe: false,
      days: idx,
      months: (idx / 30).toFixed(1),
      stockoutDate: activeForecast.data[idx].date,
    };
  }, [activeForecast, activeSku]);

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
      getMonthlySalesForForecast(sku, new Date()).forEach((v, i) => {
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

  const hasUnitCost = false;

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
    <div className={`h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col font-sans text-slate-800 text-sm ${viewMode === 'dashboard' ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'}`}>
      {warning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-100 border border-amber-300 text-amber-800 px-6 py-2 rounded-full text-xs font-bold shadow-xl flex items-center gap-2 animate-in slide-in-from-top-2">
          <AlertCircle size={14} className="text-amber-500" />
          <span>{warning}</span>
          <button onClick={() => setWarning('')} className="ml-2 text-amber-600 hover:text-amber-800">
            <X size={12} />
          </button>
        </div>
      )}
      <div className={viewMode === 'dashboard' ? 'bg-slate-100' : 'flex-1 flex bg-slate-100 min-h-0 overflow-hidden'}>
      {viewMode === 'home' ? (
        /* --- 首页 --- */
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
            {/* 顶部栏 */}
            <div className="bg-indigo-950 text-white px-8 py-6">
              <div className="max-w-5xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <Compass size={24} className="text-white"/>
                  </div>
                  <div>
                    <h1 className="text-xl font-black tracking-tight">智策供应链指挥系统</h1>
                    <p className="text-indigo-300 text-xs font-bold mt-0.5">👤 {getUserNickname(user?.email)}{userRoles[currentUserEmail]?.nickname ? ` (${user?.email})` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (!canManagePermissions) {
                        setWarning('仅管理员可打开系统设置');
                        return;
                      }
                      setShowSettings(true);
                    }}
                    className="p-2 hover:bg-indigo-800 rounded-xl transition-colors"
                    title="系统设置"
                  >
                    <Settings size={18} className="text-indigo-300 hover:text-white"/>
                  </button>
                  <button onClick={handleLogout} className="p-2 hover:bg-red-800 rounded-xl transition-colors" title="登出">
                    <LogOut size={18} className="text-indigo-300 hover:text-red-300"/>
                  </button>
                </div>
              </div>
            </div>

            {/* 功能卡片网格 */}
            <div className="max-w-5xl mx-auto px-8 py-10">
              <div className="mb-8">
                <h2 className="text-lg font-black text-slate-800 uppercase tracking-wider">功能导航</h2>
                <p className="text-xs text-slate-500 font-medium mt-1">选择要进入的功能模块</p>
              </div>

              {(() => {
                const navItems = [
                  { key: 'detail', icon: <BarChart3 size={28}/>, label: '指挥中心', desc: 'SKU库存管理、销量预测、采购单跟踪', color: 'from-indigo-500 to-indigo-700', border: 'border-indigo-200', iconBg: 'bg-indigo-100 text-indigo-600' },
                  { key: 'sales', icon: <Calendar size={28}/>, label: '年度销量', desc: '年度销量统计、月度数据分析与预估', color: 'from-slate-600 to-slate-800', border: 'border-slate-200', iconBg: 'bg-slate-100 text-slate-600' },
                  { key: 'offline', icon: <Factory size={28}/>, label: '线下库存', desc: '线下仓库出入库管理、库存流水追踪', color: 'from-amber-500 to-amber-700', border: 'border-amber-200', iconBg: 'bg-amber-100 text-amber-600' },
                  { key: 'recipient-library', icon: <List size={28}/>, label: '客户信息库', desc: '客户收件信息集中管理、快速调取', color: 'from-violet-500 to-violet-700', border: 'border-violet-200', iconBg: 'bg-violet-100 text-violet-600' },
                  { key: 'approval', icon: <Lock size={28}/>, label: '审批中心', desc: '关键操作审批流程、删除请求审批', color: 'from-rose-500 to-rose-700', border: 'border-rose-200', iconBg: 'bg-rose-100 text-rose-600', badge: pendingDeleteApprovals.length },
                  { key: 'dashboard', icon: <Layout size={28}/>, label: '全景大屏', desc: '数据可视化大屏、全局指标总览', color: 'from-emerald-500 to-emerald-700', border: 'border-emerald-200', iconBg: 'bg-emerald-100 text-emerald-600' },
                ];
                const available = navItems.filter(n => hasFeature(n.key));
                if (available.length === 0) {
                  return (
                    <div className="text-center py-20">
                      <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                        <Lock size={36} className="text-slate-400"/>
                      </div>
                      <h3 className="text-lg font-black text-slate-600">暂无可用功能</h3>
                      <p className="text-sm text-slate-400 mt-2">请联系管理员开通功能权限</p>
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {available.map(item => (
                      <button
                        key={item.key}
                        onClick={() => setViewMode(item.key)}
                        className={`group relative bg-white ${item.border} border-2 rounded-2xl p-6 text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-200 active:scale-[0.98]`}
                      >
                        <div className={`w-14 h-14 ${item.iconBg} rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                          {item.icon}
                        </div>
                        <h3 className="text-base font-black text-slate-800 mb-1">{item.label}</h3>
                        <p className="text-xs text-slate-500 font-medium leading-relaxed">{item.desc}</p>
                        {item.badge > 0 && (
                          <span className="absolute top-4 right-4 min-w-6 h-6 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                            {item.badge > 99 ? '99+' : item.badge}
                          </span>
                        )}
                        <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${item.color} rounded-b-2xl opacity-0 group-hover:opacity-100 transition-opacity`}/>
                      </button>
                    ))}
                  </div>
                );
              })()}

              {/* 底部状态 */}
              <div className="mt-10 flex items-center justify-between text-[10px] text-slate-400 font-medium">
                <span>{memoryModeText}</span>
                <span>权限：{currentUserRole === 'admin' ? '管理员' : currentUserRole === 'editor' ? '编辑' : '只读'}</span>
              </div>
            </div>
          </div>
        </div>
      ) : viewMode === 'detail' ? (
        <>
          {/* 侧边栏 */}
          <div className="w-80 bg-white border-r border-slate-200 flex flex-col z-20 flex-shrink-0 h-screen sticky top-0 self-start">
            <div className="p-6 bg-indigo-950 text-white space-y-3">
              {/* 标题行 */}
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-black flex items-center gap-2 tracking-tight"><BarChart3 size={24}/> 智策中心</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!canManagePermissions) {
                        setWarning('仅管理员可打开系统设置');
                        return;
                      }
                      setShowSettings(true);
                    }}
                    className="p-1.5 hover:bg-indigo-800 rounded-lg transition-colors"
                    title="打开设置"
                  ><Settings size={18} className="text-slate-300 hover:text-white"/></button>
                  <button onClick={handleLogout} className="p-1.5 hover:bg-red-800 rounded-lg transition-colors" title="登出"><LogOut size={18} className="text-slate-300 hover:text-red-300"/></button>
                </div>
              </div>

              {/* 状态和说明行 */}
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest italic">{memoryModeText}</p>
                  <p className="text-xs text-indigo-400 font-bold uppercase tracking-wider mt-1 break-words">👤 {getUserNickname(user?.email)}{userRoles[currentUserEmail]?.nickname ? ` (${user?.email})` : ''}</p>
                  <p className="text-[10px] text-indigo-300 font-black mt-1">权限：{currentUserRole === 'admin' ? '管理员' : currentUserRole === 'editor' ? '编辑' : '只读'}</p>
                </div>
                <div className={`px-2.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap inline-block ${
                  syncStatus === 'ready' ? 'bg-emerald-600 text-emerald-100' :
                  syncStatus === 'syncing' ? 'bg-amber-600 text-amber-100 animate-pulse' :
                  syncStatus === 'error' ? 'bg-red-600 text-red-100' :
                  'bg-slate-700 text-slate-300'
                }`}>
                  {syncStatus === 'ready' && '✅ 已同步'}
                  {syncStatus === 'syncing' && '⏳ 同步中'}
                  {syncStatus === 'error' && '❌ 失败'}
                  {syncStatus === 'offline' && '⚠️ 离线'}
                </div>
              </div>
            </div>
            
            {/* 图例说明 */}
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 space-y-2">
              <div className="text-xs font-black text-slate-700 uppercase tracking-widest">图例</div>
              
              {/* 图例指示器 */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-yellow-500" />
                    <span className="text-xs text-slate-700 font-medium">PO到货</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs text-slate-700 font-medium">有货</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-slate-300" />
                    <span className="text-xs text-slate-700 font-medium">断货</span>
                  </div>
                </div>
              </div>
            </div>

            {/* SKU 列表 */}
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
              {hasFeature('sku') && (
              <button onClick={addSku} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase">
                <Plus size={18}/> 新建 SKU
              </button>
              )}
              <button onClick={() => setSideMenuOpen(true)} className="w-full bg-slate-700 text-white py-2.5 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-slate-800 shadow active:scale-95 transition-all text-[11px] tracking-wider uppercase relative">
                <Menu size={16}/> 更多功能
                {hasFeature('approval') && pendingDeleteApprovals.length > 0 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                    {pendingDeleteApprovals.length > 99 ? '99+' : pendingDeleteApprovals.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 侧边抽屉菜单 */}
          {sideMenuOpen && (
            <div className="fixed inset-0 z-50 flex">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSideMenuOpen(false)} />
              <div className="relative w-72 bg-white shadow-2xl flex flex-col animate-slide-in-left">
                <div className="flex items-center justify-between px-5 py-4 border-b">
                  <span className="font-black text-sm text-slate-800 uppercase tracking-wider">功能菜单</span>
                  <button onClick={() => setSideMenuOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                    <ChevronLeft size={20} className="text-slate-500"/>
                  </button>
                </div>
                <div className="flex-1 p-4 space-y-2.5 overflow-y-auto">
                  <button onClick={() => { setViewMode('home'); setSideMenuOpen(false); }} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black flex items-center gap-3 px-4 hover:bg-indigo-700 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase">
                    <Home size={18}/> 返回首页
                  </button>
                  {hasFeature('sales') && (
                  <button onClick={() => { setViewMode('sales'); setSideMenuOpen(false); }} className="w-full bg-slate-800 text-white py-3 rounded-xl font-black flex items-center gap-3 px-4 hover:bg-slate-900 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase">
                    <Calendar size={18}/> 年度销量页
                  </button>
                  )}
                  {hasFeature('offline') && (
                  <button onClick={() => { setViewMode('offline'); setSideMenuOpen(false); }} className="w-full bg-amber-600 text-white py-3 rounded-xl font-black flex items-center gap-3 px-4 hover:bg-amber-700 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase">
                    <Factory size={18}/> 线下库存页
                  </button>
                  )}
                  {hasFeature('recipient-library') && (
                  <button onClick={() => { setViewMode('recipient-library'); setSideMenuOpen(false); }} className="w-full bg-violet-600 text-white py-3 rounded-xl font-black flex items-center gap-3 px-4 hover:bg-violet-700 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase">
                    <List size={18}/> 客户信息库
                  </button>
                  )}
                  {hasFeature('approval') && (
                  <button onClick={() => { setViewMode('approval'); setSideMenuOpen(false); }} className="w-full bg-rose-600 text-white py-3 rounded-xl font-black flex items-center gap-3 px-4 hover:bg-rose-700 shadow-lg active:scale-95 transition-all text-xs tracking-widest uppercase relative">
                    <Lock size={18}/> 审批中心
                    {pendingDeleteApprovals.length > 0 && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 min-w-5 h-5 px-1 rounded-full bg-white text-rose-700 text-[10px] font-black flex items-center justify-center">
                        {pendingDeleteApprovals.length > 99 ? '99+' : pendingDeleteApprovals.length}
                      </span>
                    )}
                  </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 主工作区 */}
          <div className="flex-1 flex flex-col min-w-0">
            <header className="bg-white border-b px-6 py-5 shadow-sm flex-shrink-0">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase italic">{activeSku?.name || '请选择商品'}</h1>
                  <p className="text-[10px] text-slate-400 mt-1 font-bold">系统已自动记住您的每一项修改</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setViewMode('home')} className="px-4 py-3 bg-white border-2 border-slate-200 text-slate-700 rounded-xl font-black flex items-center gap-2 hover:bg-slate-50 shadow-sm active:scale-95 transition-all text-[11px] tracking-wider uppercase whitespace-nowrap">
                    <Home size={16}/> 首页
                  </button>
                  {hasFeature('dashboard') && (
                  <button onClick={() => setViewMode('dashboard')} className="px-4 py-3 bg-indigo-600 text-white rounded-xl font-black flex items-center gap-2 hover:bg-indigo-700 shadow-sm active:scale-95 transition-all text-[11px] tracking-wider uppercase whitespace-nowrap">
                    <Layout size={16}/> 全景大屏
                  </button>
                  )}
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
                               onChange={e => activeSku && updateSku(activeSku.id, 'currentStock', clampNonNegativeInt(e.target.value, '当前库存'))}
                               className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl p-6 font-mono text-3xl font-black focus:border-indigo-500 outline-none transition-all shadow-inner"
                             />
                           </div>
                           {hasFeature('sales') && (
                           <div className="flex items-center gap-3">
                             <button
                               onClick={() => setViewMode('sales')}
                               className="text-xs font-black text-indigo-600 hover:text-indigo-700"
                             >
                               📊 进入年度销量统计与预估页
                             </button>
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
                              <button onClick={() => activeSku && addPO(activeSku.id)} className="bg-indigo-600 text-white p-2 rounded-xl hover:bg-indigo-700 active:scale-90 transition-all shadow-md"><Plus size={18}/></button>
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
                                                <span>头程</span>
                                                <span className="flex items-center gap-1">
                                                  <select value={po.leg1Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg1Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer text-[9px]">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
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
                                                <span>二程</span>
                                                <span className="flex items-center gap-1">
                                                  <select value={po.leg2Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg2Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer text-[9px]">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
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
                                                <span>三程</span>
                                                <span className="flex items-center gap-1">
                                                  <select value={po.leg3Mode} onChange={e => updatePO(activeSku.id, po.id, 'leg3Mode', e.target.value)} className="bg-transparent border-none p-0 cursor-pointer text-[9px]">{transportOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
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

                           {/* 预下订单分组 */}
                           {activeSku?.pos?.some(po => po.status === 'pre_order') && (poFilter === 'all' || poFilter === 'pending') && (
                             <div className="mb-4">
                               <button
                                 onClick={() => setExpandedPoGroups(prev => ({ ...prev, pre_order: !prev.pre_order }))}
                                 className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors font-bold text-sm uppercase tracking-tighter text-slate-600 mb-2"
                               >
                                 <span className={`transition-transform ${expandedPoGroups.pre_order ? 'rotate-90' : ''}`}>▶</span>
                                 📝 预下订单 ({activeSku.pos.filter(p => p.status === 'pre_order').length})
                               </button>
                               {expandedPoGroups.pre_order && (
                                 <div className="space-y-2">
                                   {activeSku?.pos?.filter(po => po.status === 'pre_order').map(po => {
                                     const arrivalDate = new Date(new Date(po.orderDate).getTime() + (Number(po.prodDays) + Number(po.leg1Days) + Number(po.leg2Days) + Number(po.leg3Days)) * 86400000).toLocaleDateString();
                                     const isExpanded = expandedPoId === po.id;
                                     return (
                                     <div key={po.id} className="rounded-xl relative group border border-slate-200 bg-slate-50/50 hover:border-slate-300 transition-all p-3">
                                        <button onClick={() => setExpandedPoId(isExpanded ? null : po.id)} className="w-full flex items-center justify-between hover:opacity-70 transition-opacity">
                                          <span className="flex items-center gap-2 flex-1 text-left">
                                            <span className={`transition-transform text-[10px] ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                            <span className="text-[10px] font-black text-slate-500 uppercase">采购单号 {po.poNumber}</span>
                                          </span>
                                          <span className="text-[11px] font-bold text-slate-600 bg-slate-100 rounded px-2 py-0.5">{po.qty} 件</span>
                                        </button>
                                        {!isExpanded && (
                                          <div className="flex items-center justify-between gap-2 text-[10px] font-bold mt-2 px-1 text-slate-500">
                                            <span>下单 {po.orderDate}</span>
                                            <span>预计到货 {arrivalDate}</span>
                                            <span className="text-[9px] bg-slate-100 rounded px-1.5 py-0.5">预下订单</span>
                                          </div>
                                        )}
                                        {isExpanded && (
                                          <div className="mt-3 space-y-2 border-t pt-3">
                                            <div className="grid grid-cols-2 gap-2">
                                              <div className="text-[10px] text-slate-500 font-bold">下单日期: {po.orderDate}</div>
                                              <div className="text-[10px] text-slate-500 font-bold">预计到货: {arrivalDate}</div>
                                              <div className="text-[10px] text-slate-500 font-bold">采购数量: {po.qty}</div>
                                              <div className="text-[10px] text-slate-500 font-bold">生产周期: {po.prodDays}天</div>
                                            </div>
                                            <div className="flex items-center gap-1 pt-1">
                                              <select value={po.status} onChange={e => updatePO(activeSku.id, po.id, 'status', e.target.value)} className="text-[10px] border rounded px-2 py-1 font-bold">
                                                {['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'].map(s => (
                                                  <option key={s} value={s}>{['预下订单', '已下单', '取消订单', '生产中', '生产完成', '头程发货', '头程到货', '二程发货', '二程到货', '查验中', '提货中', '到达保税仓', '待理货上架', '已理货上架'][['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'].indexOf(s)]}</option>
                                                ))}
                                              </select>
                                              <button onClick={() => removePO(activeSku.id, po.id)} className="text-[10px] text-rose-500 hover:text-rose-700 font-bold px-2 py-1 rounded hover:bg-rose-50">删除</button>
                                            </div>
                                          </div>
                                        )}
                                     </div>
                                     );
                                   })}
                                 </div>
                               )}
                             </div>
                           )}

                           {/* 已取消分组 */}
                           {activeSku?.pos?.some(po => po.status === 'cancelled') && (poFilter === 'all') && (
                             <div className="mb-4">
                               <button
                                 onClick={() => setExpandedPoGroups(prev => ({ ...prev, cancelled: !prev.cancelled }))}
                                 className="w-full flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors font-bold text-sm uppercase tracking-tighter text-rose-600 mb-2"
                               >
                                 <span className={`transition-transform ${expandedPoGroups.cancelled ? 'rotate-90' : ''}`}>▶</span>
                                 ✕ 已取消 ({activeSku.pos.filter(p => p.status === 'cancelled').length})
                               </button>
                               {expandedPoGroups.cancelled && (
                                 <div className="space-y-2">
                                   {activeSku?.pos?.filter(po => po.status === 'cancelled').map(po => (
                                     <div key={po.id} className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 flex items-center justify-between">
                                       <div>
                                         <span className="text-[10px] font-black text-slate-500 uppercase">采购单号 {po.poNumber}</span>
                                         <span className="text-[10px] text-slate-400 ml-3">数量 {po.qty} · 下单 {po.orderDate}</span>
                                       </div>
                                       <div className="flex items-center gap-2">
                                         <select value={po.status} onChange={e => updatePO(activeSku.id, po.id, 'status', e.target.value)} className="text-[10px] border rounded px-2 py-1 font-bold">
                                           {['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'].map(s => (
                                             <option key={s} value={s}>{['预下订单', '已下单', '取消订单', '生产中', '生产完成', '头程发货', '头程到货', '二程发货', '二程到货', '查验中', '提货中', '到达保税仓', '待理货上架', '已理货上架'][['pre_order', 'ordered', 'cancelled', 'in_production', 'prod_complete', 'leg1_shipped', 'leg1_arrived', 'leg2_shipped', 'leg2_arrived', 'inspecting', 'picking', 'bonded_warehouse', 'pending_shelving', 'shelved'].indexOf(s)]}</option>
                                           ))}
                                         </select>
                                         <button onClick={() => removePO(activeSku.id, po.id)} className="text-[10px] text-rose-500 hover:text-rose-700 font-bold px-2 py-1 rounded hover:bg-rose-50">删除</button>
                                       </div>
                                     </div>
                                   ))}
                                 </div>
                               )}
                             </div>
                           )}
                        </div>
                     </div>
                  </div>

                  {/* 推演线性表 */}
                  <div className="col-span-8 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-0 h-[calc(100vh-220px)] sticky top-6 self-start">
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
                     <div className="flex-1 overflow-y-scroll overflow-x-auto px-4 min-h-0">
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
      ) : viewMode === 'sales' ? (
        <div className="flex-1 flex flex-col p-6 bg-slate-50 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">年度销量统计与预估</h1>
              <p className="text-xs text-slate-500 font-bold mt-1">过去月份未填按 0 入模 · 缺失值显示为“未填”</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode('home')}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100"
              >
                返回首页
              </button>
              {hasFeature('dashboard') && (
              <button
                onClick={() => setViewMode('dashboard')}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700"
              >
                战略全景大屏
              </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-black text-slate-500 uppercase tracking-wider">年份</span>
              <select
                value={salesSelectedYear}
                onChange={e => setSalesSelectedYear(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold text-slate-700"
              >
                {salesYearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <button
                onClick={createNextSalesYear}
                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700"
              >
                + 新年份（复制上一年预估）
              </button>
            </div>
            <button
              onClick={() => setShowQuickFill(true)}
              className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-black hover:bg-indigo-100"
            >
              ⚡ 快速填充当前 SKU 预测
            </button>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr] gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-3 overflow-y-auto">
              <div className="text-[11px] font-black text-slate-500 uppercase tracking-wider px-2 pb-2">SKU 列表</div>
              <div className="space-y-2">
                {skus.map(sku => {
                  const selected = (selectedSkuId || skus[0]?.id) === sku.id;
                  return (
                    <button
                      key={sku.id}
                      onClick={() => setSelectedSkuId(sku.id)}
                      className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${selected ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                    >
                      <div className="text-sm font-black text-slate-800 truncate">{sku.name}</div>
                      <div className="text-[10px] font-bold text-slate-500 mt-1">ID: {sku.id}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 overflow-hidden flex flex-col min-h-0">
              {!activeSalesSku ? (
                <div className="text-sm text-slate-400 font-bold">暂无 SKU 数据</div>
              ) : (
                (() => {
                  const yearKey = String(salesSelectedYear);
                  const rawCells = activeSalesSku.salesByYear?.[yearKey] || createEmptyYearSales(null);
                  const yearCells = Array.from({ length: 12 }).map((_, i) => normalizeSalesCell(rawCells[i]));
                  const now = new Date();
                  const nowYear = now.getFullYear();
                  const nowMonth = now.getMonth();
                  const isCurrentYear = Number(salesSelectedYear) === nowYear;

                  const pastActualTotal = yearCells.reduce((sum, cell, idx) => {
                    const isPast = !isCurrentYear || idx < nowMonth;
                    if (!isPast) return sum;
                    return sum + (Number.isFinite(Number(cell.actual)) ? Number(cell.actual) : 0);
                  }, 0);

                  const futureForecastTotal = yearCells.reduce((sum, cell, idx) => {
                    const isFuture = !isCurrentYear ? false : idx >= nowMonth;
                    if (!isFuture) return sum;
                    return sum + (Number.isFinite(Number(cell.forecast)) ? Number(cell.forecast) : 0);
                  }, 0);

                  const yearProjectionTotal = yearCells.reduce((sum, cell, idx) => {
                    const useActual = !isCurrentYear || idx < nowMonth;
                    if (useActual) {
                      return sum + (Number.isFinite(Number(cell.actual)) ? Number(cell.actual) : 0);
                    }
                    return sum + (Number.isFinite(Number(cell.forecast)) ? Number(cell.forecast) : 0);
                  }, 0);

                  const missingPastCount = yearCells.filter((cell, idx) => (!isCurrentYear || idx < nowMonth) && !Number.isFinite(Number(cell.actual))).length;
                  const missingFutureCount = yearCells.filter((cell, idx) => isCurrentYear && idx >= nowMonth && !Number.isFinite(Number(cell.forecast))).length;

                  return (
                    <>
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-black text-slate-800">{activeSalesSku.name}</h3>
                          <p className="text-[11px] text-slate-500 font-bold">{salesSelectedYear} 年月度销量台账（实际 + 预测）</p>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-slate-500 font-bold">过去未填按 0 计入推演</div>
                          <div className="text-[11px] text-slate-500 font-bold">未来未填保持“未填”</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-3 mb-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-black text-slate-500 uppercase">已发生累计</div>
                          <div className="text-xl font-black text-slate-800">{Math.round(pastActualTotal).toLocaleString()}</div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-black text-slate-500 uppercase">未来预测累计</div>
                          <div className="text-xl font-black text-indigo-700">{Math.round(futureForecastTotal).toLocaleString()}</div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-black text-slate-500 uppercase">全年合计（推演口径）</div>
                          <div className="text-xl font-black text-emerald-700">{Math.round(yearProjectionTotal).toLocaleString()}</div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-black text-slate-500 uppercase">未填</div>
                          <div className="text-sm font-black text-amber-700">历史 {missingPastCount} · 未来 {missingFutureCount}</div>
                        </div>
                      </div>

                      <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left border-collapse min-w-[760px]">
                          <thead className="sticky top-0 bg-slate-50 z-10">
                            <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                              <th className="p-3 font-black">月份</th>
                              <th className="p-3 font-black text-center">实际销量</th>
                              <th className="p-3 font-black text-center">预测销量</th>
                              <th className="p-3 font-black text-center">推演采用值</th>
                              <th className="p-3 font-black text-center">状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {yearCells.map((cell, idx) => {
                              const isPast = !isCurrentYear || idx < nowMonth;
                              const actualValue = Number.isFinite(Number(cell.actual)) ? Number(cell.actual) : null;
                              const forecastValue = Number.isFinite(Number(cell.forecast)) ? Number(cell.forecast) : null;
                              const usedValue = isPast ? (actualValue ?? 0) : (forecastValue ?? 0);
                              const statusText = isPast
                                ? (actualValue === null ? '未填（按0入模）' : '已填实际')
                                : (forecastValue === null ? '未填' : '已填预测');

                              return (
                                <tr key={idx} className="border-t border-slate-100">
                                  <td className="p-3 font-bold text-slate-700">{MONTH_LABELS[idx]}</td>
                                  <td className="p-3 text-center">
                                    <input
                                      type="number"
                                      value={actualValue ?? ''}
                                      onChange={e => setSalesCellValue(activeSalesSku.id, salesSelectedYear, idx, 'actual', e.target.value)}
                                      placeholder="未填"
                                      className="w-28 text-center border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-bold"
                                    />
                                  </td>
                                  <td className="p-3 text-center">
                                    <input
                                      type="number"
                                      value={forecastValue ?? ''}
                                      onChange={e => setSalesCellValue(activeSalesSku.id, salesSelectedYear, idx, 'forecast', e.target.value)}
                                      placeholder="未填"
                                      className="w-28 text-center border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-bold"
                                    />
                                  </td>
                                  <td className="p-3 text-center font-black text-indigo-700">{Math.round(usedValue).toLocaleString()}</td>
                                  <td className="p-3 text-center text-xs font-bold text-slate-500">{statusText}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      ) : viewMode === 'offline' ? (
        <div className="flex-1 flex flex-col p-6 bg-slate-50 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">线下库存管理中心</h1>
              <p className="text-xs text-slate-500 font-bold mt-1">管理消费者退回库存等不可回保税仓货物，独立于保税仓库存系统</p>
            </div>
            <div className="flex items-center gap-3">
              {hasFeature('recipient-library') && <button onClick={() => setViewMode('recipient-library')} className="px-4 py-2 rounded-xl bg-violet-600 text-white font-bold text-xs hover:bg-violet-700">客户信息库</button>}
              <button onClick={() => setViewMode('home')} className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100">返回首页</button>
              {hasFeature('dashboard') && <button onClick={() => setViewMode('dashboard')} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700">战略全景大屏</button>}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-4 mb-5">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">线下品项数</div>
              <div className="text-2xl font-black text-slate-800">{offlineInventorySummary.itemCount}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">现有库存总数</div>
              <div className="text-2xl font-black text-indigo-700">{Math.round(offlineInventorySummary.currentTotal).toLocaleString()}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">累计入库</div>
              <div className="text-2xl font-black text-emerald-700">{Math.round(offlineInventorySummary.inboundTotal).toLocaleString()}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">累计出库</div>
              <div className="text-2xl font-black text-rose-700">{Math.round(offlineInventorySummary.outboundTotal).toLocaleString()}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">客户 / 收件信息</div>
              <div className="text-2xl font-black text-violet-700">{offlineRecipientSummary.customerCount} / {offlineRecipientSummary.profileCount}</div>
            </div>
          </div>

          <div className="grid grid-cols-[360px_1fr] gap-6 flex-1 min-h-0">
            <div className="space-y-4 overflow-y-auto pr-1">
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <h3 className="text-sm font-black text-slate-800 mb-3">新增线下库存品项</h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={offlineItemName}
                    onChange={e => setOfflineItemName(e.target.value)}
                    placeholder="品项名称（如：退货A批次）"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                  />
                  <input
                    type="number"
                    value={offlineItemStock}
                    onChange={e => setOfflineItemStock(e.target.value)}
                    placeholder="现有库存（初始化）"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                  />
                  <textarea
                    value={offlineItemRemark}
                    onChange={e => setOfflineItemRemark(e.target.value)}
                    placeholder="备注（可选）"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium h-20 resize-none"
                  />
                  <button
                    onClick={addOfflineInventoryItem}
                    className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-black text-xs hover:bg-indigo-700"
                  >
                    + 新增品项
                  </button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <h3 className="text-sm font-black text-slate-800 mb-3">入库 / 出库登记</h3>
                <div className="space-y-3">
                  <select
                    value={offlineTxItemId}
                    onChange={e => {
                      setOfflineTxItemId(e.target.value);
                      setOfflineSelectedItemId(Number(e.target.value));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                  >
                    {offlineInventoryItems.length === 0 ? (
                      <option value="">请先新增线下库存品项</option>
                    ) : (
                      offlineInventoryItems.map(item => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))
                    )}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setOfflineTxType('in')}
                      className={`py-2 rounded-lg text-xs font-black border ${offlineTxType === 'in' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300'}`}
                    >入库</button>
                    <button
                      onClick={() => setOfflineTxType('out')}
                      className={`py-2 rounded-lg text-xs font-black border ${offlineTxType === 'out' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300'}`}
                    >出库</button>
                  </div>
                  {offlineTxType === 'out' && (
                    <select
                      value={offlineTxPurpose}
                      onChange={e => setOfflineTxPurpose(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                    >
                      {PURPOSE_OPTIONS.map(p => (
                        <option key={p.key} value={p.key}>用途：{p.label}</option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    value={offlineTxQty}
                    onChange={e => setOfflineTxQty(e.target.value)}
                    placeholder="数量"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                  />
                  {offlineTxType === 'out' && offlineTxPurpose === 'sample' && (
                    <>
                      <select
                        value={offlineTxCustomerId}
                        onChange={e => setOfflineTxCustomerId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                      >
                        {offlineRecipientDirectory.length === 0 ? (
                          <option value="">请先在客户信息库新增客户</option>
                        ) : (
                          offlineRecipientDirectory.map(customer => (
                            <option key={customer.id} value={customer.id}>{`${customer.platform || '未填平台'} / ${customer.name} / ${customer.identity || '-'}`}</option>
                          ))
                        )}
                      </select>
                      <select
                        value={offlineTxProfileId}
                        onChange={e => setOfflineTxProfileId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                      >
                        {!offlineTxSelectedCustomer || (offlineTxSelectedCustomer.profiles || []).length === 0 ? (
                          <option value="">该客户暂无收件信息，请先新增</option>
                        ) : (
                          (offlineTxSelectedCustomer.profiles || []).map(profile => (
                            <option key={profile.id} value={profile.id}>{`${profile.label} · ${profile.receiver || '-'} · ${profile.phone || '-'} · ${profile.address}`}</option>
                          ))
                        )}
                      </select>
                      <input
                        type="text"
                        value={offlineTxTrackingNo}
                        onChange={e => setOfflineTxTrackingNo(e.target.value)}
                        placeholder="快递单号"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"
                      />
                    </>
                  )}
                  <input
                    type="text"
                    value={String(user?.email || '')}
                    readOnly
                    className="w-full px-3 py-2 border border-slate-200 bg-slate-100 rounded-lg text-sm font-semibold text-slate-600"
                  />
                  <textarea
                    value={offlineTxRemark}
                    onChange={e => setOfflineTxRemark(e.target.value)}
                    placeholder="备注"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium h-20 resize-none"
                  />
                  <button
                    onClick={recordOfflineInventoryTx}
                    className="w-full bg-amber-600 text-white py-2.5 rounded-lg font-black text-xs hover:bg-amber-700"
                  >
                    记录本次{offlineTxType === 'in' ? '入库' : '出库'}（操作人：{getUserNickname(user?.email) || '未登录'})
                  </button>
                  {offlineTxType === 'out' && offlineTxPurpose === 'sample' && (
                    <div className="text-[10px] text-slate-500 font-medium bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                      同一客户同一快递单可连续登记多种 SKU：保持客户和单号不变，逐个切 SKU 录入出库数量即可。
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-violet-200 rounded-2xl p-4">
                <div className="text-sm font-black text-violet-800">客户信息维护已迁移至独立页面</div>
                <div className="text-xs text-violet-600 font-medium mt-2">点击上方「客户信息库」按钮维护平台、姓名、职位/身份、手机号与地址。</div>
              </div>
            </div>

            <div className="grid grid-rows-[auto_1fr] gap-4 min-h-0">
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black text-slate-700">线下库存总览</h3>
                  <input
                    type="text"
                    value={offlineOverviewQuery}
                    onChange={e => setOfflineOverviewQuery(e.target.value)}
                    placeholder="搜索品项"
                    className="w-56 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium"
                  />
                </div>
                <div className="overflow-auto max-h-[260px]">
                  <table className="w-auto min-w-[420px] text-left text-xs">
                    <colgroup>
                      <col style={{ width: '240px' }} />
                      <col style={{ width: '140px' }} />
                      <col style={{ width: '96px' }} />
                    </colgroup>
                    <thead className="sticky top-0 bg-white border-b text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-3">品项</th>
                        <th className="px-4 py-3 text-right">现有库存</th>
                        <th className="px-4 py-3 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredOfflineInventoryItems.length === 0 ? (
                        <tr><td className="px-4 py-8 text-center text-slate-400 italic" colSpan={3}>暂无线下库存品项</td></tr>
                      ) : filteredOfflineInventoryItems.map(item => (
                        <tr
                          key={item.id}
                          onClick={() => {
                            setOfflineSelectedItemId(item.id);
                            setOfflineTxItemId(String(item.id));
                          }}
                          className={`cursor-pointer hover:bg-slate-50 ${Number(offlineSelectedItemId) === Number(item.id) ? 'bg-indigo-50' : ''}`}
                        >
                          <td className="px-4 py-3 font-bold text-slate-700">{item.name}</td>
                          <td className="px-4 py-3 text-right font-black text-indigo-700">{Math.round(item.currentStock).toLocaleString()}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteOfflineInventoryItem(item.id);
                              }}
                              disabled={!canEditData}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-bold ${canEditData ? 'border-rose-300 text-rose-700 hover:bg-rose-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                              <Trash2 size={12} /> 删除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col min-h-0">
                <div className="px-4 py-3 border-b bg-slate-50">
                  <h3 className="text-sm font-black text-slate-700">SKU 明细流水 + 全局出库汇总</h3>
                </div>
                <div className="flex-1 overflow-hidden grid grid-cols-2 min-h-0">
                  <div className="border-r border-slate-200 flex flex-col min-h-0">
                    <div className="px-4 py-2 border-b bg-slate-50/80 text-xs font-black text-slate-600">
                      {offlineSelectedItem ? `${offlineSelectedItem.name} 的出入库记录` : '请选择 SKU 查看明细'}
                    </div>
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-white border-b text-slate-500 uppercase">
                          <tr>
                            <th className="px-4 py-3">时间</th>
                            <th className="px-4 py-3">类型</th>
                            <th className="px-4 py-3">用途</th>
                            <th className="px-4 py-3 text-right">数量</th>
                            <th className="px-4 py-3">操作账号</th>
                            <th className="px-4 py-3">客户 / 收件</th>
                            <th className="px-4 py-3">快递单号</th>
                            <th className="px-4 py-3">备注</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selectedOfflineLogs.length === 0 ? (
                            <tr><td className="px-4 py-8 text-center text-slate-400 italic" colSpan={8}>该 SKU 暂无记录</td></tr>
                          ) : selectedOfflineLogs.map(log => (
                            <tr key={`selected-${log.id}`} className="hover:bg-slate-50">
                              <td className="px-4 py-3 text-slate-500 font-mono">{new Date(log.happenedAt).toLocaleString()}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded text-[10px] font-black ${log.type === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                  {log.type === 'in' ? '入库' : '出库'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-600">
                                {log.type === 'in' ? '补货入库' : getPurposeLabel(log.purpose)}
                              </td>
                              <td className="px-4 py-3 text-right font-black">{Math.round(log.qty).toLocaleString()}</td>
                              <td className="px-4 py-3 text-slate-600">{log.account || '-'}</td>
                              <td className="px-4 py-3 text-slate-600">{log.customerName ? `${log.customerPlatform || '-'} / ${log.customerName} / ${log.customerIdentity || '-'} / ${log.customerPhone || '-'} / ${log.profileAddress || '-'}` : '-'}</td>
                              <td className="px-4 py-3 text-slate-600 font-mono">{log.trackingNo || '-'}</td>
                              <td className="px-4 py-3 text-slate-500">{log.remark || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex flex-col min-h-0">
                    <div className="px-4 py-2 border-b bg-slate-50/80 text-xs font-black text-slate-600">全局出库汇总记录</div>
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-white border-b text-slate-500 uppercase">
                          <tr>
                            <th className="px-4 py-3">时间</th>
                            <th className="px-4 py-3">SKU</th>
                            <th className="px-4 py-3">用途</th>
                            <th className="px-4 py-3 text-right">出库数量</th>
                            <th className="px-4 py-3">操作账号</th>
                            <th className="px-4 py-3">客户 / 收件</th>
                            <th className="px-4 py-3">快递单号</th>
                            <th className="px-4 py-3">备注</th>
                            {canManagePermissions && <th className="px-4 py-3 text-center">操作</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {offlineOutboundSummaryLogs.length === 0 ? (
                            <tr><td className="px-4 py-8 text-center text-slate-400 italic" colSpan={canManagePermissions ? 9 : 8}>暂无出库汇总记录</td></tr>
                          ) : offlineOutboundSummaryLogs.map(log => (
                            <tr key={`out-${log.id}`} className="hover:bg-slate-50">
                              <td className="px-4 py-3 text-slate-500 font-mono">{new Date(log.happenedAt).toLocaleString()}</td>
                              <td className="px-4 py-3 font-bold text-slate-700">{log.itemName}</td>
                              <td className="px-4 py-3 text-slate-600">{getPurposeLabel(log.purpose)}</td>
                              <td className="px-4 py-3 text-right font-black text-rose-700">{Math.round(log.qty).toLocaleString()}</td>
                              <td className="px-4 py-3 text-slate-600">{log.account || '-'}</td>
                              <td className="px-4 py-3 text-slate-600">{log.customerName ? `${log.customerPlatform || '-'} / ${log.customerName} / ${log.customerIdentity || '-'} / ${log.customerPhone || '-'} / ${log.profileAddress || '-'}` : '-'}</td>
                              <td className="px-4 py-3 text-slate-600 font-mono">{log.trackingNo || '-'}</td>
                              <td className="px-4 py-3 text-slate-500">{log.remark || '-'}</td>
                              {canManagePermissions && (
                                <td className="px-4 py-3 text-center">
                                  <button onClick={() => setEditingOfflineLog({ ...log })} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors text-[10px] font-black">
                                    编辑
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 编辑出库记录弹窗 */}
          {editingOfflineLog && canManagePermissions && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingOfflineLog(null)}/>
              <div className="relative bg-white rounded-2xl shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <h3 className="text-sm font-black text-slate-800">编辑出库记录</h3>
                  <button onClick={() => setEditingOfflineLog(null)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16}/></button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">SKU 名称</label>
                      <input type="text" value={editingOfflineLog.itemName || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, itemName: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">出库数量</label>
                      <input type="number" value={editingOfflineLog.qty || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, qty: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">用途</label>
                      <select value={editingOfflineLog.purpose || 'normal'} onChange={e => setEditingOfflineLog(prev => ({ ...prev, purpose: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium">
                        {PURPOSE_OPTIONS.map(p => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">操作账号</label>
                      <input type="text" value={editingOfflineLog.account || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, account: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">客户名称</label>
                      <input type="text" value={editingOfflineLog.customerName || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, customerName: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">客户平台</label>
                      <input type="text" value={editingOfflineLog.customerPlatform || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, customerPlatform: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">客户身份</label>
                      <input type="text" value={editingOfflineLog.customerIdentity || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, customerIdentity: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">客户电话</label>
                      <input type="text" value={editingOfflineLog.customerPhone || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, customerPhone: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">收件地址</label>
                    <input type="text" value={editingOfflineLog.profileAddress || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, profileAddress: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">快递单号</label>
                      <input type="text" value={editingOfflineLog.trackingNo || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, trackingNo: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">时间</label>
                      <input type="text" value={editingOfflineLog.happenedAt || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, happenedAt: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium"/>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">备注</label>
                    <textarea value={editingOfflineLog.remark || ''} onChange={e => setEditingOfflineLog(prev => ({ ...prev, remark: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium h-16 resize-none"/>
                  </div>
                </div>
                <div className="flex items-center justify-between px-6 py-4 border-t bg-slate-50 rounded-b-2xl">
                  <button onClick={() => deleteOfflineLog(editingOfflineLog.id)} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-xs font-black">
                    删除记录
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingOfflineLog(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-xs font-bold">
                      取消
                    </button>
                    <button onClick={saveEditingOfflineLog} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-xs font-black">
                      保存修改
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : viewMode === 'recipient-library' ? (
        <div className="flex-1 flex flex-col p-6 bg-slate-50 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">客户信息库</h1>
              <p className="text-xs text-slate-500 font-bold mt-1">维护寄样所需客户信息：平台、姓名、职位/身份、手机号、地址</p>
            </div>
            <div className="flex items-center gap-3">
              {hasFeature('offline') && <button onClick={() => setViewMode('offline')} className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold text-xs hover:bg-amber-700">返回线下库存</button>}
              <button onClick={() => setViewMode('home')} className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100">返回首页</button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">客户数</div>
              <div className="text-2xl font-black text-violet-700">{offlineRecipientSummary.customerCount}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">地址信息数</div>
              <div className="text-2xl font-black text-indigo-700">{offlineRecipientSummary.profileCount}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[10px] font-black text-slate-500 uppercase">可用于寄样出库</div>
              <div className="text-2xl font-black text-emerald-700">{offlineRecipientSummary.profileCount > 0 ? '是' : '否'}</div>
            </div>
          </div>

          <div className="grid grid-cols-[380px_1fr] gap-6 flex-1 min-h-0">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 overflow-y-auto space-y-3">
              <h3 className="text-sm font-black text-slate-800">新增客户</h3>
              <input type="text" value={offlineCustomerPlatform} onChange={e => setOfflineCustomerPlatform(e.target.value)} placeholder="平台（如：Amazon / TikTok / 独立站）" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
              <input type="text" value={offlineCustomerName} onChange={e => setOfflineCustomerName(e.target.value)} placeholder="姓名 *" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
              <input type="text" value={offlineCustomerIdentity} onChange={e => setOfflineCustomerIdentity(e.target.value)} placeholder="职位/身份" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
              <input type="text" value={offlineCustomerPhone} onChange={e => setOfflineCustomerPhone(e.target.value)} placeholder="手机号" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
              <textarea value={offlineCustomerRemark} onChange={e => setOfflineCustomerRemark(e.target.value)} placeholder="备注（可选）" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium h-16 resize-none" />

              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs font-black text-slate-700 mb-2">地址信息（可选，可后续补充）</div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input type="text" value={offlineProfileLabel} onChange={e => setOfflineProfileLabel(e.target.value)} placeholder="地址标签（如：公司/仓库）" className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                  <input type="text" value={offlineProfileReceiver} onChange={e => setOfflineProfileReceiver(e.target.value)} placeholder="收件人" className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                  <input type="text" value={offlineProfilePhone} onChange={e => setOfflineProfilePhone(e.target.value)} placeholder="收件手机号" className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                  <input type="text" value={offlineProfileRemark} onChange={e => setOfflineProfileRemark(e.target.value)} placeholder="地址备注（可选）" className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                </div>
                <textarea value={offlineProfileAddress} onChange={e => setOfflineProfileAddress(e.target.value)} placeholder="详细地址" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium h-16 resize-none" />
              </div>

              <button onClick={addOfflineRecipientCustomer} className="w-full bg-violet-600 text-white py-2.5 rounded-lg font-black text-xs hover:bg-violet-700">+ 新增客户</button>

              {offlineSelectedCustomerId && (
                <>
                  <div className="pt-2 border-t border-slate-200">
                    <div className="text-xs font-black text-slate-700 mb-2">{offlineEditingProfileId ? '编辑地址' : '给当前选中客户新增地址'}</div>
                  </div>
                  <button
                    onClick={addOfflineRecipientProfile}
                    disabled={!offlineSelectedCustomerId}
                    className={`w-full py-2 rounded-lg font-black text-xs ${offlineEditingProfileId ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-slate-700 text-white hover:bg-slate-800'}`}
                  >{offlineEditingProfileId ? '保存地址修改' : '+ 给当前客户新增地址'}</button>
                  {offlineEditingProfileId ? (
                    <button onClick={cancelEditOfflineRecipientProfile} className="w-full bg-slate-100 text-slate-700 py-1.5 rounded-lg font-black text-xs hover:bg-slate-200">取消地址编辑</button>
                  ) : null}
                </>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 overflow-hidden flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-black text-slate-800">客户清单</h3>
                <input type="text" value={offlineRecipientQuery} onChange={e => setOfflineRecipientQuery(e.target.value)} placeholder="筛选：平台 / 姓名 / 身份 / 手机 / 地址" className="w-80 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium" />
              </div>
              <div className="flex-1 min-h-0 mb-3 overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">平台</th>
                      <th className="px-3 py-2">姓名</th>
                      <th className="px-3 py-2">职位/身份</th>
                      <th className="px-3 py-2">手机号</th>
                      <th className="px-3 py-2 text-right">地址数</th>
                      <th className="px-3 py-2 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredOfflineRecipients.length === 0 ? (
                      <tr><td className="px-3 py-6 text-center text-slate-400 italic" colSpan={6}>无匹配客户</td></tr>
                    ) : filteredOfflineRecipients.map(customer => (
                      <tr
                        key={`recipient-${customer.id}`}
                        onClick={() => { setOfflineSelectedCustomerId(String(customer.id)); setOfflineEditingProfileId(''); setOfflineProfileLabel(''); setOfflineProfileReceiver(''); setOfflineProfilePhone(''); setOfflineProfileAddress(''); setOfflineProfileRemark(''); }}
                        className={`cursor-pointer hover:bg-slate-50 ${String(offlineSelectedCustomerId) === String(customer.id) ? 'bg-indigo-50' : ''}`}
                      >
                        <td className="px-3 py-2 text-slate-600">{customer.platform || '-'}</td>
                        <td className="px-3 py-2 font-bold text-slate-700">{customer.name || '-'}</td>
                        <td className="px-3 py-2 text-slate-600">{customer.identity || '-'}</td>
                        <td className="px-3 py-2 text-slate-600">{customer.phone || '-'}</td>
                        <td className="px-3 py-2 text-right font-black text-indigo-700">{(customer.profiles || []).length}</td>
                        <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEditCustomerModal(customer.id)} disabled={!canEditData} className={`px-2 py-1 rounded border text-[11px] font-bold mr-1 ${canEditData ? 'border-indigo-300 text-indigo-700 hover:bg-indigo-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}>编辑</button>
                          <button onClick={() => deleteOfflineRecipientCustomer(customer.id)} disabled={!canEditData} className={`px-2 py-1 rounded border text-[11px] font-bold ${canEditData ? 'border-rose-300 text-rose-700 hover:bg-rose-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="text-xs font-black text-slate-700 mb-2">{offlineSelectedCustomer ? `${offlineSelectedCustomer.name} 的地址` : '选择客户查看地址'}</h4>
              {offlineEditingProfileId ? (
                <div className="text-[11px] text-amber-700 font-bold mb-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                  正在编辑地址，修改后请点击左侧「保存地址修改」按钮。
                </div>
              ) : null}
              <div className="max-h-44 overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">标签</th>
                      <th className="px-3 py-2">收件人</th>
                      <th className="px-3 py-2">手机号</th>
                      <th className="px-3 py-2">地址</th>
                      <th className="px-3 py-2 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {!offlineSelectedCustomer || (offlineSelectedCustomer.profiles || []).length === 0 ? (
                      <tr><td className="px-3 py-6 text-center text-slate-400 italic" colSpan={5}>暂无地址信息</td></tr>
                    ) : (offlineSelectedCustomer.profiles || []).map(profile => (
                      <tr key={profile.id} className={String(offlineEditingProfileId) === String(profile.id) ? 'bg-amber-50 ring-1 ring-amber-300' : ''}>
                        <td className="px-3 py-2 font-bold text-slate-700">{profile.label || '-'}{String(offlineEditingProfileId) === String(profile.id) ? <span className="ml-1 text-[10px] text-amber-600 font-black">(编辑中)</span> : null}</td>
                        <td className="px-3 py-2 text-slate-600">{profile.receiver || '-'}</td>
                        <td className="px-3 py-2 text-slate-600">{profile.phone || '-'}</td>
                        <td className="px-3 py-2 text-slate-600">{profile.address || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => startEditOfflineRecipientProfile(offlineSelectedCustomer.id, profile.id)} disabled={!canEditData} className={`px-2 py-1 rounded border text-[11px] font-bold mr-1 ${canEditData ? 'border-indigo-300 text-indigo-700 hover:bg-indigo-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}>编辑</button>
                          <button onClick={() => deleteOfflineRecipientProfile(offlineSelectedCustomer.id, profile.id)} disabled={!canEditData} className={`px-2 py-1 rounded border text-[11px] font-bold ${canEditData ? 'border-rose-300 text-rose-700 hover:bg-rose-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {editingCustomerModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditingCustomerModal(null)}>
              <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-slate-800">编辑客户信息</h3>
                <input type="text" value={editingCustomerModal.platform} onChange={e => setEditingCustomerModal(prev => ({ ...prev, platform: e.target.value }))} placeholder="平台" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                <input type="text" value={editingCustomerModal.name} onChange={e => setEditingCustomerModal(prev => ({ ...prev, name: e.target.value }))} placeholder="姓名 *" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                <input type="text" value={editingCustomerModal.identity} onChange={e => setEditingCustomerModal(prev => ({ ...prev, identity: e.target.value }))} placeholder="职位/身份" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                <input type="text" value={editingCustomerModal.phone} onChange={e => setEditingCustomerModal(prev => ({ ...prev, phone: e.target.value }))} placeholder="手机号" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium" />
                <textarea value={editingCustomerModal.remark} onChange={e => setEditingCustomerModal(prev => ({ ...prev, remark: e.target.value }))} placeholder="备注（可选）" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium h-20 resize-none" />
                <div className="flex gap-3">
                  <button onClick={() => setEditingCustomerModal(null)} className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-lg font-black text-xs hover:bg-slate-200">取消</button>
                  <button onClick={saveEditCustomerModal} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg font-black text-xs hover:bg-indigo-700">保存修改</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : viewMode === 'approval' ? (
        <div className="flex-1 flex flex-col p-6 bg-slate-50 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">审批中心</h1>
              <p className="text-xs text-slate-500 font-bold mt-1">删除、编辑等重要操作需经管理员审批后执行</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setViewMode('home')} className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100">返回首页</button>
              {hasFeature('dashboard') && <button onClick={() => setViewMode('dashboard')} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700">战略全景大屏</button>}
            </div>
          </div>

          {!canApproveDeletion && (
            <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-700">当前账号为只读权限，可查看审批记录但无法操作审批</div>
          )}
            <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col min-h-0">
                <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-700">待审批</h3>
                  <span className="text-[10px] font-black text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-0.5">{pendingDeleteApprovals.length} 条</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {pendingDeleteApprovals.length === 0 ? (
                    <div className="text-xs text-slate-400 italic p-2">暂无待审批记录</div>
                  ) : pendingDeleteApprovals.map(item => (
                    <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
                      <div className="text-xs font-black text-slate-700 truncate">{getDeleteActionLabel(item.actionType)} · {item.entityName || '-'}</div>
                      <div className="text-[10px] text-slate-500 font-medium">申请人：{getUserNickname(item.requestedBy) || '-'} · {new Date(item.requestedAt).toLocaleString()}</div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => reviewDeleteApproval(item.id, 'approved')}
                          disabled={!canApproveDeletion}
                          className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 transition-colors text-[10px] font-black"
                        >
                          {item.actionType === 'customer_edit' ? '通过并执行' : '通过并删除'}
                        </button>
                        <button
                          onClick={() => reviewDeleteApproval(item.id, 'rejected')}
                          disabled={!canApproveDeletion}
                          className="px-2 py-1 bg-rose-100 text-rose-700 rounded hover:bg-rose-200 transition-colors text-[10px] font-black"
                        >
                          驳回
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col min-h-0">
                <div className="px-4 py-3 border-b bg-slate-50">
                  <h3 className="text-sm font-black text-slate-700">已处理记录</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {reviewedDeleteApprovals.length === 0 ? (
                    <div className="text-xs text-slate-400 italic p-2">暂无已处理记录</div>
                  ) : reviewedDeleteApprovals.map(item => (
                    <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-black text-slate-700 truncate">{getDeleteActionLabel(item.actionType)} · {item.entityName || '-'}</div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${item.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {item.status === 'approved' ? '已通过' : '已驳回'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-medium">申请：{getUserNickname(item.requestedBy) || '-'} · {new Date(item.requestedAt).toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 font-medium">审批：{getUserNickname(item.reviewedBy) || '-'} · {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : '-'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
        </div>
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
                  <h1 className="text-4xl font-black italic tracking-tighter uppercase">战略指挥中心</h1>
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
              {/* 同步状态指示器 */}
              <div className={`px-4 py-3 rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-lg border-2 flex items-center gap-2 transition-all ${
                syncStatus === 'ready' ? (dashboardTheme === 'dark' ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-700') :
                syncStatus === 'syncing' ? (dashboardTheme === 'dark' ? 'bg-amber-900/50 border-amber-600 text-amber-300 animate-pulse' : 'bg-amber-50 border-amber-300 text-amber-700 animate-pulse') :
                syncStatus === 'error' ? (dashboardTheme === 'dark' ? 'bg-red-900/50 border-red-600 text-red-300' : 'bg-red-50 border-red-300 text-red-700') :
                (dashboardTheme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-gray-100 border-gray-300 text-slate-600')
              }`}>
                {syncStatus === 'ready' && '✅ 已同步'}
                {syncStatus === 'syncing' && '⏳ 同步中...'}
                {syncStatus === 'error' && '❌ 同步失败'}
                {syncStatus === 'offline' && '⚠️ 离线模式'}
              </div>

              <button
                onClick={() => setDashboardTheme(dashboardTheme === 'dark' ? 'light' : 'dark')}
                className={`px-4 py-3 rounded-[1.5rem] font-black transition-all active:scale-95 flex items-center gap-2 text-xs uppercase tracking-widest shadow-lg border-2 ${dashboardTheme === 'dark' ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-white' : 'bg-white border-gray-300 hover:bg-gray-100 text-slate-900'}`}
                title={dashboardTheme === 'dark' ? '切换至白天模式' : '切换至黑夜模式'}
              >
                {dashboardTheme === 'dark' ? '☀️ 白天' : '🌙 黑夜'}
              </button>
              <button
                onClick={() => setViewMode('home')}
                className={`px-10 py-4 rounded-[1.5rem] font-black transition-all active:scale-95 flex items-center gap-4 text-xs uppercase tracking-widest shadow-2xl border-2 ${dashboardTheme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-white' : 'bg-white border-gray-300 hover:bg-gray-100 text-slate-900'}`}
              >
                <Home size={20}/> 返回首页
              </button>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_320px] gap-6 mb-5">
            {/* 左侧：核心库存指标和采购状态 */}
            <div className="pr-2 flex flex-col gap-4">
              {/* 核心库存指标 */}
              <div className={`rounded-[2rem] border p-5 shadow-sm ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`}>
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
              <div className="grid grid-cols-3 gap-4 mb-4">
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
              </div>
            </div>

            {/* 采购状态概览 */}
            <div className={`rounded-[2rem] border p-5 shadow-sm flex flex-col overflow-hidden max-h-[260px] ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`}>
              <div className="flex items-center justify-between mb-6">
                <h3 className={`text-base font-bold flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                  <div className={`w-2 h-6 rounded-full ${dashboardTheme === 'dark' ? 'bg-emerald-500' : 'bg-emerald-600'}`}></div>
                  采购单进度看板
                </h3>
              </div>

              {/* 状态甜甜圈/列表替代品 */}
              <div className="space-y-2 flex-1 overflow-y-auto min-h-0">
                {[
                  { label: '已下单 (Ordered)', count: poSummary.statusCounts.ordered, bgClass: 'bg-slate-500', shadowClass: 'shadow-slate-500/50' },
                  { label: '生产中 (In Production)', count: poSummary.statusCounts.production, bgClass: 'bg-amber-500', shadowClass: 'shadow-amber-500/50' },
                  { label: '一线运输中 (Shipping)', count: poSummary.statusCounts.shipping, bgClass: 'bg-blue-500', shadowClass: 'shadow-blue-500/50' },
                  { label: '尾程接收中 (Last Mile)', count: poSummary.statusCounts.inspection, bgClass: 'bg-violet-500', shadowClass: 'shadow-violet-500/50' },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${dashboardTheme === 'dark' ? 'bg-slate-800/30 border-slate-700/50' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${item.bgClass} shadow-[0_0_8px_rgba(0,0,0,0.3)] ${item.shadowClass}`}></div>
                      <span className={`text-xs font-medium ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{item.label}</span>
                    </div>
                    <span className={`text-lg font-bold font-mono ${dashboardTheme === 'dark' ? 'text-white' : 'text-slate-800'}`}>{item.count}</span>
                  </div>
                ))}
              </div>

              {/* 最近到货小部件 */}
              <div className={`mt-3 pt-3 border-t ${dashboardTheme === 'dark' ? 'border-slate-800' : 'border-slate-100'}`}>
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

            {/* 右侧：库存推演 - 专用滚轮 */}
            <div style={{ width: '320px', height: '320px', flexShrink: 0 }} className={`rounded-[2rem] border p-5 shadow-sm flex flex-col sticky top-6 self-start ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`}>
              <div className={`text-sm font-bold mb-4 flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                <Calendar size={16} /> 未来12个月供需推演
              </div>
              <div style={{ overflowY: 'auto', flex: '1 1 0', minHeight: 0 }} className="pr-2">
                <div className="grid grid-cols-2 gap-2">
                {monthlySummary.salesTotals.map((sales, idx) => {
                  const monthDate = new Date();
                  monthDate.setDate(1);
                  monthDate.setMonth(monthDate.getMonth() + idx);
                  const monthLabel = `${monthDate.getFullYear()}/${monthDate.getMonth() + 1}`;
                  const monthStartStock = monthlySummary.startStocks[idx] || 0;
                  const inboundQty = monthlySummary.inboundTotals[idx] || 0;
                  const netChange = inboundQty - sales;
                  const endStock = monthStartStock + netChange;

                  return (
                    <div key={idx} className={`rounded-lg border flex flex-col p-2.5 h-28 transition-all text-[10px] ${dashboardTheme === 'dark' ? 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600' : 'bg-slate-50 border-slate-100 hover:bg-white hover:border-indigo-100'}`}>
                      <div className={`font-bold mb-1.5 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-400'}`}>
                        {monthLabel}
                      </div>
                      <div className="flex-1 flex flex-col justify-between space-y-1">
                        <div className="flex justify-between">
                          <span className={dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}>销</span>
                          <span className={`font-black ${dashboardTheme === 'dark' ? 'text-rose-300' : 'text-rose-500'}`}>{Math.round(sales)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}>到</span>
                          <span className={`font-black ${inboundQty > 0 ? (dashboardTheme === 'dark' ? 'text-emerald-300' : 'text-emerald-600') : 'text-slate-300/30'}`}>{Math.round(inboundQty)}</span>
                        </div>
                        <div className={`flex justify-between pt-1 border-t border-dashed ${dashboardTheme === 'dark' ? 'border-slate-700' : 'border-slate-200'}`}>
                          <span className={dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}>余</span>
                          <span className={`font-black ${dashboardTheme === 'dark' ? 'text-indigo-200' : 'text-indigo-700'}`}>{Math.round(endStock)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-12 gap-6 mb-6">
          <div className={`col-span-8 rounded-[2rem] border p-0 shadow-sm overflow-hidden flex flex-col ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`} style={{ maxHeight: '520px' }}>
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
                 cancelled: { bg: 'bg-red-50', text: 'text-red-700', darkBg: 'bg-red-900/30', darkText: 'text-red-400' },
                 in_production: { bg: 'bg-amber-50', text: 'text-amber-700', darkBg: 'bg-amber-900/30', darkText: 'text-amber-400' },
                 prod_complete: { bg: 'bg-orange-50', text: 'text-orange-700', darkBg: 'bg-orange-900/30', darkText: 'text-orange-400' },
                 leg1_shipped: { bg: 'bg-blue-50', text: 'text-blue-700', darkBg: 'bg-blue-900/30', darkText: 'text-blue-400' },
                 leg1_arrived: { bg: 'bg-cyan-50', text: 'text-cyan-700', darkBg: 'bg-cyan-900/30', darkText: 'text-cyan-400' },
                 leg2_shipped: { bg: 'bg-violet-50', text: 'text-violet-700', darkBg: 'bg-violet-900/30', darkText: 'text-violet-400' },
                 leg2_arrived: { bg: 'bg-purple-50', text: 'text-purple-700', darkBg: 'bg-purple-900/30', darkText: 'text-purple-400' },
                 inspecting: { bg: 'bg-yellow-50', text: 'text-yellow-700', darkBg: 'bg-yellow-900/30', darkText: 'text-yellow-400' },
                 picking: { bg: 'bg-lime-50', text: 'text-lime-700', darkBg: 'bg-lime-900/30', darkText: 'text-lime-400' },
                 bonded_warehouse: { bg: 'bg-teal-50', text: 'text-teal-700', darkBg: 'bg-teal-900/30', darkText: 'text-teal-400' },
                 pending_shelving: { bg: 'bg-green-50', text: 'text-green-700', darkBg: 'bg-green-900/30', darkText: 'text-green-400' },
                 shelved: { bg: 'bg-emerald-50', text: 'text-emerald-700', darkBg: 'bg-emerald-900/30', darkText: 'text-emerald-400' },
              }
              const defaultStatusColor = { bg: 'bg-slate-50', text: 'text-slate-600', darkBg: 'bg-slate-800/50', darkText: 'text-slate-500' };

              const statusLabel = {
                pre_order: '预下订单', ordered: '已下单', cancelled: '已取消', in_production: '生产中', prod_complete: '生产完成',
                leg1_shipped: '头程发货', leg1_arrived: '头程到货', leg2_shipped: '二程发货', leg2_arrived: '二程到货',
                inspecting: '查验中', picking: '装柜中', bonded_warehouse: '保税仓', pending_shelving: '待理货', shelved: '已上架'
              };

              // 过滤掉预下订单和已理货上架
              let visiblePos = sorted.filter(po => po.status !== 'pre_order' && po.status !== 'shelved');
              if (poOverviewFilter === 'followup') {
                visiblePos = visiblePos.filter(po => po.needsFollowUp);
              }

              return (
                <div className="w-full">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead className={`sticky top-0 z-10 text-xs font-bold uppercase tracking-wider border-b ${dashboardTheme === 'dark' ? 'bg-slate-900/95 text-slate-300 border-slate-800' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                      <tr>
                        <th className="py-3 px-4 font-medium w-56">商品信息</th>
                        <th className="py-3 px-4 font-medium w-32">采购单号</th>
                        <th className="py-3 px-4 font-medium text-right w-24">数量</th>
                        <th className="py-3 px-4 font-medium w-32 text-center">当前状态</th>
                        <th className="py-3 px-4 font-medium w-32">关键节点</th>
                        <th className="py-3 px-4 font-medium w-40">异常/备注</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y text-xs font-medium ${dashboardTheme === 'dark' ? 'divide-slate-800/50 text-slate-300' : 'divide-slate-100 text-slate-600'}`}>
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
                                    <td className="py-3.5 px-4">
                                      <div className={`font-bold text-sm mb-0.5 truncate max-w-[220px] ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{po.skuName}</div>
                                        <div className="opacity-60 text-[10px]">ID: {po.skuId}</div>
                                    </td>
                                    <td className="py-3.5 px-4 font-mono opacity-90">{po.poNumber}</td>
                                    <td className="py-3.5 px-4 text-right font-mono font-bold">{po.qty}</td>
                                    <td className="py-3.5 px-4 text-center">
                                        <span className={`px-2 py-1 rounded text-[10px] font-bold inline-block ${badgeClass}`}>
                                            {statusLabel[po.status] || po.status}
                                        </span>
                                    </td>
                                    <td className="py-3.5 px-4">
                                        <div className="flex flex-col gap-0.5 text-[10px]">
                                            <div className="flex justify-between"><span>下单:</span> <span className="font-mono">{po.orderDate}</span></div>
                                            <div className="flex justify-between"><span>预计:</span> <span className={`${dashboardTheme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'} font-mono`}>{po.arrivalDate}</span></div>
                                        </div>
                                    </td>
                                    <td className="py-3.5 px-4">
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
          <div className={`col-span-4 rounded-[2rem] border p-6 shadow-sm flex flex-col overflow-hidden min-h-0 ${dashboardTheme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-100'}`} style={{ maxHeight: '520px' }}>
            <div className="flex items-center justify-between mb-6">
              <h3 className={`text-base font-bold flex items-center gap-2 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                <div className={`w-2 h-6 rounded-full ${dashboardTheme === 'dark' ? 'bg-rose-500' : 'bg-rose-600'}`}></div>
                补货建议明细
              </h3>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-400'}`}>
                各 SKU 补货数量建议 与 补货后最早断货日期
              </div>
              <div className={`grid grid-cols-[1fr_110px_110px] items-center text-[10px] font-bold uppercase tracking-wider px-2 pb-2 ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-400'}`}>
                <div>SKU</div>
                <div className="text-right">补货建议</div>
                <div className="text-right">最早断货</div>
              </div>
              <div className={`flex-1 overflow-y-auto min-h-0 pr-1 space-y-2 ${dashboardTheme === 'dark' ? 'scrollbar-thin scrollbar-thumb-slate-700/80' : 'scrollbar-thin scrollbar-thumb-slate-200'}`}>
                {replenishmentRows.length === 0 ? (
                  <div className={`text-xs italic ${dashboardTheme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>暂无需要补货的 SKU</div>
                ) : (
                  replenishmentRows.slice(0, showAllReplenishment ? replenishmentRows.length : 8).map(row => (
                    <div key={row.id} className={`rounded-xl border p-3 ${dashboardTheme === 'dark' ? 'bg-slate-800/40 border-slate-700/50' : 'bg-slate-50 border-slate-100'}`}>
                      <div className="grid grid-cols-[1fr_110px_110px] items-center gap-3">
                        <div className="min-w-0">
                          <div className={`font-bold text-sm truncate ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{row.name}</div>
                          <div className={`text-[10px] mt-0.5 ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-400'}`}>ID: {row.id}</div>
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
                        <th className={`py-4 pl-8 w-64 text-left text-sm font-bold uppercase tracking-wider ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>商品信息</th>
                        <th className={`py-4 text-center text-sm font-bold uppercase tracking-wider w-32 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>实时库存</th>
                        <th className={`py-4 text-center text-sm font-bold uppercase tracking-wider w-32 ${dashboardTheme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>断货预测</th>
                        <th className={`py-4 text-center text-sm font-bold uppercase tracking-wider w-40 ${dashboardTheme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>下单建议</th>
                        {Array.from({length: 12}).map((_, i) => {
                          const d = new Date(); d.setMonth(d.getMonth() + i);
                          return <th key={i} className={`py-4 text-center text-xs font-bold uppercase tracking-wider w-20 ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>{(d.getMonth() + 1)}月</th>
                        })}
                      </tr>
                  </thead>
                  <tbody className={`divide-y ${dashboardTheme === 'dark' ? 'divide-slate-800/50' : 'divide-slate-100'}`}>
                    {dashboardData.map(sku => (
                      <tr key={sku.id} className={`group code-font transition-colors ${dashboardTheme === 'dark' ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'}`}>
                          {/* 商品名 */}
                          <td className="py-4 pl-8">
                            <div className={`font-bold text-base mb-1 ${dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{sku.name}</div>
                            <div className={`text-xs uppercase font-mono ${dashboardTheme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>#{String(sku.id).padStart(3, '0')}</div>
                          </td>
                          
                          {/* 实时库存 */}
                          <td className="py-4 text-center">
                              <span className={`font-mono font-bold text-lg ${dashboardTheme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                                {sku.currentStock?.toLocaleString()}
                              </span>
                          </td>
                          
                          {/* 断货预测日 */}
                          <td className="py-4 text-center">
                              {sku.finalStockOutDate !== '安全' ? (
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-sm font-bold ${dashboardTheme === 'dark' ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-800'} animate-pulse`}>
                                  {sku.finalStockOutDate}
                                </span>
                              ) : (
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-sm font-bold ${dashboardTheme === 'dark' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-100 text-emerald-800'}`}>
                                  安全
                                </span>
                              )}
                          </td>
                          
                          {/* 下单决策 */}
                          <td className={`py-4 px-4 text-center border-x ${dashboardTheme === 'dark' ? 'bg-indigo-900/5 border-indigo-900/10' : 'bg-indigo-50/30 border-indigo-50'}`}>
                            {sku.finalStockOutDate !== '安全' ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className={`text-xs uppercase font-bold ${dashboardTheme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`}>截止: {sku.orderDateStr}</span>
                                <span className={`font-mono font-bold text-lg ${sku.urgency === 'critical' ? 'text-red-500' : (dashboardTheme === 'dark' ? 'text-slate-200' : 'text-slate-800')}`}>
                                  {sku.suggestQty.toFixed(0)}
                                </span>
                              </div>
                            ) : (
                              <span className={`text-sm font-medium italic ${dashboardTheme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`}>无需操作</span>
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
                              <td key={i} className={`p-1 text-center font-mono text-sm ${cellBg || cellText}`}>
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

              {/* 账号权限管理 */}
              <div className="space-y-4">
                <h4 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <Lock size={20} className="text-indigo-600"/> 账号权限管理（管理员）
                </h4>
                <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="grid grid-cols-[1fr_120px_auto] gap-2 items-center">
                    <input
                      type="email"
                      value={roleTargetEmail}
                      onChange={e => setRoleTargetEmail(e.target.value)}
                      placeholder="输入账号邮箱，如 user@orynda.cn"
                      className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 font-medium text-sm"
                    />
                    <select
                      value={roleTargetValue}
                      onChange={e => setRoleTargetValue(e.target.value)}
                      className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 font-medium text-sm"
                    >
                      <option value="admin">管理员</option>
                      <option value="editor">编辑</option>
                      <option value="viewer">只读</option>
                    </select>
                    <button
                      onClick={() => upsertUserRole(roleTargetEmail, roleTargetValue)}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-xs font-bold"
                    >
                      添加/更新
                    </button>
                  </div>

                  <div className="text-[10px] text-slate-500 font-medium">
                    说明：`admin` 可管理权限与系统设置；`editor` 可编辑业务数据；`viewer` 仅查看。功能模块可单独开关。
                  </div>

                  <div className="max-h-[400px] overflow-y-auto space-y-3 pt-1">
                    {(() => {
                      // 合并 userRoles + ALLOWED_EMAILS，确保所有用户都显示
                      const allEmails = new Set([...Object.keys(userRoles), ...ALLOWED_EMAILS]);
                      if (currentUserEmail) allEmails.add(currentUserEmail);
                      const entries = [...allEmails].sort((a, b) => a.localeCompare(b)).map(email => {
                        const roleData = userRoles[email];
                        return [email, roleData || { role: DEFAULT_ADMIN_EMAILS.includes(email) ? 'admin' : 'editor', features: DEFAULT_ADMIN_EMAILS.includes(email) ? [...ALL_FEATURE_KEYS] : [] }];
                      });
                      if (entries.length === 0) return <div className="text-xs text-slate-400 italic">暂无已注册用户。</div>;
                      return entries.map(([email, roleData]) => {
                          const role = (roleData && typeof roleData === 'object') ? (roleData.role || 'editor') : (typeof roleData === 'string' ? roleData : 'editor');
                          const features = (roleData && typeof roleData === 'object' && Array.isArray(roleData.features)) ? roleData.features : [];
                          const isAdmin = role === 'admin';
                          const isHardcodedAdmin = DEFAULT_ADMIN_EMAILS.includes(email);
                          return (
                            <div key={email} className="bg-white border border-slate-200 rounded-xl px-4 py-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={(roleData && typeof roleData === 'object') ? (roleData.nickname || '') : ''}
                                  onChange={e => updateUserNickname(email, e.target.value)}
                                  placeholder="备注名"
                                  className="w-20 px-2 py-1 border border-slate-200 rounded text-xs font-bold text-indigo-700 bg-indigo-50 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                                />
                                <div className="flex-1 text-xs font-medium text-slate-500 truncate">{email}</div>
                                <select
                                  value={isHardcodedAdmin ? 'admin' : role}
                                  onChange={e => { if (!isHardcodedAdmin) upsertUserRole(email, e.target.value, features); }}
                                  disabled={isHardcodedAdmin}
                                  className={`px-2 py-1 border border-slate-300 rounded text-xs font-medium ${isHardcodedAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                  <option value="admin">管理员</option>
                                  <option value="editor">编辑</option>
                                  <option value="viewer">只读</option>
                                </select>
                                {!DEFAULT_ADMIN_EMAILS.includes(email) && (
                                <button
                                  onClick={() => removeUserRole(email)}
                                  className="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors text-xs font-bold"
                                >
                                  移除
                                </button>
                                )}
                              </div>
                              {!isAdmin && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {ALL_FEATURES.map(f => {
                                    const checked = features.includes(f.key);
                                    return (
                                      <label key={f.key} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer border transition-colors ${checked ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            const next = checked ? features.filter(k => k !== f.key) : [...features, f.key];
                                            updateUserFeatures(email, next);
                                          }}
                                          className="w-3 h-3 accent-indigo-600"
                                        />
                                        {f.label}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                              {isAdmin && <div className="text-[10px] text-emerald-600 font-medium">管理员拥有全部功能权限</div>}
                              {isHardcodedAdmin && <div className="text-[10px] text-blue-500 font-medium">🔒 系统预设管理员</div>}
                            </div>
                          );
                        });
                    })()}
                  </div>

                </div>
              </div>

              {/* 数据备份与恢复（管理员） */}
              {canManagePermissions && (
              <div className="space-y-4">
                <h4 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <AlertTriangle size={20} className="text-orange-600"/> 数据备份与恢复（管理员）
                </h4>

                {/* 自动备份状态 */}
                <div className="bg-green-50 p-4 rounded-2xl border border-green-200 space-y-3">
                  <div className="text-xs font-bold text-green-800">💾 云端双层自动备份</div>
                  <div className="text-[10px] text-green-700">
                    系统会在数据发生变化后<b>每30秒</b>自动保存<b>两份</b>备份：<br/>
                    • <b>常规备份</b>：每次自动保存（数据骤降&gt;50%时拦截）<br/>
                    • <b>🛡️ 安全备份</b>：仅在数据量健康时更新（数据骤降&gt;20%时冻结），作为最后防线
                  </div>
                  {lastBackupInfo && (
                    <div className="text-[10px] text-green-600 bg-green-100 px-2 py-1 rounded">
                      📋 常规备份: {lastBackupInfo}
                    </div>
                  )}
                  {lastSafeBackupInfo && (
                    <div className="text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded">
                      🛡️ 安全备份: {lastSafeBackupInfo}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveBackupToCloud('manual').then(ok => ok && window.alert('✅ 手动备份成功！'))}
                      className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-black"
                    >
                      💾 立即手动备份
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => restoreFromCloudBackup('latest')}
                      className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-black"
                    >
                      📥 恢复最新备份
                    </button>
                    <button
                      onClick={() => restoreFromCloudBackup('safe')}
                      className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-xs font-black"
                    >
                      🛡️ 恢复安全备份
                    </button>
                  </div>
                </div>

                {/* 手动 JSON 恢复 */}
                <div className="bg-orange-50 p-4 rounded-2xl border border-orange-200 space-y-3">
                  <div className="text-xs font-bold text-orange-800">📝 手动 JSON 恢复</div>
                  <div className="text-[10px] text-orange-700">
                    从 localStorage 备份的 JSON 恢复全部数据到云端。恢复后会覆盖当前云端数据，请确认备份文件正确。
                  </div>
                  <textarea
                    id="restoreJsonInput"
                    placeholder="粘贴备份 JSON 数据到此处..."
                    className="w-full px-3 py-2 border border-orange-300 rounded-lg text-xs font-mono h-24 resize-none focus:outline-none focus:border-orange-500"
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById('restoreJsonInput');
                      if (!input?.value?.trim()) { setWarning('请先粘贴备份 JSON 数据'); return; }
                      if (!window.confirm('⚠️ 确定要用备份数据覆盖当前云端数据吗？此操作不可撤销。')) return;
                      restoreFromBackup(input.value.trim());
                    }}
                    className="w-full px-3 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-xs font-black"
                  >
                    🔄 从 JSON 恢复数据到云端
                  </button>
                </div>
              </div>
              )}

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
                    if (!canManagePermissions) {
                      setWarning('仅管理员可保存系统设置');
                      setTimeout(() => setWarning(''), 2000);
                      setShowSettings(false);
                      return;
                    }
                    // 保存设置到本地存储
                    const localData = loadLocalMemory(localKey) || {};
                    saveLocalMemory(localKey, {
                      ...localData,
                      warningDays,
                      defaultSettings,
                      transportModes,
                      userRoles
                    });
                    
                    // 保存设置到 Firestore
                    if (db && user) {
                      try {
                        const docRef = doc(db, 'inventory_apps', appId, 'shared', 'main');
                        setDoc(docRef, { 
                          warningDays, 
                          defaultSettings, 
                          transportModes,
                          userRoles,
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