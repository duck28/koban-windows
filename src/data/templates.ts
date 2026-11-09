import {
  AccountLiquidityClass,
  AccountType,
  CategoryGroup,
  CategoryItem,
  CategoryKind,
  FinancialAccount,
  LedgerMode,
  LedgerState,
  MonthlyBudgetEntry,
  NetWorthSnapshot,
  ProfileSetupMode,
  RecurringRule,
  SavingsGoal,
} from '../types';

export const ZEN_PALETTE = [
  '#3f704d', // Moss green (Income / Savings)
  '#b9432f', // Vermilion (Home / Primary)
  '#3f6e8c', // Indigo dye (Freelancer / Transport)
  '#b8862d', // Gold ochre (Daily Living)
  '#8a6fb0', // Wisteria (Entertainment / SaaS)
  '#5b7f4a', // Bamboo (Health)
  '#c46d5e', // Terracotta (Obligations)
  '#d97aa6', // Sakura (Charity / Gifts)
  '#4c7a7b', // Teal slate (Subscriptions)
  '#7a746b', // Warm stone (Miscellaneous)
];

export interface CatalogCategoryOption {
  id: string;
  name: string;
  /** True = pre-selected by default during setup; False = additional category the user can opt into */
  defaultChecked: boolean;
  /** True = automatically marked as a recurring monthly item during setup (user can toggle on/off) */
  defaultRecurring?: boolean;
  taxRate?: number;
  deductiblePct?: number;
}

export interface CatalogGroupDef {
  id: string;
  mode: LedgerMode;
  name: string;
  kind: CategoryKind;
  color: string;
  column: 0 | 1;
  items: CatalogCategoryOption[];
}

/**
 * Complete Home Budget Category Catalog:
 * - Core categories are pre-checked (`defaultChecked: true`) so the user can uncheck any they don't need.
 * - Additional categories are included (`defaultChecked: false`) so the user can easily add more during setup.
 */
