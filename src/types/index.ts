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
  /**
   * Fixed cost (anchor toggle): the month's Actual automatically equals its Budget
   * unless an Actual is typed or transactions are logged. Independent of isRecurring.
   */
  isFixedCost?: boolean;
  /**
   * Savings categories: account the money is moved into (e.g. ETF portfolio, Pillar 3a).
   * Savings transactions then count as a transfer — out of their source account, into this
   * one — so net worth is unchanged instead of dropping as if the money were spent.
   */
  targetAccountId?: string;
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
  /**
   * True when the user typed this month's Budget for a category whose budget is
   * otherwise derived from a scheduled recurring rule (bi-weekly / bi-monthly…).
   */
  budgetManual?: boolean;
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
  /** Unique bank-assigned transaction reference (camt.053 AcctSvcrRef/NtryRef or OFX FITID) */
  externalId?: string;
  /** Deterministic statement deduplication fingerprint (includes same-day occurrence index) */
  importFingerprint?: string;
  /** Untouched original description from the imported bank statement */
  rawDescription?: string;
  /** Linked peer transaction ID when marked as an internal cross-account transfer */
  transferPeerId?: string;
}

export type BankDateFormat =
  | 'auto'
  | 'YYYY-MM-DD'
  | 'DD.MM.YYYY'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'YYYYMMDD';

export type BankAmountMode = 'signed' | 'split_debit_credit';

export type BankDecimalSeparator = 'auto' | '.' | ',';

export interface BankImportProfile {
  id: string;
  name: string;
  accountId?: string;
  defaultMode?: LedgerMode;
  headerFingerprint: string[];
  delimiter?: string;
  dateColumn: string;
  dateFormat: BankDateFormat;
  amountMode: BankAmountMode;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  invertSign: boolean;
  decimalSeparator: BankDecimalSeparator;
  descriptionColumns: string[];
  payeeColumn?: string;
  referenceColumn?: string;
  currencyColumn?: string;
  skipRows?: number;
  updatedAt: string;
}

export type ImportRuleDirection = 'any' | 'income' | 'expense';
export type ImportRuleMatchField = 'any' | 'payee' | 'description' | 'iban';
export type ImportRuleMatchType = 'contains' | 'starts_with' | 'exact' | 'regex';

export interface ImportRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  accountId?: string;
  direction?: ImportRuleDirection;
  matchField: ImportRuleMatchField;
  matchType: ImportRuleMatchType;
  pattern: string;
  minAmount?: number;
  maxAmount?: number;
  setCategoryId: string;
  setMode?: LedgerMode;
  setPayee?: string;
  setClient?: string;
  setTaxRate?: number;
  setDeductiblePct?: number;
  markAsTransfer?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PendingImportFile {
  name: string;
  path: string;
  size: number;
  modified: number;
  extension: string;
}

export type RecurringFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'yearly';

export interface RecurringRule {
  id: string;
  mode: LedgerMode;
  type: 'income' | 'expense';
  categoryId: string;
  accountId?: string;
  description: string;
  amount: number;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  /**
   * Starting date (YYYY-MM-DD) of the first occurrence.
   * For weekly / bi-weekly, every further occurrence repeats every 7 / 14 days.
   * For monthly / bi-monthly / quarterly / yearly, determines the first due month & day.
   */
  startDate?: string;
  /**
   * Bi-monthly / quarterly / yearly: first month (YYYY-MM) the item is due.
   * The rule then repeats every 2 / 3 / 12 months from it.
   */
  startMonth?: string;
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

export type WorksheetSortField = 'manual' | 'name' | 'budget' | 'actual' | 'diff';
export type WorksheetSortDirection = 'asc' | 'desc';

export interface WorksheetColumnWidths {
  budget: number;
  actual: number;
  diff: number;
  /** Desktop left-column split percentage (34..66, default 50) */
  leftPanePct?: number;
}

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
  /** Monthly Worksheet column widths & desktop split ratio */
  worksheetColumnWidths?: WorksheetColumnWidths;
  /** Monthly Worksheet category row sort field & direction */
  worksheetSortBy?: WorksheetSortField;
  worksheetSortDir?: WorksheetSortDirection;
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
  /**
   * Fixed-cost categories: Actual automatically equals Budget until transactions
   * are logged or the user types an Actual. Absent ⇒ true.
   */
  autoFillFixedActuals?: boolean;
  /** UI language code (e.g. 'en', 'de', 'hu', 'ja') */
  language?: string;
  /** Vault owner display name stored safely inside ledger settings */
  ownerDisplayName?: string;
  /** Automatically check GitHub Releases for app updates on startup */
  autoCheckUpdates?: boolean;
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

export type YearlyPlanSchedule =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'annual_lump';

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
  /**
   * How often the amount falls due (annual = per-payment amount × payments per year):
   * weekly (52), bi-weekly (26), monthly (12), bi-monthly (6), quarterly (4) or a yearly lump sum (1).
   */
  schedule: YearlyPlanSchedule;
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
  importProfiles?: BankImportProfile[];
  importRules?: ImportRule[];
}

export interface DbInfo {
  db_path: string;
  db_size: number;
  last_modified: number;
  encrypted: boolean;
  cipher: string;
  encrypted_records: number;
  has_custom_passphrase: boolean;
  format_version?: number;
  is_custom_location?: boolean;
}

export interface BackupEntry {
  name: string;
  path: string;
  size: number;
  modified: number;
  format_version?: number;
}

export interface KeySlotSummary {
  id: string;
  kind: string;
  label: string;
  keyfileFingerprint?: string | null;
  createdAt: number;
}

export interface AuthSettings {
  autoPromptDevice: boolean;
  autoLockMinutes: number;
  lockOnMinimize: boolean;
}

export interface VaultStatus {
  exists: boolean;
  hasLedgerState: boolean;
  formatVersion: number;
  vaultId?: string | null;
  unlocked: boolean;
  needsMigration: boolean;
  hasLegacyCustomPassphrase: boolean;
  slots: KeySlotSummary[];
  deviceSlotEnrolled: boolean;
  windowsHelloAvailable: boolean;
  requiresKeyFile: boolean;
  rememberedKeyFilePath?: string | null;
  authSettings: AuthSettings;
  dbPath: string;
  dbSize: number;
  lastModified: number;
  isCustomLocation: boolean;
}

export interface VaultCreateResult {
  status: VaultStatus;
  recoveryKey?: string | null;
  ledgerJson?: string | null;
}

export interface KeyFileCreateResult {
  path: string;
  fingerprint: string;
}

export interface ExternalChangeResult {
  changed: boolean;
  formatVersion: number;
  externalStateJson?: string | null;
  error?: string | null;
  lastModified: number;
}

export interface V1MigrationPreview {
  ledgerJson: string;
  legacyDisplayName?: string | null;
  hadCustomPassphrase: boolean;
}

export interface WebDavMergeFetchResult {
  remoteJson: string;
  remoteModified?: string | null;
  remoteSize?: number | null;
}

export interface MergeSummary {
  groupsAdded: number;
  categoriesAdded: number;
  budgetsMerged: number;
  transactionsAdded: number;
  transactionsUpdated: number;
  rulesMerged: number;
  goalsMerged: number;
  accountsMerged: number;
  snapshotsMerged: number;
  planItemsMerged: number;
  totalChanges: number;
}

export interface SaveResult {
  db_path: string;
  db_size: number;
  backup_path?: string | null;
  timestamp: number;
  encrypted_records?: number;
}
