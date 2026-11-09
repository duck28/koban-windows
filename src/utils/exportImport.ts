import * as XLSX from 'xlsx';
import {
  ActiveWorkspace,
  CategoryGroup,
  CategoryItem,
  CategoryKind,
  LedgerMode,
  LedgerState,
  TransactionItem,
} from '../types';
import {
  computeAnnualSeries,
  computeMonthSummary,
  computeNetWorthMetrics,
  GroupComputedSummary,
} from './calculations';
import {
  pickSaveFileDialog,
  saveBinaryFile,
  saveTextFile,
} from './storage';

function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n');
}

/**
 * Builds the 2-column side-by-side Monthly Budget matrix.
 */
export function buildMonthlyBudgetMatrix(
  state: LedgerState,
  monthKey: string,
  workspace: ActiveWorkspace
): (string | number)[][] {
  const summary = computeMonthSummary(state, monthKey, workspace);

  const leftGroups = summary.groups.filter((g) => g.group.column === 0);
  const rightGroups = summary.groups.filter((g) => g.group.column === 1);

  const buildBlockRows = (gs: GroupComputedSummary): (string | number)[][] => {
    const out: (string | number)[][] = [];
    out.push([gs.group.name, 'Budget', 'Actual', 'Difference']);
    for (const r of gs.rows) {
      out.push([
        r.category.name,
        Number(r.budget.toFixed(2)),
        Number(r.actual.toFixed(2)),
        Number(r.difference.toFixed(2)),
      ]);
    }
    out.push([
      `Total ${gs.group.name}`,
      Number(gs.totalBudget.toFixed(2)),
      Number(gs.totalActual.toFixed(2)),
      Number(gs.totalDifference.toFixed(2)),
    ]);
    out.push(['', '', '', '']);
    return out;
  };

  const leftColRows: (string | number)[][] = [];
  for (const lg of leftGroups) {
    leftColRows.push(...buildBlockRows(lg));
  }

  const rightColRows: (string | number)[][] = [
    ['BUDGET SUMMARY', 'Budget', 'Actual', 'Difference'],
    [
      'Total Income',
      Number(summary.incomeBudget.toFixed(2)),
      Number(summary.incomeActual.toFixed(2)),
      Number(summary.incomeDifference.toFixed(2)),
    ],
    [
      'Total Expenses',
      Number(summary.totalOutflowBudget.toFixed(2)),
      Number(summary.totalOutflowActual.toFixed(2)),
      Number(summary.totalOutflowDifference.toFixed(2)),
    ],
    [
      'NET',
      Number(summary.netBudget.toFixed(2)),
      Number(summary.netActual.toFixed(2)),
      Number(summary.netDifference.toFixed(2)),
    ],
    ['', '', '', ''],
  ];

  for (const rg of rightGroups) {
    rightColRows.push(...buildBlockRows(rg));
  }

  const maxLen = Math.max(leftColRows.length, rightColRows.length);
  const matrix: (string | number)[][] = [
    [
      `Koban — ${workspace === 'freelancer' ? 'Freelancer & Business' : workspace === 'combined' ? 'Combined Home & Business' : 'Personal Monthly'} Budget (${monthKey})`,
      '',
      '',
      '',
      '',
      `Currency: ${state.settings.currency}`,
      '',
      '',
      '',
    ],
    ['', '', '', '', '', '', '', '', ''],
  ];

  for (let i = 0; i < maxLen; i++) {
    const l = leftColRows[i] ?? ['', '', '', ''];
    const r = rightColRows[i] ?? ['', '', '', ''];
    matrix.push([l[0], l[1], l[2], l[3], '', r[0], r[1], r[2], r[3]]);
  }

  return matrix;
}