export const HOME_CATEGORY_CATALOG: CatalogGroupDef[] = [
  // ================= LEFT COLUMN (column: 0) =================
  {
    id: 'home-grp-income',
    mode: 'home',
    name: 'INCOME',
    kind: 'income',
    color: '#3f704d',
    column: 0,
    items: [
      { id: 'home-inc-wages', name: 'Wages & Tips', defaultChecked: true, defaultRecurring: true },
      { id: 'home-inc-interest', name: 'Interest Income', defaultChecked: true },
      { id: 'home-inc-dividends', name: 'Dividends', defaultChecked: true },
      { id: 'home-inc-gifts', name: 'Gifts Received', defaultChecked: true },
      { id: 'home-inc-refunds', name: 'Refunds/Reimbursements', defaultChecked: true },
      { id: 'home-inc-savings-transfer', name: 'Transfer from Savings', defaultChecked: true },
      { id: 'home-inc-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-inc-bonus', name: 'Bonus & Commissions', defaultChecked: false },
      { id: 'home-inc-side', name: 'Side Hustle / Freelance', defaultChecked: false },
      { id: 'home-inc-rental', name: 'Rental Property Income', defaultChecked: false, defaultRecurring: true },
      { id: 'home-inc-allowance', name: 'Child / Family Allowance', defaultChecked: false, defaultRecurring: true },
    ],
  },
  {
    id: 'home-grp-housing',
    mode: 'home',
    name: 'HOME EXPENSES',
    kind: 'expense',
    color: '#b9432f',
    column: 0,
    items: [
      { id: 'home-exp-rent', name: 'Mortgage/Rent', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-ins', name: 'Home/Rental Insurance', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-elec', name: 'Electricity', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-gas', name: 'Gas/Oil', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-water', name: 'Water/Sewer/Trash', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-phone', name: 'Phone', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-cable', name: 'Cable/Satellite', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-internet', name: 'Internet', defaultChecked: true, defaultRecurring: true },
      { id: 'home-exp-furnishings', name: 'Furnishings/Appliances', defaultChecked: true },
      { id: 'home-exp-garden', name: 'Lawn/Garden', defaultChecked: true },
      { id: 'home-exp-maint', name: 'Maintenance/Supplies', defaultChecked: true },
      { id: 'home-exp-improv', name: 'Improvements', defaultChecked: true },
      { id: 'home-exp-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-exp-proptax', name: 'Property Taxes', defaultChecked: false },
      { id: 'home-exp-hoa', name: 'HOA / Building Fees', defaultChecked: false, defaultRecurring: true },
      { id: 'home-exp-security', name: 'Home Security', defaultChecked: false, defaultRecurring: true },
      { id: 'home-exp-cleaning-srv', name: 'Cleaning Service', defaultChecked: false },
    ],
  },
  {
    id: 'home-grp-transport',
    mode: 'home',
    name: 'TRANSPORTATION',
    kind: 'expense',
    color: '#3f6e8c',
    column: 0,
    items: [
      { id: 'home-tr-vehicle', name: 'Vehicle Payments', defaultChecked: true, defaultRecurring: true },
      { id: 'home-tr-ins', name: 'Auto Insurance', defaultChecked: true, defaultRecurring: true },
      { id: 'home-tr-fuel', name: 'Fuel', defaultChecked: true },
      { id: 'home-tr-transit', name: 'Bus/Taxi/Train Fare', defaultChecked: true },
      { id: 'home-tr-repairs', name: 'Repairs', defaultChecked: true },
      { id: 'home-tr-reg', name: 'Registration/License', defaultChecked: true },
      { id: 'home-tr-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-tr-parking', name: 'Parking & Tolls', defaultChecked: false },
      { id: 'home-tr-ev', name: 'EV Charging', defaultChecked: false },
      { id: 'home-tr-bike', name: 'Bicycle / E-Bike Maintenance', defaultChecked: false },
      { id: 'home-tr-carshare', name: 'Car Sharing / Mobility', defaultChecked: false },
    ],
  },
  {
    id: 'home-grp-health',
    mode: 'home',
    name: 'HEALTH',
    kind: 'expense',
    color: '#5b7f4a',
    column: 0,
    items: [
      { id: 'home-hlth-ins', name: 'Health Insurance', defaultChecked: true, defaultRecurring: true },
      { id: 'home-hlth-doc', name: 'Doctor/Dentist', defaultChecked: true },
      { id: 'home-hlth-meds', name: 'Medicine/Drugs', defaultChecked: true },
      { id: 'home-hlth-club', name: 'Health Club Dues', defaultChecked: true, defaultRecurring: true },
      { id: 'home-hlth-life', name: 'Life Insurance', defaultChecked: true, defaultRecurring: true },
      { id: 'home-hlth-vet', name: 'Veterinarian/Pet Care', defaultChecked: true },
      { id: 'home-hlth-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-hlth-vision', name: 'Optical / Glasses & Contacts', defaultChecked: false },
      { id: 'home-hlth-therapy', name: 'Physiotherapy & Mental Health', defaultChecked: false },
      { id: 'home-hlth-supplements', name: 'Vitamins & Supplements', defaultChecked: false },
    ],
  },
  {
    id: 'home-grp-charity',
    mode: 'home',
    name: 'CHARITY/GIFTS',
    kind: 'expense',
    color: '#d97aa6',
    column: 0,
    items: [
      { id: 'home-ch-gifts', name: 'Gifts Given', defaultChecked: true },
      { id: 'home-ch-charity', name: 'Charitable Donations', defaultChecked: true },
      { id: 'home-ch-religious', name: 'Religious Donations', defaultChecked: true },
      { id: 'home-ch-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-ch-birthdays', name: 'Birthday & Holiday Celebrations', defaultChecked: false },
      { id: 'home-ch-creators', name: 'Creator Support / Crowdfunding', defaultChecked: false },
    ],
  },
  {
    id: 'home-grp-subscriptions',
    mode: 'home',
    name: 'SUBSCRIPTIONS',
    kind: 'expense',
    color: '#4c7a7b',
    column: 0,
    items: [
      { id: 'home-sub-apple', name: 'Apple One', defaultChecked: true, defaultRecurring: true },
      { id: 'home-sub-youtube', name: 'Youtube Premium', defaultChecked: true, defaultRecurring: true },
      { id: 'home-sub-amazon', name: 'Amazon Prime', defaultChecked: true, defaultRecurring: true },
      { id: 'home-sub-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-sub-spotify', name: 'Spotify / Music Streaming', defaultChecked: false, defaultRecurring: true },
      { id: 'home-sub-icloud', name: 'iCloud / Cloud Storage', defaultChecked: false, defaultRecurring: true },
      { id: 'home-sub-netflix', name: 'Netflix / Video Streaming', defaultChecked: false, defaultRecurring: true },
      { id: 'home-sub-ai', name: 'AI & Productivity Subscriptions', defaultChecked: false, defaultRecurring: true },
      { id: 'home-sub-news', name: 'News & Digital Magazines', defaultChecked: false, defaultRecurring: true },
    ],
  },

  // ================= RIGHT COLUMN (column: 1) =================
  {
    id: 'home-grp-daily',
    mode: 'home',
    name: 'DAILY LIVING',
    kind: 'expense',
    color: '#b8862d',
    column: 1,
    items: [
      { id: 'home-dl-groceries', name: 'Groceries', defaultChecked: true },
      { id: 'home-dl-supplies', name: 'Personal Supplies', defaultChecked: true },
      { id: 'home-dl-clothing', name: 'Clothing', defaultChecked: true },
      { id: 'home-dl-cleaning', name: 'Cleaning', defaultChecked: true },
      { id: 'home-dl-edu', name: 'Education/Lessons', defaultChecked: true },
      { id: 'home-dl-dining', name: 'Dining/Eating Out', defaultChecked: true },
      { id: 'home-dl-salon', name: 'Salon/Barber', defaultChecked: true },
      { id: 'home-dl-petfood', name: 'Pet Food', defaultChecked: true },
      { id: 'home-dl-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-dl-coffee', name: 'Coffee & Bakeries', defaultChecked: false },
      { id: 'home-dl-lunch', name: 'Work Lunches', defaultChecked: false },
      { id: 'home-dl-childcare', name: 'Childcare / Daycare', defaultChecked: false, defaultRecurring: true },
      { id: 'home-dl-laundry', name: 'Dry Cleaning & Tailoring', defaultChecked: false },
    ],
  },
  {
    id: 'home-grp-entertainment',
    mode: 'home',
    name: 'ENTERTAINMENT',
    kind: 'expense',
    color: '#8a6fb0',
    column: 1,
    items: [
      { id: 'home-ent-activities', name: 'Activities', defaultChecked: true },
      { id: 'home-ent-books', name: 'Books', defaultChecked: true },
      { id: 'home-ent-games', name: 'Games', defaultChecked: true },
      { id: 'home-ent-fun', name: 'Fun Stuff', defaultChecked: true },
      { id: 'home-ent-hobbies', name: 'Hobbies', defaultChecked: true },
      { id: 'home-ent-media', name: 'Media', defaultChecked: true },
      { id: 'home-ent-outdoor', name: 'Outdoor Recreation', defaultChecked: true },
      { id: 'home-ent-sports', name: 'Sports', defaultChecked: true },
      { id: 'home-ent-toys', name: 'Toys/Gadgets', defaultChecked: true },
      { id: 'home-ent-vacation', name: 'Vacation/Travel', defaultChecked: true },
      { id: 'home-ent-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-ent-gym', name: 'Gym & Fitness Membership', defaultChecked: false, defaultRecurring: true },
      { id: 'home-ent-concerts', name: 'Concerts, Cinema & Events', defaultChecked: false },
      { id: 'home-ent-music', name: 'Instruments & Audio Gear', defaultChecked: false },
    ],
  },
  {
    id: 'home-grp-savings',
    mode: 'home',
    name: 'SAVINGS',
    kind: 'savings',
    color: '#3f704d',
    column: 1,
    items: [
      { id: 'home-sav-emergency', name: 'Emergency Fund', defaultChecked: true, defaultRecurring: true },
      { id: 'home-sav-car', name: 'Car Replacement', defaultChecked: true },
      { id: 'home-sav-retirement', name: 'Retirement Fund', defaultChecked: true, defaultRecurring: true },
      { id: 'home-sav-investments', name: 'Investments', defaultChecked: true, defaultRecurring: true },
      { id: 'home-sav-education', name: 'Education Fund', defaultChecked: true },
      { id: 'home-sav-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-sav-house', name: 'Home Down Payment Fund', defaultChecked: false },
      { id: 'home-sav-holiday', name: 'Holiday & Travel Sinking Fund', defaultChecked: false },
      { id: 'home-sav-pillar3a', name: 'Pillar 3a / Tax-Advantaged Pension', defaultChecked: false, defaultRecurring: true },
    ],
  },
  {
    id: 'home-grp-obligations',
    mode: 'home',
    name: 'OBLIGATIONS',
    kind: 'expense',
    color: '#c46d5e',
    column: 1,
    items: [
      { id: 'home-obl-student', name: 'Student Loans', defaultChecked: true, defaultRecurring: true },
      { id: 'home-obl-cc', name: 'Credit Cards', defaultChecked: true },
      { id: 'home-obl-loans', name: 'Other Loans', defaultChecked: true, defaultRecurring: true },
      { id: 'home-obl-alimony', name: 'Alimony/Child Support', defaultChecked: true, defaultRecurring: true },
      { id: 'home-obl-fedtax', name: 'Federal Taxes', defaultChecked: true },
      { id: 'home-obl-statetax', name: 'State/Local Taxes', defaultChecked: true },
      { id: 'home-obl-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-obl-tuition', name: 'Continuing Education & Tuition Fees', defaultChecked: false },
      { id: 'home-obl-social', name: 'Social Security / Pension Contributions', defaultChecked: false, defaultRecurring: true },
      { id: 'home-obl-legal', name: 'Legal & Administrative Obligations', defaultChecked: false },
    ],
  },
  {
    id: 'home-grp-misc',
    mode: 'home',
    name: 'MISCELLANEOUS',
    kind: 'expense',
    color: '#7a746b',
    column: 1,
    items: [
      { id: 'home-misc-bank', name: 'Bank Fees', defaultChecked: true },
      { id: 'home-misc-postage', name: 'Postage', defaultChecked: true },
      { id: 'home-misc-other', name: 'Other', defaultChecked: true },
      // Additional selectable categories
      { id: 'home-misc-atm', name: 'Cash / ATM Withdrawals', defaultChecked: false },
      { id: 'home-misc-notary', name: 'Notary & Official Documents', defaultChecked: false },
    ],
  },
];

/**
 * Complete Freelancer & Business Category Catalog:
 * - Core freelancer categories are pre-checked (`defaultChecked: true`).
 * - Additional specialized categories are available (`defaultChecked: false`).
 */
export const FREELANCER_CATEGORY_CATALOG: CatalogGroupDef[] = [
  // ================= LEFT COLUMN (column: 0) =================
  {
    id: 'biz-grp-income',
    mode: 'freelancer',
    name: 'BUSINESS REVENUE',
    kind: 'income',
    color: '#3f704d',
    column: 0,
    items: [
      { id: 'biz-inc-projects', name: 'Client Projects & Development', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-inc-retainers', name: 'Monthly Retainers & Support', defaultChecked: true, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-inc-consulting', name: 'Consulting & Advisory', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-inc-products', name: 'Digital Products & Licenses', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-inc-reimbursed', name: 'Reimbursed Client Expenses', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-inc-other', name: 'Other Business Revenue', defaultChecked: true, taxRate: 0, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-inc-workshops', name: 'Workshops, Speaking & Training', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-inc-royalties', name: 'Royalties & Affiliate Revenue', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
    ],
  },
  {
    id: 'biz-grp-office',
    mode: 'freelancer',
    name: 'WORKSPACE & OPERATIONS',
    kind: 'expense',
    color: '#3f6e8c',
    column: 0,
    items: [
      { id: 'biz-off-cowork', name: 'Coworking / Studio Rent', defaultChecked: true, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-off-homeoffice', name: 'Home Office Deduction Share', defaultChecked: true, defaultRecurring: true, taxRate: 0, deductiblePct: 100 },
      { id: 'biz-off-internet', name: 'Business Internet & Mobile', defaultChecked: true, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-off-supplies', name: 'Office Supplies & Stationery', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-off-insurance', name: 'Professional Liability Insurance', defaultChecked: true, defaultRecurring: true, taxRate: 0, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-off-shipping', name: 'Postage, Courier & Packaging', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-off-cyber', name: 'Cyber & Equipment Insurance', defaultChecked: false, defaultRecurring: true, taxRate: 0, deductiblePct: 100 },
      { id: 'biz-off-utilities', name: 'Studio Electricity & Utilities', defaultChecked: false, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
    ],
  },
  {
    id: 'biz-grp-software',
    mode: 'freelancer',
    name: 'SOFTWARE, CLOUD & AI (SaaS)',
    kind: 'expense',
    color: '#8a6fb0',
    column: 0,
    items: [
      { id: 'biz-sw-cloud', name: 'Cloud Hosting, Domains & Servers', defaultChecked: true, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-sw-ai', name: 'AI & Developer Subscriptions', defaultChecked: true, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-sw-design', name: 'Design & Creative Suite', defaultChecked: true, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-sw-accounting', name: 'Accounting & Invoicing Tools', defaultChecked: true, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-sw-api', name: 'API Usage & Compute Credits', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-sw-assets', name: 'Stock Assets, Fonts & Licenses', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-sw-security', name: 'Backup, VPN & Security Tools', defaultChecked: false, defaultRecurring: true, taxRate: 8.1, deductiblePct: 100 },
    ],
  },
  {
    id: 'biz-grp-hardware',
    mode: 'freelancer',
    name: 'HARDWARE & EQUIPMENT',
    kind: 'expense',
    color: '#b9432f',
    column: 0,
    items: [
      { id: 'biz-hw-compute', name: 'Workstation, Laptop & Displays', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-hw-peripherals', name: 'Audio, Video & Peripherals', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-hw-furniture', name: 'Ergonomic Desk & Chair', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-hw-mobile', name: 'Test Devices & Tablets', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-hw-repairs', name: 'Hardware Maintenance & Repairs', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
    ],
  },

  // ================= RIGHT COLUMN (column: 1) =================
  {
    id: 'biz-grp-marketing',
    mode: 'freelancer',
    name: 'MARKETING & CLIENT RELATIONS',
    kind: 'expense',
    color: '#b8862d',
    column: 1,
    items: [
      { id: 'biz-mkt-ads', name: 'Portfolio, Website & Ads', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-mkt-meals', name: 'Client Meals & Hospitality', defaultChecked: true, taxRate: 8.1, deductiblePct: 50 },
      { id: 'biz-mkt-events', name: 'Conferences & Networking', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-mkt-edu', name: 'Professional Literature & Courses', defaultChecked: true, taxRate: 2.6, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-mkt-gifts', name: 'Client Appreciation Gifts', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-mkt-print', name: 'Business Cards & Print Media', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
    ],
  },
  {
    id: 'biz-grp-professional',
    mode: 'freelancer',
    name: 'PROFESSIONAL & BANKING',
    kind: 'expense',
    color: '#4c7a7b',
    column: 1,
    items: [
      { id: 'biz-prof-tax', name: 'Tax Advisor & Bookkeeping', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-prof-legal', name: 'Legal & Contract Review', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-prof-sub', name: 'Subcontractors & Specialists', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-prof-bank', name: 'Business Bank & Payment Fees', defaultChecked: true, defaultRecurring: true, taxRate: 0, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-prof-fx', name: 'Stripe / PayPal & FX Fees', defaultChecked: false, taxRate: 0, deductiblePct: 100 },
      { id: 'biz-prof-assoc', name: 'Trade Associations & Memberships', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
    ],
  },
  {
    id: 'biz-grp-travel',
    mode: 'freelancer',
    name: 'BUSINESS TRAVEL & TRANSIT',
    kind: 'expense',
    color: '#c46d5e',
    column: 1,
    items: [
      { id: 'biz-trv-rail', name: 'Rail Pass / Client Transit', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-trv-flights', name: 'Flights & Hotel Lodging', defaultChecked: true, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-trv-mileage', name: 'Vehicle Mileage Allowance', defaultChecked: true, taxRate: 0, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-trv-perdiem', name: 'Travel Per Diem & Meals', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
      { id: 'biz-trv-carrental', name: 'Rental Car & Taxi', defaultChecked: false, taxRate: 8.1, deductiblePct: 100 },
    ],
  },
  {
    id: 'biz-grp-taxes',
    mode: 'freelancer',
    name: 'TAX & SOCIAL RESERVES',
    kind: 'savings',
    color: '#3f704d',
    column: 1,
    items: [
      { id: 'biz-tax-income', name: 'Income Tax Reserve Set-Aside', defaultChecked: true, defaultRecurring: true, taxRate: 0, deductiblePct: 0 },
      { id: 'biz-tax-vat', name: 'VAT / Sales Tax Settlement', defaultChecked: true, taxRate: 0, deductiblePct: 0 },
      { id: 'biz-tax-social', name: 'Social Security Contributions', defaultChecked: true, defaultRecurring: true, taxRate: 0, deductiblePct: 100 },
      { id: 'biz-tax-pension', name: 'Self-Employed Pension / Pillar 3a', defaultChecked: true, defaultRecurring: true, taxRate: 0, deductiblePct: 100 },
      // Additional selectable categories
      { id: 'biz-tax-sickness', name: 'Daily Sickness & Accident Insurance', defaultChecked: false, defaultRecurring: true, taxRate: 0, deductiblePct: 100 },
    ],
  },
];

export function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getDefaultCheckedCategoryIds(catalog: CatalogGroupDef[]): Set<string> {
  const set = new Set<string>();
  for (const grp of catalog) {
    for (const item of grp.items) {
      if (item.defaultChecked) {
        set.add(item.id);
      }
    }
  }
  return set;
}

export function getDefaultRecurringCategoryIds(
  catalogs: CatalogGroupDef[][] = [
    HOME_CATEGORY_CATALOG,
    FREELANCER_CATEGORY_CATALOG,
  ]
): Set<string> {
  const set = new Set<string>();
  for (const catalog of catalogs) {
    for (const grp of catalog) {
      for (const item of grp.items) {
        if (item.defaultRecurring) {
          set.add(item.id);
        }
      }
    }
  }
  return set;
}

export function buildModeDataFromCatalog(
  catalog: CatalogGroupDef[],
  selectedCategoryIds: Set<string>,
  customItemsByGroup: Record<string, string[]>,
  monthKey: string,
  recurringCategoryIds?: Set<string>
): {
  groups: CategoryGroup[];
  categories: CategoryItem[];
  monthlyBudgets: MonthlyBudgetEntry[];
  recurringRules: RecurringRule[];
} {
  const groups: CategoryGroup[] = [];
  const categories: CategoryItem[] = [];
  const monthlyBudgets: MonthlyBudgetEntry[] = [];
  const recurringRules: RecurringRule[] = [];

  catalog.forEach((cg, gIdx) => {
    const selectedStandard = cg.items.filter((item) =>
      selectedCategoryIds.has(item.id)
    );
    const customNames = customItemsByGroup[cg.id] ?? [];

    // Include the group even if empty so user can add to it later, or when it has items
    groups.push({
      id: cg.id,
      mode: cg.mode,
      name: cg.name,
      kind: cg.kind,
      color: cg.color,
      column: cg.column,
      order: gIdx,
    });

    let cOrder = 0;
    for (const item of selectedStandard) {
      const isRec = recurringCategoryIds
        ? recurringCategoryIds.has(item.id)
        : Boolean(item.defaultRecurring);

      categories.push({
        id: item.id,
        groupId: cg.id,
        mode: cg.mode,
        name: item.name,
        kind: cg.kind,
        defaultBudget: 0,
        isRecurring: isRec,
        taxRate: item.taxRate ?? 0,
        deductiblePct:
          item.deductiblePct ?? (cg.mode === 'freelancer' ? 100 : 0),
        order: cOrder++,
      });

      monthlyBudgets.push({
        monthKey,
        categoryId: item.id,
        budget: 0,
        directActual: null,
      });

      if (isRec) {
        recurringRules.push({
          id: `rec-init-${item.id}`,
          mode: cg.mode,
          type: cg.kind === 'income' ? 'income' : 'expense',
          categoryId: item.id,
          description: item.name,
          amount: 0,
          frequency: 'monthly',
          dayOfMonth: cg.kind === 'income' ? 25 : 1,
          taxRate: item.taxRate ?? 0,
          deductiblePct:
            item.deductiblePct ?? (cg.mode === 'freelancer' ? 100 : 0),
          active: true,
        });
      }
    }

    for (const customName of customNames) {
      const customKey = `custom:${cg.id}:${customName}`;
      const isRec = recurringCategoryIds
        ? recurringCategoryIds.has(customKey)
        : false;
      const customId = `${cg.id}-custom-${cOrder}-${Date.now()}`;
      categories.push({
        id: customId,
        groupId: cg.id,
        mode: cg.mode,
        name: customName,
        kind: cg.kind,
        defaultBudget: 0,
        isRecurring: isRec,
        taxRate: cg.mode === 'freelancer' ? 8.1 : 0,
        deductiblePct: cg.mode === 'freelancer' ? 100 : 0,
        order: cOrder++,
      });

      monthlyBudgets.push({
        monthKey,
        categoryId: customId,
        budget: 0,
        directActual: null,
      });

      if (isRec) {
        recurringRules.push({
          id: `rec-init-${customId}`,
          mode: cg.mode,
          type: cg.kind === 'income' ? 'income' : 'expense',
          categoryId: customId,
          description: customName,
          amount: 0,
          frequency: 'monthly',
          dayOfMonth: cg.kind === 'income' ? 25 : 1,
          taxRate: cg.mode === 'freelancer' ? 8.1 : 0,
          deductiblePct: cg.mode === 'freelancer' ? 100 : 0,
          active: true,
        });
      }
    }
  });

  return { groups, categories, monthlyBudgets, recurringRules };
}

export const ACCOUNT_TYPE_META: Record<
  AccountType,
  {
    label: string;
    shortLabel: string;
    defaultClass: AccountLiquidityClass;
    defaultColor: string;
    autoTrackDefault: boolean;
  }
> = {
  checking: {
    label: 'Bank Checking / Everyday Account',
    shortLabel: 'Bank Checking',
    defaultClass: 'liquid',
    defaultColor: '#3f704d',
    autoTrackDefault: true,
  },
  savings: {
    label: 'Bank Savings / High-Yield Account',
    shortLabel: 'Bank Savings',
    defaultClass: 'liquid',
    defaultColor: '#5b7f4a',
    autoTrackDefault: true,
  },
  cash: {
    label: 'Cash / Digital Wallet / Emergency Reserve',
    shortLabel: 'Cash & Wallet',
    defaultClass: 'liquid',
    defaultColor: '#b8862d',
    autoTrackDefault: true,
  },
  business_bank: {
    label: 'Freelancer / Business Bank Account',
    shortLabel: 'Business Bank',
    defaultClass: 'liquid',
    defaultColor: '#3f6e8c',
    autoTrackDefault: true,
  },
  tax_reserve: {
    label: 'Tax & VAT Reserve Account',
    shortLabel: 'Tax Reserve',
    defaultClass: 'liquid',
    defaultColor: '#4c7a7b',
    autoTrackDefault: true,
  },
  retirement: {
    label: 'Retirement / Pension (Pillar 2 / 3a / 401k / IRA)',
    shortLabel: 'Retirement',
    defaultClass: 'retirement',
    defaultColor: '#8a6fb0',
    autoTrackDefault: false,
  },
  brokerage: {
    label: 'Brokerage / ETFs & Securities',
    shortLabel: 'Brokerage / ETFs',
    defaultClass: 'investment',
    defaultColor: '#3f6e8c',
    autoTrackDefault: false,
  },
  crypto: {
    label: 'Crypto & Digital Assets',
    shortLabel: 'Crypto Assets',
    defaultClass: 'investment',
    defaultColor: '#b8862d',
    autoTrackDefault: false,
  },
  real_estate: {
    label: 'Property / Real Estate / Home Equity',
    shortLabel: 'Real Estate',
    defaultClass: 'fixed_asset',
    defaultColor: '#7a746b',
    autoTrackDefault: false,
  },
  credit_card: {
    label: 'Credit Card Balance (Liability)',
    shortLabel: 'Credit Card',
    defaultClass: 'liability',
    defaultColor: '#b9432f',
    autoTrackDefault: true,
  },
  loan: {
    label: 'Loan / Mortgage / Debt (Liability)',
    shortLabel: 'Loan / Mortgage',
    defaultClass: 'liability',
    defaultColor: '#c46d5e',
    autoTrackDefault: false,
  },
  custom: {
    label: 'Custom Account Type',
    shortLabel: 'Custom',
    defaultClass: 'liquid',
    defaultColor: '#4c7a7b',
    autoTrackDefault: false,
  },
};

export const ACCOUNT_CLASS_META: Record<
  AccountLiquidityClass,
  {
    label: string;
    description: string;
    color: string;
  }
> = {
  liquid: {
    label: 'Liquid Assets (Bank & Cash)',
    description: 'Checking, savings, cash, business operating, and tax reserve accounts immediately accessible.',
    color: '#3f704d',
  },
  retirement: {
    label: 'Retirement & Pension Accounts',
    description: 'Pillar 2, Pillar 3a, pension funds, 401(k)/IRA, and long-term tax-advantaged retirement accounts.',
    color: '#8a6fb0',
  },
  investment: {
    label: 'Investments & Market Portfolio',
    description: 'Brokerage portfolios, ETFs, stocks, bonds, crypto, precious metals, and custom investments.',
    color: '#3f6e8c',
  },
  fixed_asset: {
    label: 'Real Estate & Fixed Assets',
    description: 'Property equity, real estate, vehicles, business equipment, and illiquid physical assets.',
    color: '#b8862d',
  },
  liability: {
    label: 'Liabilities & Debt',
    description: 'Credit card balances, mortgages, student loans, and other obligations subtracted from Net Worth.',
    color: '#b9432f',
  },
};

export function getDefaultReturnRateForAccount(
  acc: Pick<FinancialAccount, 'type' | 'classification' | 'expectedAnnualReturnPct'>
): number {
  if (typeof acc.expectedAnnualReturnPct === 'number') {
    return acc.expectedAnnualReturnPct;
  }
  switch (acc.type) {
    case 'brokerage':
      return 7.5;
    case 'crypto':
      return 10.0;
    case 'retirement':
      return 5.5;
    case 'real_estate':
      return 3.5;
    case 'savings':
      return 1.5;
    case 'tax_reserve':
      return 1.0;
    default:
      if (acc.classification === 'investment') return 7.0;
      if (acc.classification === 'retirement') return 5.5;
      if (acc.classification === 'fixed_asset') return 3.0;
      return 0;
  }
}

export function createDefaultOnboardingAccounts(
  setupMode: ProfileSetupMode = 'both'
): FinancialAccount[] {
  const today = new Date().toISOString().slice(0, 10);
  const list: FinancialAccount[] = [];

  if (setupMode === 'home' || setupMode === 'both') {
    list.push(
      {
        id: 'acc-home-checking-main',
        name: 'Main Checking Account',
        institution: 'Primary Bank',
        mode: 'home',
        type: 'checking',
        classification: 'liquid',
        startingBalance: 0,
        currentBalance: 0,
        autoTrackTransactions: true,
        includeInNetWorth: true,
        expectedAnnualReturnPct: 0,
        color: '#3f704d',
        updatedAt: today,
      },
      {
        id: 'acc-home-savings-reserve',
        name: 'Savings & Emergency Account',
        institution: 'Savings Bank',
        mode: 'home',
        type: 'savings',
        classification: 'liquid',
        startingBalance: 0,
        currentBalance: 0,
        autoTrackTransactions: true,
        includeInNetWorth: true,
        expectedAnnualReturnPct: 1.5,
        color: '#5b7f4a',
        updatedAt: today,
      },
      {
        id: 'acc-home-retirement-3a',
        name: 'Private Retirement (Pillar 3a / IRA)',
        institution: 'Retirement Foundation',
        mode: 'home',
        type: 'retirement',
        classification: 'retirement',
        startingBalance: 0,
        currentBalance: 0,
        autoTrackTransactions: false,
        includeInNetWorth: true,
        expectedAnnualReturnPct: 5.5,
        color: '#8a6fb0',
        updatedAt: today,
      },
      {
        id: 'acc-home-retirement-pension',
        name: 'Pension Fund (Pillar 2 / Occupational)',
        institution: 'Pension Fund',
        mode: 'home',
        type: 'retirement',
        classification: 'retirement',
        startingBalance: 0,
        currentBalance: 0,
        autoTrackTransactions: false,
        includeInNetWorth: true,
        expectedAnnualReturnPct: 4.5,
        color: '#8a6fb0',
        updatedAt: today,
      },
      {
        id: 'acc-home-brokerage',
        name: 'Investment / ETF Portfolio',
        institution: 'Brokerage',
        mode: 'home',
        type: 'brokerage',
        classification: 'investment',
        startingBalance: 0,
        currentBalance: 0,
        autoTrackTransactions: false,
        includeInNetWorth: true,
        expectedAnnualReturnPct: 7.5,
        color: '#3f6e8c',
        updatedAt: today,
      }
    );
  }

  if (setupMode === 'freelancer' || setupMode === 'both') {
    list.push(
      {
        id: 'acc-biz-checking',
        name: 'Business Operating Bank Account',
        institution: 'Business Bank',
        mode: 'freelancer',
        type: 'business_bank',
        classification: 'liquid',
        startingBalance: 0,
        currentBalance: 0,
        autoTrackTransactions: true,
        includeInNetWorth: true,
        expectedAnnualReturnPct: 0,
        color: '#3f6e8c',
        updatedAt: today,
      },
      {
        id: 'acc-biz-tax-reserve',
        name: 'Tax & VAT Reserve Sub-Account',
        institution: 'Business Bank',
        mode: 'freelancer',
        type: 'tax_reserve',
        classification: 'liquid',
        startingBalance: 0,
        currentBalance: 0,
        autoTrackTransactions: true,
        includeInNetWorth: true,
        expectedAnnualReturnPct: 1.0,
        color: '#4c7a7b',
        updatedAt: today,
      }
    );
  }

  return list;
}

export function createInitialLedgerState(
  setupMode: ProfileSetupMode = 'both',
  currency = 'CHF',
  backupDir = '',
  setupCompleted = false,
  selectedHomeIds?: Set<string>,
  selectedFreelancerIds?: Set<string>,
  customItemsByGroup: Record<string, string[]> = {},
  initialAccounts?: FinancialAccount[],
  initialNetWorthSnapshots?: NetWorthSnapshot[],
  recurringCategoryIds?: Set<string>
): LedgerState {
  const now = new Date();
  const activeYear = now.getFullYear();
  const activeMonth = now.getMonth() + 1;
  const monthKey = formatMonthKey(activeYear, activeMonth);

  const homeSet =
    selectedHomeIds ?? getDefaultCheckedCategoryIds(HOME_CATEGORY_CATALOG);
  const freelancerSet =
    selectedFreelancerIds ??
    getDefaultCheckedCategoryIds(FREELANCER_CATEGORY_CATALOG);

  const homeData = buildModeDataFromCatalog(
    HOME_CATEGORY_CATALOG,
    homeSet,
    customItemsByGroup,
    monthKey,
    recurringCategoryIds
  );
  const freelancerData = buildModeDataFromCatalog(
    FREELANCER_CATEGORY_CATALOG,
    freelancerSet,
    customItemsByGroup,
    monthKey,
    recurringCategoryIds
  );

  const savingsGoals: SavingsGoal[] = [
    {
      id: 'goal-home-emergency',
      mode: 'home',
      name: 'Emergency Reserve',
      targetAmount: 15000,
      currentAmount: 0,
      monthlyContribution: 500,
      targetDate: `${activeYear + 1}-12-31`,
      color: '#3f704d',
    },
    {
      id: 'goal-biz-tax',
      mode: 'freelancer',
      name: 'Annual Tax & VAT Provision',
      targetAmount: 12000,
      currentAmount: 0,
      monthlyContribution: 1000,
      targetDate: `${activeYear + 1}-03-31`,
      color: '#3f6e8c',
    },
  ];

  const accounts =
    initialAccounts ?? createDefaultOnboardingAccounts(setupMode);

  return {
    version: 1,
    settings: {
      setupCompleted,
      setupMode,
      activeWorkspace: setupMode === 'freelancer' ? 'freelancer' : 'home',
      currency,
      theme: 'system',
      themePalette: 'default',
      density: 'comfortable',
      highContrastAmounts: false,
      backupDir,
      autoBackup: Boolean(backupDir),
      maxBackups: 20,
      defaultVatRate: 8.1,
      taxReserveRate: 25,
      activeYear,
      activeMonth,
      confirmBeforeMonthCopy: true,
      monthCopyScope: 'budgets_and_actuals',
      monthCopyOverwriteExisting: true,
      autoPromptCopyOnEmptyMonth: true,
      confirmBeforeDelete: true,
      defaultHideZeroRows: false,
      confirmAndPreviewBeforeImport: true,
    },
    groups: [...homeData.groups, ...freelancerData.groups],
    categories: [...homeData.categories, ...freelancerData.categories],
    monthlyBudgets: [
      ...homeData.monthlyBudgets,
      ...freelancerData.monthlyBudgets,
    ],
    transactions: [],
    recurringRules: [
      ...homeData.recurringRules,
      ...freelancerData.recurringRules,
    ],
    savingsGoals,
    accounts,
    netWorthSnapshots: initialNetWorthSnapshots ?? [],
  };
}
