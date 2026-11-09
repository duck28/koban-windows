export type ProfileSetupMode = 'home' | 'freelancer' | 'both';
export type LedgerMode = 'home' | 'freelancer';
export type ActiveWorkspace = 'home' | 'freelancer' | 'combined';

export type ViewTab =
  | 'worksheet'
  | 'yearly_planner'
  | 'transactions'
  | 'accounts'
  | 'reports'
  | 'categories'
  | 'recurring'
  | 'goals'
  | 'backups'
  | 'settings';

export type MonthCopyScope = 'budgets_only' | 'budgets_and_actuals';

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'business_bank'
  | 'tax_reserve'
  | 'retirement'
  | 'brokerage'
  | 'crypto'
  | 'real_estate'
  | 'credit_card'
  | 'loan'
  | 'custom';

export type AccountLiquidityClass =
  | 'liquid'
  | 'retirement'
  | 'investment'
  | 'fixed_asset'
  | 'liability';

export interface FinancialAccount {
  id: string;
  name: string;
  institution?: string;
  accountNumberMasked?: string;
  mode: LedgerMode;
  type: AccountType;
  /** Used when type === 'custom' (e.g. "Precious Metals", "Pillar 3a", "Private Equity") */
  customTypeLabel?: string;
  classification: AccountLiquidityClass;
  /** Opening / baseline balance */
  startingBalance: number;
  /** Current manual balance or market valuation */
  currentBalance: number;
  /** If true, live balance = startingBalance + linked income - linked expenses */
  autoTrackTransactions: boolean;
  includeInNetWorth: boolean;
  /** Expected annual investment return / interest rate % (e.g. 7.0 for ETFs, 5.5 for Retirement, 1.5 for Savings) */
  expectedAnnualReturnPct?: number;
  color: string;
  notes?: string;
  updatedAt: string; // YYYY-MM-DD
}

export interface NetWorthSnapshot {
  id: string;
  monthKey: string; // YYYY-MM
  recordedAt: string; // YYYY-MM-DD
  liquidAssets: number;
  retirementAssets: number;
  investmentAssets: number;
  fixedAssets: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  note?: string;
}

export type CategoryKind = 'income' | 'expense' | 'savings';

export interface CategoryGroup {
  id: string;
  mode: LedgerMode;
  name: string;
  kind: CategoryKind;
  color: string;
  /** 0 = left column, 1 = right column */
  column: 0 | 1;
  order: number;
}

export interface CategoryItem {
  id: string;
  groupId: string;
  mode: LedgerMode;
  name: string;
  kind: CategoryKind;
  defaultBudget: number;
  /** Whether this category is marked as a recurring monthly item */
  isRecurring?: boolean;
  /** Default VAT / Sales Tax % for Freelancer items (e.g. 8.1, 19, 0) */
  taxRate?: number;
  /** Tax Deductible % for Freelancer expenses (e.g. 100, 50, 0) */
  deductiblePct?: number;
  order: number;
}

export interface MonthlyBudgetEntry {
  /** Format: "YYYY-MM" e.g. "2026-11" */
  monthKey: string;
  categoryId: string;
  budget: number;
  /**
   * Optional direct Actual override entered in the Monthly Worksheet.
   * When null/undefined, Actual is computed as the sum of Transactions for that category & month.
   */
  directActual?: number | null;
}

export interface TransactionItem {
  id: string;
  date: string; // YYYY-MM-DD
  monthKey: string; // YYYY-MM
  mode: LedgerMode;
  type: 'income' | 'expense';
  categoryId: string;
  /** Optional linked FinancialAccount id */
  accountId?: string;
  description: string;
  amount: number;
  /** Freelancer / Business optional fields */
  client?: string;
  invoiceRef?: string;
  taxRate?: number;
  deductiblePct?: number;
  paymentMethod?: string;
  status?: 'cleared' | 'pending' | 'invoiced';
  notes?: string;
  recurringId?: string;
}

export interface RecurringRule {
  id: string;
  mode: LedgerMode;
  type: 'income' | 'expense';
  categoryId: string;
  accountId?: string;
  description: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  dayOfMonth: number;
  client?: string;
  taxRate?: number;
  deductiblePct?: number;
  active: boolean;
}

export interface SavingsGoal {
  id: string;
  mode: LedgerMode;
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate?: string;
  color: string;
  linkedCategoryId?: string;
  linkedAccountId?: string;
}

export type ThemePalette = 'default' | 'monochrome' | 'slate' | 'forest';
export type UiDensity = 'comfortable' | 'compact';