export async function exportExcelWorkbook(
  state: LedgerState,
  monthKey: string,
  workspace: ActiveWorkspace
): Promise<string | null> {
  const defaultName = `Koban-${workspace}-${monthKey}.xlsx`;
  const savePath = await pickSaveFileDialog(
    defaultName,
    'Excel Workbook (*.xlsx)',
    ['xlsx']
  );
  if (!savePath) return null;

  const wb = XLSX.utils.book_new();

  // 1. 2-Column Monthly Budget Sheet
  const budgetMatrix = buildMonthlyBudgetMatrix(state, monthKey, workspace);
  const wsWorksheet = XLSX.utils.aoa_to_sheet(budgetMatrix);
  wsWorksheet['!cols'] = [
    { wch: 30 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 4 },
    { wch: 30 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
  ];
  XLSX.utils.book_append_sheet(wb, wsWorksheet, `Budget ${monthKey}`);

  // 2. Flat Category Breakdown Sheet
  const summary = computeMonthSummary(state, monthKey, workspace);
  const flatRows: (string | number)[][] = [
    [
      'Mode',
      'Group',
      'Category',
      'Kind',
      'Budget',
      'Actual',
      'Difference',
      'Transactions Count',
      'Tax / VAT %',
      'Deductible %',
      'Deductible Amount',
    ],
  ];
  for (const gs of summary.groups) {
    for (const r of gs.rows) {
      flatRows.push([
        r.category.mode,
        gs.group.name,
        r.category.name,
        gs.group.kind,
        Number(r.budget.toFixed(2)),
        Number(r.actual.toFixed(2)),
        Number(r.difference.toFixed(2)),
        r.txCount,
        r.category.taxRate ?? 0,
        r.category.deductiblePct ?? 0,
        Number(r.deductibleActual.toFixed(2)),
      ]);
    }
  }
  const wsFlat = XLSX.utils.aoa_to_sheet(flatRows);
  wsFlat['!cols'] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsFlat, 'Category Breakdown');

  // 3. 12-Month Annual Cashflow Sheet
  const annual = computeAnnualSeries(state, state.settings.activeYear, workspace);
  const annualRows: (string | number)[][] = [
    [
      'Month',
      'Month Key',
      'Income (Budget)',
      'Income (Actual)',
      'Total Outflow (Budget)',
      'Total Outflow (Actual)',
      'NET (Budget)',
      'NET (Actual)',
    ],
  ];
  for (const pt of annual) {
    annualRows.push([
      pt.monthLabel,
      pt.monthKey,
      Number(pt.incomeBudget.toFixed(2)),
      Number(pt.incomeActual.toFixed(2)),
      Number(pt.outflowBudget.toFixed(2)),
      Number(pt.outflowActual.toFixed(2)),
      Number(pt.netBudget.toFixed(2)),
      Number(pt.netActual.toFixed(2)),
    ]);
  }
  const wsAnnual = XLSX.utils.aoa_to_sheet(annualRows);
  wsAnnual['!cols'] = [
    { wch: 10 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAnnual, `Annual ${state.settings.activeYear}`);

  // 4. Transactions Ledger Sheet
  const catMap = new Map(state.categories.map((c) => [c.id, c]));
  const grpMap = new Map(state.groups.map((g) => [g.id, g]));
  const txRows: (string | number)[][] = [
    [
      'Date',
      'Month',
      'Mode',
      'Type',
      'Group',
      'Category',
      'Description',
      'Amount',
      'Client / Project',
      'Invoice / Ref',
      'VAT %',
      'Deductible %',
      'Payment Method',
      'Status',
    ],
  ];
  const filteredTxs = state.transactions
    .filter((t) => (workspace === 'combined' ? true : t.mode === workspace))
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const tx of filteredTxs) {
    const cat = catMap.get(tx.categoryId);
    const grp = cat ? grpMap.get(cat.groupId) : undefined;
    txRows.push([
      tx.date,
      tx.monthKey,
      tx.mode,
      tx.type,
      grp?.name ?? '',
      cat?.name ?? '',
      tx.description,
      Number(tx.amount.toFixed(2)),
      tx.client ?? '',
      tx.invoiceRef ?? '',
      tx.taxRate ?? 0,
      tx.deductiblePct ?? 0,
      tx.paymentMethod ?? '',
      tx.status ?? 'cleared',
    ]);
  }
  const wsTx = XLSX.utils.aoa_to_sheet(txRows);
  wsTx['!cols'] = [
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 22 },
    { wch: 26 },
    { wch: 28 },
    { wch: 12 },
    { wch: 22 },
    { wch: 16 },
    { wch: 10 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions');

  // 5. Accounts & Net Worth Sheet
  const nw = computeNetWorthMetrics(state, workspace, summary.totalOutflowActual);
  const nwRows: (string | number)[][] = [
    ['NET WORTH SUMMARY', 'Amount', 'Currency'],
    ['Liquid Assets (Bank & Cash)', Number(nw.liquidAssets.toFixed(2)), state.settings.currency],
    ['Retirement & Pension Accounts', Number(nw.retirementAssets.toFixed(2)), state.settings.currency],
    ['Investments & Market Portfolio', Number(nw.investmentAssets.toFixed(2)), state.settings.currency],
    ['Fixed & Real Estate Assets', Number(nw.fixedAssets.toFixed(2)), state.settings.currency],
    ['Total Assets', Number(nw.totalAssets.toFixed(2)), state.settings.currency],
    ['Total Liabilities & Debt', Number(nw.totalLiabilities.toFixed(2)), state.settings.currency],
    ['TOTAL NET WORTH', Number(nw.netWorth.toFixed(2)), state.settings.currency],
    [],
    [
      'Account Name',
      'Institution',
      'Mode',
      'Type',
      'Classification',
      'Opening Balance',
      'Live Balance',
      'Auto-Track Transactions',
      'Included in Net Worth',
    ],
  ];
  for (const item of nw.accounts) {
    nwRows.push([
      item.account.name,
      item.account.institution ?? '',
      item.account.mode,
      item.account.customTypeLabel || item.account.type,
      item.account.classification,
      Number(item.account.startingBalance.toFixed(2)),
      Number(item.liveBalance.toFixed(2)),
      item.account.autoTrackTransactions ? 'Yes' : 'No',
      item.account.includeInNetWorth ? 'Yes' : 'No',
    ]);
  }
  const wsNw = XLSX.utils.aoa_to_sheet(nwRows);
  wsNw['!cols'] = [
    { wch: 28 },
    { wch: 22 },
    { wch: 12 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsNw, 'Accounts & Net Worth');

  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await saveBinaryFile(savePath, new Uint8Array(wbOut));
  return savePath;
}

export async function exportMonthlyBudgetCsv(
  state: LedgerState,
  monthKey: string,
  workspace: ActiveWorkspace
): Promise<string | null> {
  const defaultName = `Koban-BudgetSheet-${workspace}-${monthKey}.csv`;
  const savePath = await pickSaveFileDialog(defaultName, 'CSV File (*.csv)', ['csv']);
  if (!savePath) return null;

  const matrix = buildMonthlyBudgetMatrix(state, monthKey, workspace);
  const csvContent = rowsToCsv(matrix);
  await saveTextFile(savePath, csvContent, true);
  return savePath;
}

export async function exportTransactionsCsv(
  state: LedgerState,
  workspace: ActiveWorkspace
): Promise<string | null> {
  const defaultName = `Koban-Transactions-${workspace}-${state.settings.activeYear}.csv`;
  const savePath = await pickSaveFileDialog(defaultName, 'CSV File (*.csv)', ['csv']);
  if (!savePath) return null;

  const catMap = new Map(state.categories.map((c) => [c.id, c]));
  const grpMap = new Map(state.groups.map((g) => [g.id, g]));

  const rows: (string | number)[][] = [
    [
      'Date',
      'Month',
      'Mode',
      'Type',
      'Group',
      'Category',
      'Description',
      'Amount',
      'Currency',
      'Client',
      'InvoiceRef',
      'TaxRatePct',
      'DeductiblePct',
      'DeductibleAmount',
      'PaymentMethod',
      'Status',
    ],
  ];

  const txs = state.transactions
    .filter((t) => (workspace === 'combined' ? true : t.mode === workspace))
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const tx of txs) {
    const cat = catMap.get(tx.categoryId);
    const grp = cat ? grpMap.get(cat.groupId) : undefined;
    const dedPct = tx.deductiblePct ?? 0;
    const dedAmt = tx.type === 'expense' ? tx.amount * (dedPct / 100) : 0;
    rows.push([
      tx.date,
      tx.monthKey,
      tx.mode,
      tx.type,
      grp?.name ?? '',
      cat?.name ?? '',
      tx.description,
      Number(tx.amount.toFixed(2)),
      state.settings.currency,
      tx.client ?? '',
      tx.invoiceRef ?? '',
      tx.taxRate ?? 0,
      dedPct,
      Number(dedAmt.toFixed(2)),
      tx.paymentMethod ?? '',
      tx.status ?? 'cleared',
    ]);
  }

  await saveTextFile(savePath, rowsToCsv(rows), true);
  return savePath;
}

export interface BudgetImportPreviewRow {
  categoryId: string;
  groupName: string;
  categoryName: string;
  kind: CategoryKind;
  isNewCategory: boolean;
  previousBudget: number;
  previousActual: number;
  budget: number;
  actual: number;
}

export interface TransactionImportPreviewRow {
  id: string;
  date: string;
  monthKey: string;
  type: 'income' | 'expense';
  categoryName: string;
  description: string;
  amount: number;
  client?: string;
  taxRate?: number;
}

/**
 * Parses an imported Excel (.xlsx) or CSV (.csv) buffer
 * and merges its category groups, categories, budgets, and actuals into the target mode & month.
 * Supports both the 2-column Monthly Budget layout AND flat Category tables.
 */
export function importBudgetSheetFromBuffer(
  buffer: ArrayBuffer,
  currentState: LedgerState,
  targetMode: LedgerMode,
  monthKey: string
): {
  state: LedgerState;
  importedCategories: number;
  sheetName: string;
  previewRows: BudgetImportPreviewRow[];
} {
  const wb = XLSX.read(buffer, { type: 'array' });

  // Helper to compute non-zero numeric activity in a sheet's 2D array
  const sheetActivityScore = (rows: (string | number | null)[][]): number => {
    let score = 0;
    for (const r of rows) {
      for (const cell of r) {
        const n = typeof cell === 'number' ? cell : parseFloat(String(cell ?? '').replace(/[^0-9.-]/g, ''));
        if (!Number.isNaN(n) && Math.abs(n) > 0 && Math.abs(n) !== 42) {
          score += Math.abs(n);
        }
      }
    }
    return score;
  };

  // Pick the best sheet: match month name if non-empty, or pick the sheet with non-zero budget data
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const targetMonthIdx = Math.max(0, Math.min(11, (parseInt(monthKey.split('-')[1] ?? '1', 10) || 1) - 1));
  const targetMonthShort = monthNames[targetMonthIdx];

  let chosenSheetName = wb.SheetNames[0];
  const monthMatchedSheet = wb.SheetNames.find((n) =>
    n.toLowerCase().startsWith(targetMonthShort)
  );
  if (monthMatchedSheet) {
    const candidateAoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      wb.Sheets[monthMatchedSheet],
      { header: 1, defval: '' }
    );
    if (sheetActivityScore(candidateAoa) > 0) {
      chosenSheetName = monthMatchedSheet;
    }
  }

  let aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    wb.Sheets[chosenSheetName],
    { header: 1, defval: '' }
  );

  // If the chosen sheet is all zeros and the workbook has multiple sheets, pick the first sheet with non-zero data
  if (sheetActivityScore(aoa) === 0 && wb.SheetNames.length > 1) {
    for (const name of wb.SheetNames) {
      const candidate = XLSX.utils.sheet_to_json<(string | number | null)[]>(
        wb.Sheets[name],
        { header: 1, defval: '' }
      );
      if (sheetActivityScore(candidate) > 0) {
        chosenSheetName = name;
        aoa = candidate;
        break;
      }
    }
  }

  // If a CSV or sheet contains multiple stacked "Personal Monthly Budget" blocks (e.g. 12 months in one file),
  // isolate each block and pick the block(s) with non-zero values (or the first block if all are zero).
  const blockStartIndices: number[] = [];
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const c0 = String(row[0] ?? '').trim().toUpperCase();
    const c1 = String(row[1] ?? '').trim().toLowerCase();
    const c2 = String(row[2] ?? '').trim().toLowerCase();
    if (c0 === 'INCOME' && c1 === 'budget' && c2 === 'actual') {
      blockStartIndices.push(r);
    }
  }

  if (blockStartIndices.length > 1) {
    const blocks: (string | number | null)[][][] = [];
    for (let i = 0; i < blockStartIndices.length; i++) {
      const start = blockStartIndices[i];
      const end = i + 1 < blockStartIndices.length ? blockStartIndices[i + 1] : aoa.length;
      blocks.push(aoa.slice(start, end));
    }
    const nonZeroBlocks = blocks.filter((b) => sheetActivityScore(b) > 0);
    if (nonZeroBlocks.length > 0) {
      // Combine only the non-zero block(s) so empty template blocks don't overwrite real values with 0
      aoa = nonZeroBlocks.flat();
    } else {
      aoa = blocks[0];
    }
  }

  const nextGroups: CategoryGroup[] = [...currentState.groups];
  const nextCategories: CategoryItem[] = [...currentState.categories];
  const nextBudgets = [...currentState.monthlyBudgets];
  const previewRowsMap = new Map<string, BudgetImportPreviewRow>();
  let importedCount = 0;

  // Check if it's a flat table with headers like ["Mode", "Group", "Category", "Kind", "Budget", "Actual"] or ["Group", "Category", "Budget", "Actual"]
  const headerRow = (aoa[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  const grpColIdx = headerRow.findIndex((h) => h === 'group' || h === 'category group');
  const catColIdx = headerRow.findIndex((h) => h === 'category' || h === 'item' || h === 'subcategory');
  const budColIdx = headerRow.findIndex((h) => h.includes('budget') || h === 'planned');
  const actColIdx = headerRow.findIndex((h) => h.includes('actual') || h === 'spent');

  if (catColIdx >= 0 && (budColIdx >= 0 || actColIdx >= 0)) {
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const catName = String(row[catColIdx] ?? '').trim();
      if (!catName) continue;
      const grpName =
        grpColIdx >= 0
          ? String(row[grpColIdx] ?? '').trim() || 'GENERAL'
          : 'GENERAL';
      const budgetVal =
        budColIdx >= 0
          ? parseFloat(String(row[budColIdx] ?? '').replace(/[^0-9.-]/g, '')) || 0
          : 0;
      const actualVal =
        actColIdx >= 0
          ? parseFloat(String(row[actColIdx] ?? '').replace(/[^0-9.-]/g, '')) || 0
          : 0;

      let grp = nextGroups.find(
        (g) => g.mode === targetMode && g.name.toLowerCase() === grpName.toLowerCase()
      );
      if (!grp) {
        const kind =
          grpName.toUpperCase().includes('INCOME') ||
          grpName.toUpperCase().includes('REVENUE')
            ? 'income'
            : grpName.toUpperCase().includes('SAVING')
              ? 'savings'
              : 'expense';
        grp = {
          id: `grp-imp-${Date.now()}-${r}`,
          mode: targetMode,
          name: grpName.toUpperCase(),
          kind,
          color: kind === 'income' ? '#3f704d' : '#3f6e8c',
          column: 0,
          order: nextGroups.filter((g) => g.mode === targetMode).length,
        };
        nextGroups.push(grp);
      }

      let cat = nextCategories.find(
        (c) =>
          c.groupId === grp!.id &&
          c.name.toLowerCase() === catName.toLowerCase()
      );
      const isNewCat = !cat;
      if (!cat) {
        cat = {
          id: `cat-imp-${Date.now()}-${r}`,
          groupId: grp.id,
          mode: targetMode,
          name: catName,
          kind: grp.kind,
          defaultBudget: budgetVal,
          taxRate: 0,
          deductiblePct: targetMode === 'freelancer' ? 100 : 0,
          order: nextCategories.filter((c) => c.groupId === grp!.id).length,
        };
        nextCategories.push(cat);
      } else if (budgetVal > 0) {
        cat.defaultBudget = budgetVal;
      }

      const mbIdx = nextBudgets.findIndex(
        (mb) => mb.monthKey === monthKey && mb.categoryId === cat!.id
      );
      const prevBud = mbIdx >= 0 ? nextBudgets[mbIdx].budget : 0;
      const prevAct = mbIdx >= 0 ? nextBudgets[mbIdx].directActual ?? 0 : 0;
      let finalBudget = budgetVal;
      let finalActual = actualVal;

      if (mbIdx >= 0) {
        const existing = nextBudgets[mbIdx];
        finalBudget =
          budgetVal !== 0 || existing.budget === 0 ? budgetVal : existing.budget;
        finalActual =
          actualVal !== 0 || (existing.directActual ?? 0) === 0
            ? actualVal
            : existing.directActual ?? 0;
        nextBudgets[mbIdx] = {
          ...existing,
          budget: finalBudget,
          directActual: finalActual,
        };
      } else {
        nextBudgets.push({
          monthKey,
          categoryId: cat.id,
          budget: budgetVal,
          directActual: actualVal,
        });
      }

      previewRowsMap.set(cat.id, {
        categoryId: cat.id,
        groupName: grp.name,
        categoryName: cat.name,
        kind: grp.kind,
        isNewCategory: isNewCat,
        previousBudget: prevBud,
        previousActual: prevAct,
        budget: finalBudget,
        actual: finalActual,
      });

      importedCount++;
    }

    return {
      state: {
        ...currentState,
        groups: nextGroups,
        categories: nextCategories,
        monthlyBudgets: nextBudgets,
      },
      importedCategories: importedCount,
      sheetName: chosenSheetName,
      previewRows: Array.from(previewRowsMap.values()),
    };
  }

  // Otherwise parse 2-column Monthly Budget Worksheet layout
  const updatedCatIds = new Set<string>();

  const parseColumnSide = (colOffset: number, columnIdx: 0 | 1) => {
    let activeGroup: CategoryGroup | null = null;

    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const col0 = String(row[colOffset] ?? '').trim();
      const col1 = String(row[colOffset + 1] ?? '').trim();
      const col2 = String(row[colOffset + 2] ?? '').trim();

      if (!col0) continue;

      if (col1.toLowerCase() === 'budget' && col2.toLowerCase() === 'actual') {
        if (col0.toUpperCase() === 'BUDGET SUMMARY') {
          activeGroup = null;
          continue;
        }
        const existingGrp = nextGroups.find(
          (g) => g.mode === targetMode && g.name.toLowerCase() === col0.toLowerCase()
        );
        if (existingGrp) {
          activeGroup = existingGrp;
        } else {
          const kind =
            col0.toUpperCase().includes('INCOME') || col0.toUpperCase().includes('REVENUE')
              ? 'income'
              : col0.toUpperCase().includes('SAVING')
                ? 'savings'
                : 'expense';
          const newGrp: CategoryGroup = {
            id: `grp-imp-${Date.now()}-${r}-${colOffset}`,
            mode: targetMode,
            name: col0,
            kind,
            color: kind === 'income' ? '#3f704d' : '#3f6e8c',
            column: columnIdx,
            order: nextGroups.filter((g) => g.mode === targetMode).length,
          };
          nextGroups.push(newGrp);
          activeGroup = newGrp;
        }
        continue;
      }

      if (
        col0.toLowerCase().startsWith('total ') ||
        col0.toUpperCase() === 'NET' ||
        col0.toLowerCase().startsWith('personal monthly budget') ||
        col0.toLowerCase().startsWith('http') ||
        col0 === '[42]'
      ) {
        activeGroup = null;
        continue;
      }

      if (activeGroup) {
        const budgetNum = parseFloat(col1.replace(/[^0-9.-]/g, '')) || 0;
        const actualNum = parseFloat(col2.replace(/[^0-9.-]/g, '')) || 0;

        let cat = nextCategories.find(
          (c) =>
            c.groupId === activeGroup!.id &&
            c.name.toLowerCase() === col0.toLowerCase()
        );
        const isNewCat = !cat;
        if (!cat) {
          cat = {
            id: `cat-imp-${Date.now()}-${r}-${colOffset}`,
            groupId: activeGroup.id,
            mode: targetMode,
            name: col0,
            kind: activeGroup.kind,
            defaultBudget: budgetNum,
            taxRate: 0,
            deductiblePct: targetMode === 'freelancer' ? 100 : 0,
            order: nextCategories.filter((c) => c.groupId === activeGroup!.id).length,
          };
          nextCategories.push(cat);
        } else if (budgetNum > 0) {
          cat.defaultBudget = budgetNum;
        }

        const mbIdx = nextBudgets.findIndex(
          (mb) => mb.monthKey === monthKey && mb.categoryId === cat!.id
        );
        const origMb = currentState.monthlyBudgets.find(
          (mb) => mb.monthKey === monthKey && mb.categoryId === cat!.id
        );
        let finalBudget = budgetNum;
        let finalActual = actualNum;

        if (mbIdx >= 0) {
          const prev = nextBudgets[mbIdx];
          // If this category was already updated with a non-zero value in this import pass (e.g. duplicate "Other" rows),
          // don't overwrite the non-zero value with 0.
          const alreadyUpdatedInPass = updatedCatIds.has(cat.id);
          finalBudget =
            alreadyUpdatedInPass && budgetNum === 0 && prev.budget !== 0
              ? prev.budget
              : budgetNum;
          finalActual =
            alreadyUpdatedInPass &&
            actualNum === 0 &&
            (prev.directActual ?? 0) !== 0
              ? prev.directActual ?? 0
              : actualNum;
          nextBudgets[mbIdx] = {
            ...prev,
            budget: finalBudget,
            directActual: finalActual,
          };
        } else {
          nextBudgets.push({
            monthKey,
            categoryId: cat.id,
            budget: budgetNum,
            directActual: actualNum,
          });
        }

        previewRowsMap.set(cat.id, {
          categoryId: cat.id,
          groupName: activeGroup.name,
          categoryName: cat.name,
          kind: activeGroup.kind,
          isNewCategory: isNewCat,
          previousBudget: origMb?.budget ?? 0,
          previousActual: origMb?.directActual ?? 0,
          budget: finalBudget,
          actual: finalActual,
        });

        updatedCatIds.add(cat.id);
        importedCount++;
      }
    }
  };

  parseColumnSide(0, 0);
  parseColumnSide(5, 1);

  return {
    state: {
      ...currentState,
      groups: nextGroups,
      categories: nextCategories,
      monthlyBudgets: nextBudgets,
    },
    importedCategories: updatedCatIds.size || importedCount,
    sheetName: chosenSheetName,
    previewRows: Array.from(previewRowsMap.values()),
  };
}