export interface AppSettings {
  setupCompleted: boolean;
  setupMode: ProfileSetupMode;
  activeWorkspace: ActiveWorkspace;
  currency: string;
  theme: 'system' | 'light' | 'dark';
  /** Color theme palette: default Zen (Paper & Ink), monochromatic (pure B&W), slate (Nord), forest (Emerald) */
  themePalette?: ThemePalette;
  /** Personalization: UI layout density */
  density?: UiDensity;
  /** Personalization: High-contrast numbers & balances */
  highContrastAmounts?: boolean;
  backupDir: string;
  autoBackup: boolean;
  maxBackups: number;
  lastBackupAt?: number;
  lastBackupPath?: string;
  defaultVatRate: number;
  taxReserveRate: number;
  activeYear: number;
  activeMonth: number; // 1..12
  /** Behavioral Settings */
  confirmBeforeMonthCopy?: boolean;
  monthCopyScope?: MonthCopyScope;
  monthCopyOverwriteExisting?: boolean;
  autoPromptCopyOnEmptyMonth?: boolean;
  confirmBeforeDelete?: boolean;
  defaultHideZeroRows?: boolean;
  confirmAndPreviewBeforeImport?: boolean;
  /** UI language code (e.g. 'en', 'de', 'hu', 'ja') */
  language?: string;
  /** WebDAV Cloud Sync Configuration (Nextcloud, ownCloud, mailbox.org, NAS) */
  webdav?: WebDavConfig;
}

/** 'backup' (default): upload-only copy. 'primary': the WebDAV file is the master copy. */
export type WebDavMode = 'backup' | 'primary';

export interface WebDavConfig {
  enabled: boolean;
  url: string;
  username: string;
  password?: string;
  remoteFileName?: string;
  /** Absent ⇒ 'backup'. Synced with the ledger. */
  mode?: WebDavMode;
  autoSync?: boolean;
  lastSyncAt?: number;
  lastSyncStatus?: 'idle' | 'success' | 'error';
  lastSyncMessage?: string;
}

export interface WebDavSyncResult {
  success: boolean;
  message: string;
  remote_size?: number;
  remote_modified?: string;
  timestamp: number;
}

export type WebDavCheckStatus =
  | 'offline'
  | 'error'
  | 'remote_missing'
  | 'in_sync'
  | 'local_ahead'
  | 'remote_ahead'
  | 'conflict';

/** Result of the `webdav_check` command (HEAD of the remote vs. per-device sync state). */
export interface WebDavCheckResult {
  status: WebDavCheckStatus;
  message: string;
  remoteEtag?: string | null;
  remoteLastModified?: string | null;
  remoteSize?: number | null;
  /** True when this device never synced with this target. */
  firstLink: boolean;
  /** Local DB file modification time (unix secs). */
  localModified?: number | null;
  target?: string;
}

export interface WebDavRemoteInfo {
  exists: boolean;
  size?: number;
  last_modified?: string;
}

export interface YearlyPlanItem {
  id: string;
  year: number;
  mode: LedgerMode;
  categoryId: string;
  /** Item or category label (e.g. "Tuition Fees", "ETF Core Allocation") */
  label: string;
  kind: CategoryKind;
  /** Total planned amount for the full year (e.g. 11000 for Tuition Fees) */
  annualAmount: number;
  /** Whether entered as a monthly recurring amount (annual = monthly * 12) or an annual lump-sum/total */
  schedule: 'monthly' | 'annual_lump';
  /** Primary account this planned income/expense corresponds to (paid from / deposited into) */
  accountId?: string;
  /**
   * For savings/investment allocations: which destination account
   * (e.g. Investment / ETF Portfolio, Retirement Pillar 3a, Savings Account)
   * the planned money goes into for growth estimation
   */
  destinationAccountId?: string;
}

export interface LedgerState {
  version: number;
  settings: AppSettings;
  groups: CategoryGroup[];
  categories: CategoryItem[];
  monthlyBudgets: MonthlyBudgetEntry[];
  transactions: TransactionItem[];
  recurringRules: RecurringRule[];
  savingsGoals: SavingsGoal[];
  accounts: FinancialAccount[];
  netWorthSnapshots: NetWorthSnapshot[];
  yearlyPlanItems?: YearlyPlanItem[];
}

export interface DbInfo {
  db_path: string;
  db_size: number;
  last_modified: number;
  encrypted: boolean;
  cipher: string;
  encrypted_records: number;
  has_custom_passphrase: boolean;
  is_custom_location?: boolean;
}

export interface BackupEntry {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export interface PasskeyCredentialRecord {
  id: string;
  name: string;
  kind: 'webauthn_passkey' | 'windows_hello_native';
  createdAt: number;
  lastUsedAt?: number;
  publicKeyB64?: string;
  wrappedVaultSecret?: string;
}

export interface AuthConfig {
  enabled: boolean;
  userDisplayName: string;
  autoPromptPasskeyOnLaunch: boolean;
  autoLockMinutes: number;
  passkeys: PasskeyCredentialRecord[];
  hasMasterPassphrase: boolean;
  passphraseSaltB64?: string;
  passphraseVerifierHashB64?: string;
}

export interface SaveResult {
  db_path: string;
  db_size: number;
  backup_path?: string | null;
  timestamp: number;
  encrypted_records?: number;
}