/**
 * Parses an imported Transactions CSV or Excel file (`.csv`, `.xlsx`, `.xls`)
 * with smart column detection (`Date`, `Description`/`Payee`, `Amount`, `Category`, `Client`, `InvoiceRef`, `VAT`, `Deductible`).
 */
export function importTransactionsFromBuffer(
  buffer: ArrayBuffer,
  currentState: LedgerState,
  targetMode: LedgerMode,
  fallbackMonthKey: string
): {
  state: LedgerState;
  importedTransactions: number;
  sheetName: string;
  previewRows: TransactionImportPreviewRow[];
} {
  const wb = XLSX.read(buffer, { type: 'array' });
  // Prefer a sheet named "Transactions" if importing a multi-sheet Koban workbook, otherwise first sheet
  const txSheetName =
    wb.SheetNames.find((n) => n.toLowerCase().includes('transaction')) ??
    wb.SheetNames[0];
  const sheet = wb.Sheets[txSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });

  if (rows.length === 0) {
    return {
      state: currentState,
      importedTransactions: 0,
      sheetName: txSheetName,
      previewRows: [],
    };
  }

  const nextCategories = [...currentState.categories];
  const nextTransactions = [...currentState.transactions];
  const previewRows: TransactionImportPreviewRow[] = [];
  const modeCats = nextCategories.filter((c) => c.mode === targetMode);
  const defaultExpenseCat =
    modeCats.find((c) => c.kind === 'expense') ?? modeCats[0];
  const defaultIncomeCat =
    modeCats.find((c) => c.kind === 'income') ?? modeCats[0];

  let count = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const keys = Object.keys(r);
    const findVal = (candidates: string[]): string => {
      for (const cand of candidates) {
        const k = keys.find((key) => key.toLowerCase().trim() === cand);
        if (k && r[k] !== undefined && r[k] !== '') return String(r[k]).trim();
      }
      for (const cand of candidates) {
        const k = keys.find((key) => key.toLowerCase().includes(cand));
        if (k && r[k] !== undefined && r[k] !== '') return String(r[k]).trim();
      }
      return '';
    };

    const rawAmtStr = findVal(['amount', 'total', 'value', 'sum', 'betrag', 'chf', 'eur']);
    const rawNum = parseFloat(rawAmtStr.replace(/[^0-9.-]/g, ''));
    if (Number.isNaN(rawNum) || Math.abs(rawNum) < 0.001) continue;

    const rawDate = findVal(['date', 'datum', 'booking date', 'valuta']);
    let isoDate = `${fallbackMonthKey}-08`;
    if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      isoDate = rawDate.slice(0, 10);
    } else if (/^\d{1,2}[./]\d{1,2}[./]\d{4}/.test(rawDate)) {
      const parts = rawDate.split(/[./]/);
      isoDate = `${parts[2].slice(0, 4)}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    const txMonthKey = isoDate.slice(0, 7);

    const rawDesc =
      findVal(['description', 'payee', 'text', 'memo', 'purpose', 'merchant', 'details']) ||
      'Imported Entry';
    const rawCatName = findVal(['category', 'kategorie', 'subcategory']);
    const rawType = findVal(['type', 'kind', 'direction']).toLowerCase();
    const rawClient = findVal(['client', 'customer', 'project']);
    const rawInvoice = findVal(['invoiceref', 'invoice', 'reference', 'ref']);
    const rawVat = parseFloat(findVal(['taxratepct', 'vat', 'tax', 'mwst'])) || 0;
    const rawDed =
      parseFloat(findVal(['deductiblepct', 'deductible'])) ||
      (targetMode === 'freelancer' ? 100 : 0);

    // Match category by name if provided
    let matchedCat = rawCatName
      ? nextCategories.find(
          (c) =>
            c.mode === targetMode &&
            c.name.toLowerCase() === rawCatName.toLowerCase()
        )
      : undefined;

    const isIncome =
      rawType === 'income' ||
      matchedCat?.kind === 'income' ||
      (rawType === '' && rawNum < 0 === false && rawDesc.toLowerCase().includes('invoice'));

    if (!matchedCat) {
      matchedCat = isIncome ? defaultIncomeCat : defaultExpenseCat;
    }
    if (!matchedCat) continue;

    const txType: 'income' | 'expense' =
      matchedCat.kind === 'income' || rawType === 'income' ? 'income' : 'expense';

    const newTx: TransactionItem = {
      id: `tx-imp-${Date.now()}-${i}`,
      date: isoDate,
      monthKey: txMonthKey,
      mode: targetMode,
      type: txType,
      categoryId: matchedCat.id,
      description: rawDesc,
      amount: Math.abs(rawNum),
      client: rawClient || undefined,
      invoiceRef: rawInvoice || undefined,
      taxRate: rawVat,
      deductiblePct: rawDed,
      paymentMethod: findVal(['paymentmethod', 'account', 'method']) || 'Imported',
      status: 'cleared',
    };

    nextTransactions.push(newTx);
    previewRows.push({
      id: newTx.id,
      date: newTx.date,
      monthKey: newTx.monthKey,
      type: newTx.type,
      categoryName: matchedCat.name,
      description: newTx.description,
      amount: newTx.amount,
      client: newTx.client,
      taxRate: newTx.taxRate,
    });
    count++;
  }

  return {
    state: {
      ...currentState,
      categories: nextCategories,
      transactions: nextTransactions,
    },
    importedTransactions: count,
    sheetName: txSheetName,
    previewRows,
  };
}
