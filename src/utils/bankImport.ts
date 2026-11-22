import * as XLSX from 'xlsx';
import {
  BankDateFormat,
  BankDecimalSeparator,
  BankImportProfile,
  CategoryItem,
  FinancialAccount,
  ImportRule,
  LedgerMode,
  LedgerState,
  TransactionItem,
} from '../types';

export type BankFileFormat = 'camt053' | 'ofx' | 'csv' | 'spreadsheet';

export interface RawBankTransaction {
  rowIndex: number;
  date: string; // YYYY-MM-DD
  signedAmount: number; // >0 income/credit, <0 expense/debit
  currency?: string;
  externalId?: string;
  rawPayee: string;
  rawDescription: string;
  reference?: string;
  counterpartyIban?: string;
  categoryHint?: string;
  bankTxCode?: string;
}

export type CategorizationConfidence =
  | 'rule'
  | 'history'
  | 'keyword'
  | 'needs_review';

export type DuplicateStatus =
  | 'none'
  | 'exact_duplicate'
  | 'possible_duplicate';

export interface StagedBankTransaction {
  id: string;
  raw: RawBankTransaction;
  included: boolean;
  date: string;
  monthKey: string;
  mode: LedgerMode;
  type: 'income' | 'expense';
  accountId?: string;
  categoryId: string | null;
  description: string;
  rawDescription: string;
  amount: number; // always positive
  client?: string;
  invoiceRef?: string;
  taxRate: number;
  deductiblePct: number;
  paymentMethod: string;
  externalId?: string;
  importFingerprint: string;
  confidence: CategorizationConfidence;
  matchReason: string;
  matchedRuleId?: string;
  duplicateStatus: DuplicateStatus;
  duplicateOfLabel?: string;
  isTransferCandidate: boolean;
  transferHint?: string;
  transferPeerId?: string;
}

export interface BankStatementParseResult {
  format: BankFileFormat;
  fileName: string;
  sheetName?: string;
  detectedAccountIban?: string;
  detectedCurrency?: string;
  rawText?: string;
  rawRows?: string[][];
  headerRowIndex?: number;
  headers?: string[];
  delimiter?: string;
  selectedProfileId?: string;
  matchedProfile?: BankImportProfile;
  matchedProfileSource?: 'saved' | 'builtin' | 'auto';
  needsMappingReview: boolean;
  activeMapping?: BankImportProfile;
  rawTransactions: RawBankTransaction[];
  warnings: string[];
}

// ================= TEXT DECODING & DETERMINISTIC HASH =================

export function decodeTextBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const FNV_PRIME_64 = BigInt('0x00000100000001b3');
const FNV_OFFSET_1 = BigInt('0xcbf29ce484222325');
const FNV_OFFSET_2 = BigInt('0x84222325cbf29ce4');
const MASK_64 = BigInt('0xffffffffffffffff');

function fnv1a64Hex(bytes: Uint8Array, offsetBasis: bigint): string {
  let h = offsetBasis;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * FNV_PRIME_64) & MASK_64;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Synchronous 128-bit FNV-1a fingerprint identical across Windows (TypeScript) and macOS (Swift).
 * Includes `occurrenceIndex` so two genuine same-amount transactions at the same merchant on the same day stay distinct.
 */
export function computeImportFingerprint(
  accountId: string | undefined,
  date: string,
  signedAmount: number,
  normalizedKey: string,
  occurrenceIndex: number
): string {
  const signedCents = Math.round(signedAmount * 100);
  const canonical = `${accountId ?? ''}|${date}|${signedCents}|${normalizedKey}|${occurrenceIndex}`;
  const bytes = new TextEncoder().encode(canonical);
  const bytes2 = new Uint8Array(bytes.length + 1);
  bytes2[0] = 0x3a;
  bytes2.set(bytes, 1);
  return `${fnv1a64Hex(bytes, FNV_OFFSET_1)}${fnv1a64Hex(bytes2, FNV_OFFSET_2)}`;
}

// ================= MERCHANT NORMALIZATION =================

const NOISE_PHRASES = [
  'pos purchase',
  'card purchase',
  'debit card',
  'credit card',
  'visapurchase',
  'mastercard',
  'debitkarte',
  'ec-direct',
  'maestro',
  'twint zahlung',
  'twint p2p',
  'twint',
  'sepa-lastschrift',
  'sepa lastschrift',
  'sepa-uberweisung',
  'sepa ueberweisung',
  'sepa credit transfer',
  'lastschrift',
  'gutschrift',
  'e-banking',
  'ebanking',
  'mobile banking',
  'kartenzahlung',
  'einkauf',
  'zahlung',
  'paiement',
  'achat',
  'beleg-nr',
  'karten-nr',
  'card no',
  'ref-nr',
];

export function normalizeMerchantText(raw: string): string {
  let s = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Strip masked card tokens & dates/times
  s = s.replace(/\b(?:xxxx|x{4}|\*{2,4})[- ]?\d{2,4}\b/g, ' ');
  s = s.replace(/\*\d{4}\b/g, ' ');
  s = s.replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g, ' ');
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  s = s.replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, ' ');
  s = s.replace(/\b(?:ch|de|fr|it|at|gb|us)\d{2}[a-z0-9]{10,30}\b/g, ' ');

  for (const phrase of NOISE_PHRASES) {
    s = s.split(phrase).join(' ');
  }

  // Strip standalone 4+ digit store/receipt IDs and currency labels
  s = s.replace(/\b(?:chf|eur|usd|gbp|jpy)\b/g, ' ');
  s = s.replace(/\b\d{4,}\b/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  return s.trim().replace(/\s+/g, ' ');
}

export function suggestRulePattern(rawPayee: string, rawDescription: string): string {
  const normPayee = normalizeMerchantText(rawPayee);
  const normDesc = normalizeMerchantText(rawDescription);
  const source = normPayee || normDesc;
  if (!source) {
    return (rawPayee || rawDescription).trim().slice(0, 32);
  }
  const tokens = source.split(' ').filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  if (tokens.length === 0) return source.slice(0, 24);
  return tokens.slice(0, 2).join(' ');
}

// ================= DATE & NUMBER PARSERS =================

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() + 1 !== m ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function expandTwoDigitYear(yy: number): number {
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

export function inferDateFormatFromSamples(samples: string[]): BankDateFormat {
  let sawDot = false;
  let sawSlash = false;
  let sawIso = false;
  let dmyEvidence = 0;
  let mdyEvidence = 0;

  for (const raw of samples) {
    const s = raw.trim();
    if (!s) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      sawIso = true;
      continue;
    }
    const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (dot) {
      sawDot = true;
      const a = Number(dot[1]);
      const b = Number(dot[2]);
      if (a > 12) dmyEvidence++;
      if (b > 12) mdyEvidence++;
      continue;
    }
    const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (slash) {
      sawSlash = true;
      const a = Number(slash[1]);
      const b = Number(slash[2]);
      if (a > 12) dmyEvidence++;
      if (b > 12) mdyEvidence++;
    }
  }

  if (sawIso) return 'YYYY-MM-DD';
  if (sawDot) return 'DD.MM.YYYY';
  if (sawSlash) {
    return mdyEvidence > dmyEvidence ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
  }
  return 'auto';
}

export function parseBankDate(
  raw: string | number | null | undefined,
  format: BankDateFormat = 'auto',
  fallbackDmy = true
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial date
    if (raw > 20000 && raw < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
      return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
    }
    raw = String(Math.trunc(raw));
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Excel serial date encoded as string in XLSX sheets (20000..80000 -> ~1954..2119)
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial <= 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
    }
  }

  // ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return validYmd(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  // Compact YYYYMMDD (common in OFX DTPOSTED / ISO XML)
  const compactMatch = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{4,6})?(?:\[.*\])?$/);
  if (compactMatch && (format === 'auto' || format === 'YYYYMMDD')) {
    return validYmd(
      Number(compactMatch[1]),
      Number(compactMatch[2]),
      Number(compactMatch[3])
    );
  }

  // Separated numeric date (DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY)
  const sepMatch = s.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})(?:\s.*)?$/);
  if (sepMatch) {
    const a = Number(sepMatch[1]);
    const sep = sepMatch[2];
    const b = Number(sepMatch[3]);
    let year = Number(sepMatch[4]);
    if (year < 100) year = expandTwoDigitYear(year);

    if (format === 'MM/DD/YYYY') {
      return validYmd(year, a, b) ?? validYmd(year, b, a);
    }
    if (format === 'DD.MM.YYYY' || format === 'DD/MM/YYYY') {
      return validYmd(year, b, a) ?? validYmd(year, a, b);
    }
    if (sep === '.') {
      return validYmd(year, b, a);
    }
    if (a > 12) return validYmd(year, b, a);
    if (b > 12) return validYmd(year, a, b);
    return fallbackDmy ? validYmd(year, b, a) : validYmd(year, a, b);
  }

  return null;
}

export function parseBankNumber(
  raw: string | number | null | undefined,
  decimalSep: BankDecimalSeparator = 'auto'
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }

  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith('-') && !s.startsWith('-')) {
    negative = true;
    s = s.slice(0, -1).trim();
  }

  // Remove currency symbols/codes & grouping apostrophes/spaces/NBSPs
  s = s.replace(/(?:CHF|EUR|USD|GBP|JPY|Fr\.?|€|\$|£)/gi, '');
  s = s.replace(/[\s\u00a0\u202f'’`]/g, '');

  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  let normalized = s;
  if (decimalSep === ',') {
    normalized = s.replace(/\./g, '').replace(',', '.');
    // If there were extra commas (malformed), keep only last dot
    const lastDot = normalized.lastIndexOf('.');
    if (lastDot >= 0) {
      normalized =
        normalized.slice(0, lastDot).replace(/\./g, '') + normalized.slice(lastDot);
    }
  } else if (decimalSep === '.') {
    normalized = s.replace(/,/g, '');
  } else {
    if (hasDot && hasComma) {
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      if (lastComma > lastDot) {
        normalized = s.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = s.replace(/,/g, '');
      }
    } else if (hasComma) {
      const commaCount = (s.match(/,/g) ?? []).length;
      if (commaCount === 1) {
        const afterComma = s.slice(s.indexOf(',') + 1);
        if (afterComma.length !== 3) {
          normalized = s.replace(',', '.');
        } else {
          // 1,234 -> US thousands vs unambiguous integer; 12,345 -> decimal only if dot not used
          normalized = s.replace(',', '');
        }
      } else {
        normalized = s.replace(/,/g, '');
      }
    } else if (hasDot) {
      const dotCount = (s.match(/\./g) ?? []).length;
      if (dotCount > 1) {
        const lastDot = s.lastIndexOf('.');
        const afterLast = s.slice(lastDot + 1);
        if (afterLast.length <= 2) {
          normalized = s.slice(0, lastDot).replace(/\./g, '') + '.' + afterLast;
        } else {
          normalized = s.replace(/\./g, '');
        }
      }
    }
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

// ================= ISO 20022 CAMT.053 / CAMT.052 / CAMT.054 XML PARSER =================

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&');
}

function stripXmlCommentsAndCdata(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) =>
      inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    );
}

function extractTagBlocks(xml: string, localName: string): string[] {
  const results: string[] = [];
  const tagRe = new RegExp(
    `<(/?)(?:[A-Za-z0-9_-]+:)?${localName}(?=[\\s>/])([^>]*)>`,
    'g'
  );
  let depth = 0;
  let blockStart = -1;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(xml)) !== null) {
    const isClosing = match[1] === '/';
    const attrs = match[2] ?? '';
    const isSelfClosing = !isClosing && attrs.trimEnd().endsWith('/');

    if (!isClosing) {
      if (isSelfClosing) continue;
      if (depth === 0) {
        blockStart = match.index + match[0].length;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && blockStart >= 0) {
        results.push(xml.slice(blockStart, match.index));
        blockStart = -1;
      }
    }
  }
  return results;
}

function extractTagText(xml: string, localName: string): string {
  const blocks = extractTagBlocks(xml, localName);
  if (blocks.length === 0) return '';
  return unescapeXml(blocks[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractTagAttr(xml: string, localName: string, attrName: string): string {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${localName}\\b[^>]*\\b${attrName}\\s*=\\s*["']([^"']+)["']`,
    'i'
  );
  const m = xml.match(re);
  return m ? unescapeXml(m[1].trim()) : '';
}

export function isCamtXml(text: string): boolean {
  const head = text.slice(0, 2000).toLowerCase();
  return (
    head.includes('camt.053') ||
    head.includes('camt.052') ||
    head.includes('camt.054') ||
    head.includes('bktocstmrstmt') ||
    (head.includes('<ntry>') && head.includes('<amt'))
  );
}

export function parseCamtXml(
  xmlRaw: string,
  fileName: string
): BankStatementParseResult {
  const cleanXml = stripXmlCommentsAndCdata(xmlRaw);
  const warnings: string[] = [];

  const acctBlocks = extractTagBlocks(cleanXml, 'Acct');
  const detectedAccountIban = acctBlocks.length
    ? extractTagText(acctBlocks[0], 'IBAN') || extractTagText(acctBlocks[0], 'Othr')
    : undefined;
  const detectedCurrency = acctBlocks.length
    ? extractTagText(acctBlocks[0], 'Ccy') || undefined
    : undefined;

  const entries = extractTagBlocks(cleanXml, 'Ntry');
  const rawTransactions: RawBankTransaction[] = [];
  let rowIndex = 0;

  for (const entry of entries) {
    const entryAmtStr = extractTagText(entry, 'Amt');
    const entryCcy = extractTagAttr(entry, 'Amt', 'Ccy') || detectedCurrency;
    const entryCdtDbt = extractTagText(entry, 'CdtDbtInd').toUpperCase();

    const bookgBlock = extractTagBlocks(entry, 'BookgDt')[0] ?? '';
    const valBlock = extractTagBlocks(entry, 'ValDt')[0] ?? '';
    const rawDateStr =
      extractTagText(bookgBlock, 'Dt') ||
      extractTagText(bookgBlock, 'DtTm') ||
      extractTagText(valBlock, 'Dt') ||
      extractTagText(valBlock, 'DtTm');
    const bookingDate = parseBankDate(rawDateStr.slice(0, 10), 'YYYY-MM-DD') ?? '';

    const entryRef =
      extractTagText(entry, 'AcctSvcrRef') || extractTagText(entry, 'NtryRef');
    const addtlEntry = extractTagText(entry, 'AddtlNtryInf');

    const bkTxBlock = extractTagBlocks(entry, 'BkTxCd')[0] ?? '';
    const domnBlock = extractTagBlocks(bkTxBlock, 'Domn')[0] ?? '';
    const fmlyBlock = extractTagBlocks(domnBlock, 'Fmly')[0] ?? '';
    const bankTxCode = [
      extractTagText(domnBlock, 'Cd'),
      extractTagText(fmlyBlock, 'Cd'),
      extractTagText(fmlyBlock, 'SubFmlyCd'),
    ]
      .filter(Boolean)
      .join('-');

    const txDetailsList = extractTagBlocks(entry, 'TxDtls');
    const batches = txDetailsList.length > 0 ? txDetailsList : [entry];

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const tx = batches[bIdx];
      const isBatchChild = txDetailsList.length > 0;

      const amtDtls = extractTagBlocks(tx, 'AmtDtls')[0] ?? '';
      const txAmtBlock = extractTagBlocks(amtDtls, 'TxAmt')[0] ?? amtDtls;
      let txAmtStr = extractTagText(txAmtBlock, 'Amt') || extractTagText(tx, 'Amt');
      let txCcy =
        extractTagAttr(txAmtBlock, 'Amt', 'Ccy') || extractTagAttr(tx, 'Amt', 'Ccy');

      if (!txAmtStr && (!isBatchChild || txDetailsList.length === 1)) {
        txAmtStr = entryAmtStr;
        txCcy = txCcy || entryCcy || '';
      }

      const numAmt = parseBankNumber(txAmtStr, '.');
      if (numAmt === null || Math.abs(numAmt) < 0.0001 || !bookingDate) {
        if (!bookingDate && numAmt !== null) {
          warnings.push(`Skipped entry row ${rowIndex + 1} without a valid booking date.`);
        }
        rowIndex++;
        continue;
      }

      const txCdtDbt =
        extractTagText(tx, 'CdtDbtInd').toUpperCase() || entryCdtDbt || 'DBIT';
      const signedAmount =
        txCdtDbt === 'DBIT' ? -Math.abs(numAmt) : Math.abs(numAmt);

      const refsBlock = extractTagBlocks(tx, 'Refs')[0] ?? tx;
      let extId =
        extractTagText(refsBlock, 'AcctSvcrRef') ||
        extractTagText(refsBlock, 'TxId') ||
        extractTagText(refsBlock, 'EndToEndId') ||
        extractTagText(refsBlock, 'InstrId');
      if (extId === 'NOTPROVIDED') extId = '';
      if (!extId && entryRef) {
        extId = txDetailsList.length > 1 ? `${entryRef}#${bIdx + 1}` : entryRef;
      }

      const rltdBlock = extractTagBlocks(tx, 'RltdPties')[0] ?? '';
      const dbtrBlock = extractTagBlocks(rltdBlock, 'Dbtr')[0] ?? '';
      const cdtrBlock = extractTagBlocks(rltdBlock, 'Cdtr')[0] ?? '';
      const dbtrAcct = extractTagBlocks(rltdBlock, 'DbtrAcct')[0] ?? '';
      const cdtrAcct = extractTagBlocks(rltdBlock, 'CdtrAcct')[0] ?? '';

      const dbtrName = extractTagText(dbtrBlock, 'Nm');
      const cdtrName = extractTagText(cdtrBlock, 'Nm');
      const dbtrIban = extractTagText(dbtrAcct, 'IBAN');
      const cdtrIban = extractTagText(cdtrAcct, 'IBAN');

      const rawPayee =
        txCdtDbt === 'CRDT' ? dbtrName || cdtrName : cdtrName || dbtrName;
      const counterpartyIban =
        txCdtDbt === 'CRDT' ? dbtrIban || cdtrIban : cdtrIban || dbtrIban;

      const rmtBlock = extractTagBlocks(tx, 'RmtInf')[0] ?? '';
      const ustrdList = extractTagBlocks(rmtBlock, 'Ustrd')
        .map((u) => unescapeXml(u.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
        .filter(Boolean);
      const structuredRef = extractTagText(rmtBlock, 'Ref');
      const addtlTx = extractTagText(tx, 'AddtlTxInf');

      const descParts = [rawPayee, ...ustrdList, addtlTx, addtlEntry].filter(Boolean);
      const uniqueDescParts = descParts.filter(
        (v, idx, arr) => arr.indexOf(v) === idx
      );
      const rawDescription = uniqueDescParts.join(' · ') || 'Bank Transaction';

      rawTransactions.push({
        rowIndex,
        date: bookingDate,
        signedAmount,
        currency: txCcy || detectedCurrency,
        externalId: extId || undefined,
        rawPayee,
        rawDescription,
        reference: structuredRef || extId || undefined,
        counterpartyIban: counterpartyIban || undefined,
        bankTxCode: bankTxCode || undefined,
      });
      rowIndex++;
    }
  }

  return {
    format: 'camt053',
    fileName,
    detectedAccountIban: detectedAccountIban || undefined,
    detectedCurrency: detectedCurrency || undefined,
    needsMappingReview: false,
    rawTransactions,
    warnings,
  };
}

// ================= OFX / QFX PARSER =================

export function isOfxContent(text: string): boolean {
  const head = text.slice(0, 1500).toUpperCase();
  return head.includes('OFXHEADER:') || head.includes('<OFX>') || head.includes('<STMTTRN>');
}

function readOfxLeaf(block: string, tag: string): string {
  const xmlRe = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i');
  const xm = block.match(xmlRe);
  if (xm) return unescapeXml(xm[1].trim());
  const sgmlRe = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
  const sm = block.match(sgmlRe);
  return sm ? unescapeXml(sm[1].trim()) : '';
}

export function parseOfx(text: string, fileName: string): BankStatementParseResult {
  const warnings: string[] = [];
  const detectedCurrency = readOfxLeaf(text, 'CURDEF') || undefined;
  const detectedAccountIban = readOfxLeaf(text, 'ACCTID') || undefined;

  const blocks = extractTagBlocks(text, 'STMTTRN');
  // Fallback splitter if SGML <STMTTRN> lacks closing tag in broken exports
  const rawBlocks =
    blocks.length > 0
      ? blocks
      : text
          .split(/<STMTTRN>/i)
          .slice(1)
          .map((chunk) => chunk.split(/<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>/i)[0] ?? chunk);

  const rawTransactions: RawBankTransaction[] = [];
  rawBlocks.forEach((blk, idx) => {
    const dt = parseBankDate(readOfxLeaf(blk, 'DTPOSTED'), 'YYYYMMDD') ??
      parseBankDate(readOfxLeaf(blk, 'DTUSER'), 'auto');
    const amt = parseBankNumber(readOfxLeaf(blk, 'TRNAMT'), '.');
    if (!dt || amt === null || Math.abs(amt) < 0.0001) {
      if (!dt && amt !== null) warnings.push(`Skipped OFX transaction ${idx + 1}: invalid date.`);
      return;
    }
    const fitid = readOfxLeaf(blk, 'FITID');
    const name = readOfxLeaf(blk, 'NAME');
    const memo = readOfxLeaf(blk, 'MEMO');
    const trnType = readOfxLeaf(blk, 'TRNTYPE');
    const checkNum = readOfxLeaf(blk, 'CHECKNUM');
    const rawDescription =
      [name, memo].filter((p, i, arr) => p && arr.indexOf(p) === i).join(' · ') ||
      trnType ||
      'OFX Transaction';

    rawTransactions.push({
      rowIndex: idx,
      date: dt,
      signedAmount: amt,
      currency: detectedCurrency,
      externalId: fitid || undefined,
      rawPayee: name,
      rawDescription,
      reference: checkNum || fitid || undefined,
      bankTxCode: trnType || undefined,
    });
  });

  return {
    format: 'ofx',
    fileName,
    detectedAccountIban,
    detectedCurrency,
    needsMappingReview: false,
    rawTransactions,
    warnings,
  };
}

// ================= CSV & SPREADSHEET PARSING =================

function countDelimiterOnLines(lines: string[], delim: string): { modeCols: number; consistency: number } {
  const counts: number[] = [];
  for (const line of lines) {
    let inQuotes = false;
    let c = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        c++;
      }
    }
    counts.push(c);
  }
  const positive = counts.filter((n) => n >= 1);
  if (positive.length === 0) return { modeCols: 0, consistency: 0 };
  const freq = new Map<number, number>();
  for (const n of positive) freq.set(n, (freq.get(n) ?? 0) + 1);
  const modeCols = Math.max(...freq.values());
  return { modeCols, consistency: positive.length };
}

function sniffDelimiter(lines: string[], preferredDelimiter?: string): string {
  const nonEmpty = lines.filter((l) => l.trim().length > 0).slice(0, 45);
  if (nonEmpty.length === 0) return preferredDelimiter || ',';
  const explicit = nonEmpty[0].trim().match(/^sep=(.)$/i);
  if (explicit) return explicit[1];

  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestScore = -1;

  for (const delim of candidates) {
    const counts: number[] = [];
    for (const line of nonEmpty) {
      let inQuotes = false;
      let c = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') i++;
          else inQuotes = !inQuotes;
        } else if (ch === delim && !inQuotes) {
          c++;
        }
      }
      counts.push(c);
    }
    const positive = counts.filter((n) => n >= 1);
    if (positive.length === 0) continue;
    const freq = new Map<number, number>();
    for (const n of positive) freq.set(n, (freq.get(n) ?? 0) + 1);
    const modeCount = Math.max(...freq.values());
    const avgCols = positive.reduce((a, b) => a + b, 0) / positive.length;
    const prefBoost = preferredDelimiter === delim ? 2 : 0;
    const score = modeCount * 10 + Math.min(avgCols, 20) + prefBoost;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }

  if (preferredDelimiter && candidates.includes(preferredDelimiter)) {
    const stats = countDelimiterOnLines(nonEmpty, preferredDelimiter);
    if (stats.consistency >= Math.max(2, Math.floor(nonEmpty.length * 0.4)) && best === preferredDelimiter) {
      return preferredDelimiter;
    }
  }
  return bestScore > 0 ? best : preferredDelimiter || ',';
}

export function parseCsvToMatrix(
  rawText: string,
  preferredDelimiter?: string
): {
  rows: string[][];
  delimiter: string;
} {
  const linesRaw = rawText.split(/\r\n|\n|\r/);
  let text = rawText;
  let delimiter = sniffDelimiter(linesRaw, preferredDelimiter);
  if (/^sep=.$/i.test((linesRaw[0] ?? '').trim())) {
    delimiter = linesRaw[0].trim().slice(4);
    text = linesRaw.slice(1).join('\n');
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return { rows, delimiter };
}

export function normalizeHeaderKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const DATE_HEADER_HINTS = [
  'date',
  'datum',
  'buchungsdatum',
  'buchungstag',
  'buchung',
  'valuta',
  'valutadatum',
  'valutatag',
  'booking date',
  'value date',
  'trade date',
  'transaction date',
  'started date',
  'completed date',
  'posting date',
  'booked at',
  'created on',
  'abschlussdatum',
  'date de comptabilisation',
  'date de transaction',
  'data di conclusione',
  'data',
];

const AMOUNT_HEADER_HINTS = [
  'amount',
  'betrag',
  'montant',
  'importo',
  'total',
  'wert',
  'credit/debit amount',
  'individual amount',
  'debit',
  'belastung',
  'lastschrift',
  'ausgabe',
  'addebito',
  'credit',
  'gutschrift',
  'eingang',
  'accredito',
  'balance',
  'saldo',
  'einzelbetrag',
];

const TEXT_HEADER_HINTS = [
  'description',
  'description1',
  'description 1',
  'beschreibung',
  'beschreibung1',
  'beschreibung 1',
  'descrizione',
  'descrizione1',
  'buchungstext',
  'verwendungszweck',
  'avisierungstext',
  'bewegungstext',
  'notification text',
  'activity type',
  'activity name',
  'umsatztyp',
  'mitteilung',
  'details',
  'text',
  'memo',
  'subject',
  'payee',
  'merchant',
  'empfänger',
  'empfaenger',
  'auftraggeber',
  'begünstigter',
  'beguenstigter',
  'zahlungspflichtig',
  'zahlungszweck',
  'counterparty',
  'partner name',
  'payment reference',
  'name',
  'kategorie',
  'category',
  'währung',
  'currency',
  'waehrung',
  'monnaie',
  'moneta',
  'iban',
  'reference',
  'referenz',
  'transaction no',
  'transaktions-nr',
  'referenznummer',
];

export function detectHeaderRow(matrix: string[][]): number {
  const limit = Math.min(40, matrix.length);
  let bestIdx = 0;
  let bestScore = -1;

  for (let r = 0; r < limit; r++) {
    const row = matrix[r];
    if (!row || row.filter((c) => c.trim() !== '').length < 2) continue;

    let score = 0;
    let dateHits = 0;
    let amountHits = 0;
    let textHits = 0;

    for (const rawCell of row) {
      const cell = rawCell.trim().toLowerCase();
      const normCell = normalizeHeaderKey(rawCell);
      if (!cell || cell.length > 60) continue;
      // Numeric/date-only cells are data, not headers
      if (/^[+-]?\d[\d.,'’\s]*$/.test(cell)) continue;
      if (parseBankDate(cell, 'auto') !== null) continue;

      if (
        DATE_HEADER_HINTS.some(
          (h) => cell === h || cell.includes(h) || normCell === normalizeHeaderKey(h)
        )
      ) {
        dateHits++;
        score += 5;
      } else if (
        AMOUNT_HEADER_HINTS.some(
          (h) => cell === h || cell.includes(h) || normCell === normalizeHeaderKey(h)
        )
      ) {
        amountHits++;
        score += 4;
      } else if (
        TEXT_HEADER_HINTS.some(
          (h) => cell === h || cell.includes(h) || normCell === normalizeHeaderKey(h)
        )
      ) {
        textHits++;
        score += 3;
      }
    }

    if (dateHits > 0 && amountHits > 0) score += 8;
    if (dateHits > 0 && textHits > 0) score += 4;

    // Confirm row below looks like data (has a parseable date or number)
    const nextRow = matrix[r + 1];
    if (nextRow && score > 0) {
      const hasDataLike = nextRow.some(
        (c) => parseBankDate(c, 'auto') !== null || parseBankNumber(c, 'auto') !== null
      );
      if (hasDataLike) score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }

  return bestScore > 0 ? bestIdx : 0;
}

function makeUniqueHeaders(headerRow: string[]): string[] {
  const seen = new Map<string, number>();
  return headerRow.map((raw, idx) => {
    const base = raw.trim() || `Column ${idx + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function extractPreambleIban(matrix: string[][], headerRowIndex: number): string | undefined {
  const end = Math.min(matrix.length, Math.max(0, headerRowIndex));
  for (let r = 0; r < end; r++) {
    const row = matrix[r];
    if (!row) continue;
    for (const cell of row) {
      const compact = cell.replace(/\s+/g, '').toUpperCase();
      const match = compact.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/);
      if (match) return match[1];
    }
  }
  return undefined;
}

// ================= BUILT-IN BANK PROFILES =================

export const BUILTIN_BANK_PROFILES: BankImportProfile[] = [
  {
    id: 'builtin-koban',
    name: 'Koban Transactions Export',
    headerFingerprint: ['Date', 'Type', 'Category', 'Description', 'Amount'],
    delimiter: ',',
    dateColumn: 'Date',
    dateFormat: 'YYYY-MM-DD',
    amountMode: 'signed',
    amountColumn: 'Amount',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Description'],
    referenceColumn: 'Invoice / Ref',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-ubs-ch',
    name: 'UBS Switzerland (CSV)',
    headerFingerprint: ['Abschlussdatum', 'Beschreibung1', 'Belastung', 'Gutschrift'],
    delimiter: ';',
    dateColumn: 'Abschlussdatum',
    dateFormat: 'DD.MM.YYYY',
    amountMode: 'split_debit_credit',
    debitColumn: 'Belastung',
    creditColumn: 'Gutschrift',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Beschreibung1', 'Beschreibung2', 'Beschreibung3'],
    referenceColumn: 'Transaktions-Nr.',
    currencyColumn: 'Währung',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-postfinance-ch',
    name: 'PostFinance Switzerland (CSV)',
    headerFingerprint: ['Datum', 'Avisierungstext', 'Gutschrift in CHF', 'Lastschrift in CHF'],
    delimiter: ';',
    dateColumn: 'Datum',
    dateFormat: 'auto',
    amountMode: 'split_debit_credit',
    debitColumn: 'Lastschrift in CHF',
    creditColumn: 'Gutschrift in CHF',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Avisierungstext'],
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-zkb-ch',
    name: 'ZKB Zürcher Kantonalbank (CSV)',
    headerFingerprint: ['Datum', 'Buchungstext', 'Belastung CHF', 'Gutschrift CHF'],
    delimiter: ';',
    dateColumn: 'Datum',
    dateFormat: 'DD.MM.YYYY',
    amountMode: 'split_debit_credit',
    debitColumn: 'Belastung CHF',
    creditColumn: 'Gutschrift CHF',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Buchungstext', 'Zahlungszweck'],
    referenceColumn: 'ZKB-Referenz',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-raiffeisen-ch',
    name: 'Raiffeisen Switzerland (CSV)',
    headerFingerprint: ['Booked At', 'Text', 'Credit/Debit Amount'],
    delimiter: ';',
    dateColumn: 'Booked At',
    dateFormat: 'auto',
    amountMode: 'signed',
    amountColumn: 'Credit/Debit Amount',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Text'],
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-neon-ch',
    name: 'Neon Switzerland (CSV)',
    headerFingerprint: ['Date', 'Amount', 'Description', 'Subject'],
    delimiter: ';',
    dateColumn: 'Date',
    dateFormat: 'YYYY-MM-DD',
    amountMode: 'signed',
    amountColumn: 'Amount',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Description', 'Subject'],
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-yuh-ch',
    name: 'Yuh Switzerland (CSV)',
    headerFingerprint: ['DATE', 'ACTIVITY TYPE', 'ACTIVITY NAME', 'DEBIT', 'CREDIT'],
    delimiter: ';',
    dateColumn: 'DATE',
    dateFormat: 'auto',
    amountMode: 'split_debit_credit',
    debitColumn: 'DEBIT',
    creditColumn: 'CREDIT',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['ACTIVITY NAME', 'ACTIVITY TYPE'],
    currencyColumn: 'PAYMENT CURRENCY',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-migros-ch',
    name: 'Migros Bank (CSV)',
    headerFingerprint: ['Datum', 'Buchungstext', 'Mitteilung', 'Betrag'],
    delimiter: ';',
    dateColumn: 'Datum',
    dateFormat: 'DD.MM.YYYY',
    amountMode: 'signed',
    amountColumn: 'Betrag',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Buchungstext', 'Mitteilung'],
    referenceColumn: 'Referenznummer',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-revolut',
    name: 'Revolut (CSV)',
    headerFingerprint: ['Started Date', 'Description', 'Amount', 'Currency'],
    delimiter: ',',
    dateColumn: 'Completed Date',
    dateFormat: 'YYYY-MM-DD',
    amountMode: 'signed',
    amountColumn: 'Amount',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Description'],
    currencyColumn: 'Currency',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-wise',
    name: 'Wise (CSV)',
    headerFingerprint: ['TransferWise ID', 'Date', 'Amount', 'Description'],
    delimiter: ',',
    dateColumn: 'Date',
    dateFormat: 'auto',
    amountMode: 'signed',
    amountColumn: 'Amount',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Description', 'Merchant', 'Payee Name'],
    referenceColumn: 'TransferWise ID',
    currencyColumn: 'Currency',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-n26',
    name: 'N26 (CSV)',
    headerFingerprint: ['Booking Date', 'Partner Name', 'Payment Reference', 'Amount (EUR)'],
    delimiter: ',',
    dateColumn: 'Booking Date',
    dateFormat: 'YYYY-MM-DD',
    amountMode: 'signed',
    amountColumn: 'Amount (EUR)',
    invertSign: false,
    decimalSeparator: '.',
    descriptionColumns: ['Partner Name', 'Payment Reference'],
    payeeColumn: 'Partner Name',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-dkb-de',
    name: 'DKB / German SEPA (CSV)',
    headerFingerprint: ['Buchungsdatum', 'Verwendungszweck', 'Betrag (€)'],
    delimiter: ';',
    dateColumn: 'Buchungsdatum',
    dateFormat: 'DD.MM.YYYY',
    amountMode: 'signed',
    amountColumn: 'Betrag (€)',
    invertSign: false,
    decimalSeparator: ',',
    descriptionColumns: ['Zahlungsempfänger*in', 'Verwendungszweck'],
    payeeColumn: 'Zahlungsempfänger*in',
    referenceColumn: 'Kundenreferenz',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-ing-de',
    name: 'ING Germany (CSV)',
    headerFingerprint: ['Buchung', 'Auftraggeber/Empfänger', 'Buchungstext', 'Verwendungszweck', 'Betrag'],
    delimiter: ';',
    dateColumn: 'Buchung',
    dateFormat: 'DD.MM.YYYY',
    amountMode: 'signed',
    amountColumn: 'Betrag',
    invertSign: false,
    decimalSeparator: ',',
    descriptionColumns: ['Auftraggeber/Empfänger', 'Buchungstext', 'Verwendungszweck'],
    payeeColumn: 'Auftraggeber/Empfänger',
    currencyColumn: 'Währung',
    updatedAt: '2026-01-01',
  },
  {
    id: 'builtin-sparkasse-de',
    name: 'Sparkasse / Volksbank (CSV)',
    headerFingerprint: ['Buchungstag', 'Buchungstext', 'Verwendungszweck', 'Betrag'],
    delimiter: ';',
    dateColumn: 'Buchungstag',
    dateFormat: 'DD.MM.YYYY',
    amountMode: 'signed',
    amountColumn: 'Betrag',
    invertSign: false,
    decimalSeparator: ',',
    descriptionColumns: ['Begünstigter/Zahlungspflichtiger', 'Buchungstext', 'Verwendungszweck'],
    payeeColumn: 'Begünstigter/Zahlungspflichtiger',
    currencyColumn: 'Waehrung',
    updatedAt: '2026-01-01',
  },
];

const BANK_ALTERNATE_FINGERPRINTS: Record<string, string[][]> = {
  'builtin-ubs-ch': [
    ['Trade date', 'Description1', 'Debit', 'Credit'],
    ['Booking date', 'Description1', 'Debit', 'Credit'],
    ['Buchungsdatum', 'Beschreibung1', 'Belastung', 'Gutschrift'],
    ['Buchungstag', 'Beschreibung1', 'Belastung', 'Gutschrift'],
    ['Date de transaction', 'Description1', 'Débit', 'Crédit'],
    ['Data di conclusione', 'Descrizione1', 'Addebito', 'Accredito'],
  ],
  'builtin-postfinance-ch': [
    ['Buchungsdatum', 'Avisierungstext', 'Gutschrift', 'Lastschrift'],
    ['Datum', 'Bewegungstext', 'Gutschrift', 'Lastschrift'],
    ['Booking date', 'Notification text', 'Credit', 'Debit'],
  ],
  'builtin-zkb-ch': [
    ['Buchungsdatum', 'Buchungstext', 'Belastung', 'Gutschrift'],
    ['Datum', 'Buchungstext', 'Betrag CHF'],
  ],
  'builtin-raiffeisen-ch': [
    ['Valuta', 'Buchungstext', 'Belastung', 'Gutschrift'],
    ['Buchungsdatum', 'Buchungstext', 'Betrag'],
  ],
  'builtin-yuh-ch': [
    ['DATE', 'ACTIVITY NAME', 'AMOUNT'],
    ['Date', 'Activity name', 'Debit', 'Credit'],
  ],
  'builtin-n26': [
    ['Booking Date', 'Partner Name', 'Payment Reference', 'Amount (CHF)'],
  ],
  'builtin-dkb-de': [
    ['Buchungsdatum', 'Verwendungszweck', 'Betrag'],
    ['Buchungstag', 'Verwendungszweck', 'Betrag (EUR)'],
  ],
};

interface BankAliasDef {
  date?: string[];
  amount?: string[];
  debit?: string[];
  credit?: string[];
  description?: string[];
  payee?: string[];
  reference?: string[];
  currency?: string[];
}

const BANK_HEADER_ALIASES: Record<string, BankAliasDef> = {
  'builtin-ubs-ch': {
    date: [
      'Abschlussdatum',
      'Buchungstag',
      'Buchungsdatum',
      'Valutadatum',
      'Trade date',
      'Booking date',
      'Value date',
      'Date de transaction',
      'Date de comptabilisation',
      'Data di conclusione',
    ],
    debit: ['Belastung', 'Debit', 'Débit', 'Addebito', 'Ausgabe'],
    credit: ['Gutschrift', 'Credit', 'Crédit', 'Accredito', 'Eingang'],
    amount: ['Einzelbetrag', 'Individual amount', 'Amount', 'Betrag'],
    description: [
      'Beschreibung 1',
      'Beschreibung 2',
      'Beschreibung 3',
      'Beschreibung',
      'Description 1',
      'Description 2',
      'Description 3',
      'Description',
      'Descrizione 1',
      'Descrizione 2',
      'Descrizione 3',
      'Buchungstext',
      'Fussnoten',
      'Footnotes',
    ],
    reference: ['Transaktions-Nr.', 'Transaction no.', 'No de transaction', 'Referenz'],
    currency: ['Währung', 'Waehrung', 'Currency', 'Monnaie', 'Moneta'],
  },
  'builtin-postfinance-ch': {
    date: ['Datum', 'Buchungsdatum', 'Valuta', 'Booking date', 'Date'],
    debit: ['Lastschrift in CHF', 'Lastschrift', 'Belastung', 'Debit', 'Débit'],
    credit: ['Gutschrift in CHF', 'Gutschrift', 'Credit', 'Crédit'],
    description: ['Avisierungstext', 'Bewegungstext', 'Notification text', 'Texte de notification', 'Buchungstext'],
    currency: ['Währung', 'Waehrung', 'Currency'],
  },
  'builtin-zkb-ch': {
    date: ['Datum', 'Buchungsdatum', 'Valuta'],
    debit: ['Belastung CHF', 'Belastung', 'Debit'],
    credit: ['Gutschrift CHF', 'Gutschrift', 'Credit'],
    amount: ['Betrag CHF', 'Betrag'],
    description: ['Buchungstext', 'Zahlungszweck', 'Details'],
    reference: ['ZKB-Referenz', 'Referenz'],
  },
  'builtin-raiffeisen-ch': {
    date: ['Booked At', 'Valuta', 'Buchungsdatum', 'Datum'],
    amount: ['Credit/Debit Amount', 'Betrag', 'Amount'],
    debit: ['Belastung', 'Debit'],
    credit: ['Gutschrift', 'Credit'],
    description: ['Text', 'Buchungstext', 'Mitteilung'],
  },
  'builtin-yuh-ch': {
    date: ['DATE', 'Date'],
    debit: ['DEBIT', 'Debit'],
    credit: ['CREDIT', 'Credit'],
    amount: ['AMOUNT', 'Amount'],
    description: ['ACTIVITY NAME', 'ACTIVITY TYPE', 'Description', 'COUNTERPARTY'],
    payee: ['COUNTERPARTY', 'ACTIVITY NAME'],
    currency: ['PAYMENT CURRENCY', 'TRANSACTION CURRENCY', 'Currency'],
  },
  'builtin-migros-ch': {
    date: ['Datum', 'Valuta', 'Buchungsdatum'],
    amount: ['Betrag', 'Amount'],
    description: ['Buchungstext', 'Mitteilung', 'Text'],
    reference: ['Referenznummer', 'Referenz'],
    currency: ['Währung', 'Waehrung', 'Currency'],
  },
  'builtin-revolut': {
    date: ['Completed Date', 'Started Date', 'Date'],
    amount: ['Amount'],
    description: ['Description', 'Reference'],
    currency: ['Currency'],
  },
  'builtin-n26': {
    date: ['Booking Date', 'Value Date'],
    amount: ['Amount (EUR)', 'Amount (CHF)', 'Amount'],
    description: ['Partner Name', 'Payment Reference', 'Type'],
    payee: ['Partner Name'],
  },
  'builtin-dkb-de': {
    date: ['Buchungsdatum', 'Buchungstag', 'Wertstellung'],
    amount: ['Betrag (€)', 'Betrag (EUR)', 'Betrag'],
    description: ['Zahlungsempfänger*in', 'Zahlungspflichtige*r', 'Verwendungszweck', 'Umsatztyp'],
    payee: ['Zahlungsempfänger*in'],
    reference: ['Kundenreferenz'],
  },
  'builtin-ing-de': {
    date: ['Buchung', 'Valuta'],
    amount: ['Betrag'],
    description: ['Auftraggeber/Empfänger', 'Buchungstext', 'Verwendungszweck'],
    payee: ['Auftraggeber/Empfänger'],
    currency: ['Währung'],
  },
  'builtin-sparkasse-de': {
    date: ['Buchungstag', 'Valutatag', 'Buchungsdatum'],
    amount: ['Betrag'],
    description: ['Begünstigter/Zahlungspflichtiger', 'Buchungstext', 'Verwendungszweck'],
    payee: ['Begünstigter/Zahlungspflichtiger'],
    currency: ['Waehrung', 'Währung', 'Currency'],
  },
};

function scoreHeaderFingerprint(headers: string[], fingerprint: string[]): number {
  if (fingerprint.length === 0) return 0;
  const lowerHeaders = headers.map((h) => h.trim().toLowerCase());
  const normHeaders = headers.map((h) => normalizeHeaderKey(h));
  let hits = 0;
  for (const fp of fingerprint) {
    const fpl = fp.trim().toLowerCase();
    const fpn = normalizeHeaderKey(fp);
    if (
      lowerHeaders.some((h) => h === fpl || h.includes(fpl)) ||
      (fpn && normHeaders.some((nh) => nh === fpn || nh.includes(fpn)))
    ) {
      hits++;
    }
  }
  return hits / fingerprint.length;
}

function findColumnByCandidates(headers: string[], candidates: string[]): string | undefined {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const norm = headers.map((h) => normalizeHeaderKey(h));
  for (const c of candidates) {
    const cl = c.trim().toLowerCase();
    if (!cl) continue;
    const exact = lower.findIndex((h) => h === cl);
    if (exact >= 0) return headers[exact];
  }
  for (const c of candidates) {
    const cn = normalizeHeaderKey(c);
    if (!cn) continue;
    const normMatch = norm.findIndex((h) => h === cn);
    if (normMatch >= 0) return headers[normMatch];
  }
  for (const c of candidates) {
    const cl = c.trim().toLowerCase();
    if (cl.length < 3) continue;
    const partial = lower.findIndex((h) => h.includes(cl));
    if (partial >= 0) return headers[partial];
  }
  for (const c of candidates) {
    const cn = normalizeHeaderKey(c);
    if (cn.length < 4) continue;
    const normPartial = norm.findIndex((h) => h.includes(cn));
    if (normPartial >= 0) return headers[normPartial];
  }
  return undefined;
}

function findAllMatchingColumns(headers: string[], candidates: string[]): string[] {
  const out: string[] = [];
  for (const cand of candidates) {
    const cl = cand.trim().toLowerCase();
    const cn = normalizeHeaderKey(cand);
    const exactIdx = headers.findIndex((h) => h.trim().toLowerCase() === cl);
    if (exactIdx >= 0) {
      if (!out.includes(headers[exactIdx])) out.push(headers[exactIdx]);
      continue;
    }
    if (cn) {
      const normIdx = headers.findIndex((h) => normalizeHeaderKey(h) === cn);
      if (normIdx >= 0 && !out.includes(headers[normIdx])) {
        out.push(headers[normIdx]);
      }
    }
  }
  return out;
}

function resolveProfileAgainstHeaders(
  profile: BankImportProfile,
  headers: string[],
  sampleRows: string[][]
): {
  resolved: BankImportProfile;
  missingFields: string[];
} {
  const aliases = BANK_HEADER_ALIASES[profile.id];
  const resolvedDate =
    findColumnByCandidates(headers, [
      profile.dateColumn,
      ...(aliases?.date ?? []),
    ]) ?? '';

  let amountMode = profile.amountMode;
  let resolvedDebit = profile.debitColumn
    ? findColumnByCandidates(headers, [profile.debitColumn, ...(aliases?.debit ?? [])])
    : findColumnByCandidates(headers, aliases?.debit ?? []);
  let resolvedCredit = profile.creditColumn
    ? findColumnByCandidates(headers, [profile.creditColumn, ...(aliases?.credit ?? [])])
    : findColumnByCandidates(headers, aliases?.credit ?? []);
  let resolvedAmount = profile.amountColumn
    ? findColumnByCandidates(headers, [profile.amountColumn, ...(aliases?.amount ?? [])])
    : findColumnByCandidates(headers, aliases?.amount ?? []);

  if (amountMode === 'split_debit_credit') {
    if (!resolvedDebit && !resolvedCredit && resolvedAmount) {
      amountMode = 'signed';
    }
  } else if (!resolvedAmount && resolvedDebit && resolvedCredit) {
    amountMode = 'split_debit_credit';
  }

  const descCandidates = [
    ...profile.descriptionColumns,
    ...(aliases?.description ?? []),
  ];
  let resolvedDesc = findAllMatchingColumns(headers, descCandidates);
  if (resolvedDesc.length === 0) {
    const fallbackDesc = findColumnByCandidates(headers, [
      'description',
      'buchungstext',
      'verwendungszweck',
      'avisierungstext',
      'beschreibung',
      'text',
      'memo',
      'details',
      'subject',
      'purpose',
    ]);
    if (fallbackDesc) resolvedDesc = [fallbackDesc];
  }

  const resolvedPayee =
    profile.payeeColumn || aliases?.payee
      ? findColumnByCandidates(headers, [
          ...(profile.payeeColumn ? [profile.payeeColumn] : []),
          ...(aliases?.payee ?? []),
        ])
      : undefined;

  const resolvedRef =
    profile.referenceColumn || aliases?.reference
      ? findColumnByCandidates(headers, [
          ...(profile.referenceColumn ? [profile.referenceColumn] : []),
          ...(aliases?.reference ?? []),
        ])
      : undefined;

  const resolvedCurrency =
    profile.currencyColumn || aliases?.currency
      ? findColumnByCandidates(headers, [
          ...(profile.currencyColumn ? [profile.currencyColumn] : []),
          ...(aliases?.currency ?? []),
        ])
      : undefined;

  // Infer date/decimal format if samples disagree with hardcoded preset
  let resolvedDateFormat = profile.dateFormat;
  if (resolvedDate) {
    const dIdx = headers.indexOf(resolvedDate);
    if (dIdx >= 0) {
      const dateSamples = sampleRows.map((r) => r[dIdx] ?? '');
      const inferredDate = inferDateFormatFromSamples(dateSamples);
      if (inferredDate !== 'auto') {
        resolvedDateFormat = inferredDate;
      }
    }
  }

  let resolvedDec = profile.decimalSeparator;
  const checkAmtCol = resolvedAmount || resolvedDebit || resolvedCredit;
  if (checkAmtCol) {
    const aIdx = headers.indexOf(checkAmtCol);
    if (aIdx >= 0) {
      const amtSamples = sampleRows.map((r) => r[aIdx] ?? '');
      const hasCommaDec = amtSamples.some((s) => /\d+\.\d{3},\d{1,2}\b/.test(s) || /,\d{2}$/.test(s.trim()));
      const hasDotDec = amtSamples.some((s) => /\.\d{2}$/.test(s.trim()));
      if (hasCommaDec && !hasDotDec) resolvedDec = ',';
      else if (hasDotDec && !hasCommaDec) resolvedDec = '.';
    }
  }

  const missingFields: string[] = [];
  if (!resolvedDate) missingFields.push('Date');
  if (amountMode === 'split_debit_credit' && !resolvedDebit && !resolvedCredit) {
    missingFields.push('Debit / Credit');
  } else if (amountMode === 'signed' && !resolvedAmount) {
    missingFields.push('Amount');
  }
  if (resolvedDesc.length === 0 && !resolvedPayee) {
    missingFields.push('Description');
  }

  return {
    resolved: {
      ...profile,
      dateColumn: resolvedDate || headers[0] || profile.dateColumn,
      dateFormat: resolvedDateFormat,
      amountMode,
      amountColumn: resolvedAmount,
      debitColumn: resolvedDebit,
      creditColumn: resolvedCredit,
      decimalSeparator: resolvedDec,
      descriptionColumns: resolvedDesc,
      payeeColumn: resolvedPayee,
      referenceColumn: resolvedRef,
      currencyColumn: resolvedCurrency,
    },
    missingFields,
  };
}

function inferAutoProfile(
  headers: string[],
  sampleRows: string[][],
  accountId?: string,
  delimiter?: string
): {
  profile: BankImportProfile;
  needsMappingReview: boolean;
} {
  const dateColumn =
    findColumnByCandidates(headers, [
      'date',
      'trade date',
      'booking date',
      'completed date',
      'transaction date',
      'posting date',
      'datum',
      'abschlussdatum',
      'buchungsdatum',
      'buchungstag',
      'buchung',
      'valuta',
    ]) ??
    headers[0] ??
    '';

  const debitCol = findColumnByCandidates(headers, [
    'debit',
    'belastung',
    'lastschrift',
    'ausgabe',
    'withdrawal',
    'addebito',
    'débit',
  ]);
  const creditCol = findColumnByCandidates(headers, [
    'credit',
    'gutschrift',
    'eingang',
    'deposit',
    'accredito',
    'crédit',
  ]);
  const amountCol = findColumnByCandidates(headers, [
    'amount',
    'betrag',
    'montant',
    'importo',
    'einzelbetrag',
    'individual amount',
    'total',
    'value',
    'sum',
    'chf',
    'eur',
  ]);

  const splitCols = Boolean(debitCol && creditCol && (!amountCol || /einzelbetrag|individual/i.test(amountCol)));
  const payeeCol = findColumnByCandidates(headers, [
    'payee',
    'merchant',
    'empfänger',
    'empfaenger',
    'auftraggeber',
    'partner',
    'counterparty',
    'name',
  ]);
  const descCol1 = findColumnByCandidates(headers, [
    'description 1',
    'description1',
    'beschreibung 1',
    'beschreibung1',
    'description',
    'buchungstext',
    'verwendungszweck',
    'avisierungstext',
    'beschreibung',
    'text',
    'memo',
    'details',
    'subject',
    'purpose',
  ]);
  const descCol2 = findColumnByCandidates(headers, [
    'description 2',
    'description2',
    'beschreibung 2',
    'beschreibung2',
  ]);
  const descCol3 = findColumnByCandidates(headers, [
    'description 3',
    'description3',
    'beschreibung 3',
    'beschreibung3',
  ]);
  const descCols = [descCol1, descCol2, descCol3, payeeCol].filter(
    (c, idx, arr): c is string => Boolean(c) && arr.indexOf(c) === idx
  );
  if (descCols.length === 0 && headers.length > 2) {
    descCols.push(headers[1]);
  }

  const dateColIdx = headers.indexOf(dateColumn);
  const dateSamples =
    dateColIdx >= 0 ? sampleRows.map((r) => r[dateColIdx] ?? '') : [];
  const inferredDateFmt = inferDateFormatFromSamples(dateSamples);

  const amountIdx = amountCol ? headers.indexOf(amountCol) : -1;
  const amountSamples =
    amountIdx >= 0 ? sampleRows.map((r) => r[amountIdx] ?? '') : [];
  let inferredDec: BankDecimalSeparator = 'auto';
  if (amountSamples.some((s) => /\d+\.\d{3},\d{1,2}\b/.test(s) || /,\d{2}$/.test(s.trim()))) {
    if (!amountSamples.some((s) => /\.\d{2}$/.test(s.trim()))) {
      inferredDec = ',';
    }
  }

  const profile: BankImportProfile = {
    id: `prof-auto-${Date.now()}`,
    name: 'Custom Mapping',
    accountId,
    headerFingerprint: headers.slice(0, 8),
    delimiter,
    dateColumn,
    dateFormat: inferredDateFmt,
    amountMode: splitCols ? 'split_debit_credit' : 'signed',
    amountColumn: amountCol,
    debitColumn: debitCol,
    creditColumn: creditCol,
    invertSign: false,
    decimalSeparator: inferredDec,
    descriptionColumns: descCols,
    payeeColumn: payeeCol,
    referenceColumn: findColumnByCandidates(headers, [
      'reference',
      'referenz',
      'transaktions-nr.',
      'transaction no.',
      'invoiceref',
      'invoice',
      'ref',
      'fitid',
    ]),
    currencyColumn: findColumnByCandidates(headers, [
      'currency',
      'währung',
      'waehrung',
      'ccy',
    ]),
    updatedAt: new Date().toISOString().slice(0, 10),
  };

  return {
    profile,
    needsMappingReview: headers.length > 0,
  };
}

export function matchOrInferCsvProfile(
  headers: string[],
  sampleRows: string[][],
  savedProfiles: BankImportProfile[],
  accountId?: string,
  delimiter?: string,
  selectedProfileId?: string
): {
  profile: BankImportProfile;
  source: 'saved' | 'builtin' | 'auto';
  needsMappingReview: boolean;
  warnings: string[];
} {
  if (selectedProfileId === 'custom') {
    const auto = inferAutoProfile(headers, sampleRows, accountId, delimiter);
    return {
      profile: auto.profile,
      source: 'auto',
      needsMappingReview: true,
      warnings: [],
    };
  }

  if (selectedProfileId && selectedProfileId !== 'auto') {
    const saved = savedProfiles.find((p) => p.id === selectedProfileId);
    if (saved) {
      const { resolved, missingFields } = resolveProfileAgainstHeaders(saved, headers, sampleRows);
      const warnings =
        missingFields.length > 0
          ? [`Saved profile "${saved.name}" could not auto-match column(s): ${missingFields.join(', ')}.`]
          : [];
      return {
        profile: resolved,
        source: 'saved',
        needsMappingReview: missingFields.length > 0,
        warnings,
      };
    }

    const builtin = BUILTIN_BANK_PROFILES.find((p) => p.id === selectedProfileId);
    if (builtin) {
      const { resolved, missingFields } = resolveProfileAgainstHeaders(builtin, headers, sampleRows);
      const warnings =
        missingFields.length > 0
          ? [`Selected bank preset "${builtin.name}" could not auto-match column(s): ${missingFields.join(', ')}. Please verify the mapping.`]
          : [];
      return {
        profile: resolved,
        source: 'builtin',
        needsMappingReview: missingFields.length > 0,
        warnings,
      };
    }
  }

  // 1. Saved user profiles (preferring profiles scoped to this accountId)
  const orderedSaved = [...savedProfiles].sort((a, b) => {
    const aScope = a.accountId === accountId ? 1 : 0;
    const bScope = b.accountId === accountId ? 1 : 0;
    return bScope - aScope;
  });

  for (const prof of orderedSaved) {
    if (scoreHeaderFingerprint(headers, prof.headerFingerprint) >= 0.75) {
      const { resolved, missingFields } = resolveProfileAgainstHeaders(prof, headers, sampleRows);
      return {
        profile: resolved,
        source: 'saved',
        needsMappingReview: missingFields.length > 0,
        warnings:
          missingFields.length > 0
            ? [`Saved profile "${prof.name}" could not auto-match column(s): ${missingFields.join(', ')}.`]
            : [],
      };
    }
  }

  // 2. Built-in presets (checking primary + multilingual alternate fingerprints)
  for (const preset of BUILTIN_BANK_PROFILES) {
    const fingerprints = [
      preset.headerFingerprint,
      ...(BANK_ALTERNATE_FINGERPRINTS[preset.id] ?? []),
    ];
    const matched = fingerprints.some((fp) => scoreHeaderFingerprint(headers, fp) >= 0.75);
    if (matched) {
      const { resolved, missingFields } = resolveProfileAgainstHeaders(preset, headers, sampleRows);
      return {
        profile: resolved,
        source: 'builtin',
        needsMappingReview: missingFields.length > 0,
        warnings:
          missingFields.length > 0
            ? [`Detected "${preset.name}", but could not auto-match column(s): ${missingFields.join(', ')}. Please verify the mapping.`]
            : [],
      };
    }
  }

  // 3. Auto-inference for unknown bank CSV
  const auto = inferAutoProfile(headers, sampleRows, accountId, delimiter);
  return {
    profile: auto.profile,
    source: 'auto',
    needsMappingReview: auto.needsMappingReview,
    warnings: [],
  };
}

export function extractRawTransactionsFromMatrix(
  matrix: string[][],
  headerRowIndex: number,
  profile: BankImportProfile,
  fallbackCurrency?: string
): { rawTransactions: RawBankTransaction[]; warnings: string[] } {
  const warnings: string[] = [];
  if (headerRowIndex < 0 || headerRowIndex >= matrix.length) {
    return { rawTransactions: [], warnings: ['No header row found.'] };
  }
  const headers = makeUniqueHeaders(matrix[headerRowIndex] ?? []);
  const normHeaders = headers.map((h) => normalizeHeaderKey(h));
  const colIdx = (name?: string): number => {
    if (!name) return -1;
    const exact = headers.indexOf(name);
    if (exact >= 0) return exact;
    const lower = name.trim().toLowerCase();
    const lc = headers.findIndex((h) => h.trim().toLowerCase() === lower);
    if (lc >= 0) return lc;
    const norm = normalizeHeaderKey(name);
    return norm ? normHeaders.findIndex((h) => h === norm) : -1;
  };

  const dIdx = colIdx(profile.dateColumn);
  const aIdx = colIdx(profile.amountColumn);
  const debIdx = colIdx(profile.debitColumn);
  const crIdx = colIdx(profile.creditColumn);
  const payIdx = colIdx(profile.payeeColumn);
  const refIdx = colIdx(profile.referenceColumn);
  const ccyIdx = colIdx(profile.currencyColumn);
  const catHintIdx = headers.findIndex((h) =>
    ['category', 'kategorie', 'subcategory'].includes(h.trim().toLowerCase())
  );
  const typeHintIdx = headers.findIndex((h) =>
    ['type', 'kind', 'direction'].includes(h.trim().toLowerCase())
  );
  const descIndices = profile.descriptionColumns
    .map((c) => colIdx(c))
    .filter((i, pos, arr) => i >= 0 && arr.indexOf(i) === pos);

  const rawTransactions: RawBankTransaction[] = [];

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.every((c) => !c.trim())) continue;

    const rawDate = dIdx >= 0 ? row[dIdx] ?? '' : '';
    const isoDate = parseBankDate(rawDate, profile.dateFormat, true);
    if (!isoDate) continue;

    let signedAmount: number | null = null;
    if (profile.amountMode === 'split_debit_credit') {
      const deb =
        debIdx >= 0 ? parseBankNumber(row[debIdx], profile.decimalSeparator) : null;
      const cr =
        crIdx >= 0 ? parseBankNumber(row[crIdx], profile.decimalSeparator) : null;
      if (deb !== null && Math.abs(deb) >= 0.0001) {
        signedAmount = -Math.abs(deb);
      } else if (cr !== null && Math.abs(cr) >= 0.0001) {
        signedAmount = Math.abs(cr);
      } else if (aIdx >= 0) {
        signedAmount = parseBankNumber(row[aIdx], profile.decimalSeparator);
      }
    } else if (aIdx >= 0) {
      signedAmount = parseBankNumber(row[aIdx], profile.decimalSeparator);
    }

    if (signedAmount === null || Math.abs(signedAmount) < 0.0001) continue;

    // Respect Koban's exported positive-only Amount + Type columns
    if (typeHintIdx >= 0 && signedAmount > 0) {
      const typeCell = (row[typeHintIdx] ?? '').trim().toLowerCase();
      if (typeCell === 'expense') signedAmount = -Math.abs(signedAmount);
      else if (typeCell === 'income') signedAmount = Math.abs(signedAmount);
    }

    if (profile.invertSign) {
      signedAmount = -signedAmount;
    }

    const rawPayee = payIdx >= 0 ? (row[payIdx] ?? '').trim() : '';
    const descPieces = descIndices
      .map((i) => (row[i] ?? '').trim())
      .filter((s, idx, arr) => s && arr.indexOf(s) === idx);
    const rawDescription =
      descPieces.join(' · ') || rawPayee || 'Imported Bank Entry';
    const reference = refIdx >= 0 ? (row[refIdx] ?? '').trim() : '';
    const currency =
      (ccyIdx >= 0 ? (row[ccyIdx] ?? '').trim() : '') || fallbackCurrency;
    const categoryHint =
      catHintIdx >= 0 ? (row[catHintIdx] ?? '').trim() : undefined;

    rawTransactions.push({
      rowIndex: r,
      date: isoDate,
      signedAmount,
      currency: currency || undefined,
      externalId:
        profile.id === 'builtin-wise' && reference ? reference : undefined,
      rawPayee,
      rawDescription,
      reference: reference || undefined,
      categoryHint: categoryHint || undefined,
    });
  }

  return { rawTransactions, warnings };
}

function getPreferredDelimiterForSelection(
  selectedProfileId: string | undefined,
  savedProfiles: BankImportProfile[]
): string | undefined {
  if (!selectedProfileId || selectedProfileId === 'auto' || selectedProfileId === 'custom') {
    return undefined;
  }
  return (
    savedProfiles.find((p) => p.id === selectedProfileId)?.delimiter ??
    BUILTIN_BANK_PROFILES.find((p) => p.id === selectedProfileId)?.delimiter
  );
}

function parseTabularRows(
  rows: string[][],
  fileName: string,
  format: 'csv' | 'spreadsheet',
  options?: {
    savedProfiles?: BankImportProfile[];
    accountId?: string;
    fallbackCurrency?: string;
    selectedProfileId?: string;
    delimiter?: string;
    sheetName?: string;
    rawText?: string;
  }
): BankStatementParseResult {
  const headerRowIndex = detectHeaderRow(rows);
  const headers = makeUniqueHeaders(rows[headerRowIndex] ?? []);
  const sampleRows = rows.slice(headerRowIndex + 1, headerRowIndex + 15);
  const detectedAccountIban = extractPreambleIban(rows, headerRowIndex);
  const matched = matchOrInferCsvProfile(
    headers,
    sampleRows,
    options?.savedProfiles ?? [],
    options?.accountId,
    options?.delimiter,
    options?.selectedProfileId
  );
  const extracted = extractRawTransactionsFromMatrix(
    rows,
    headerRowIndex,
    matched.profile,
    options?.fallbackCurrency
  );
  const warnings = [...matched.warnings, ...extracted.warnings];
  const needsMappingReview =
    matched.needsMappingReview || extracted.rawTransactions.length === 0;

  return {
    format,
    fileName,
    sheetName: options?.sheetName,
    detectedAccountIban,
    rawText: options?.rawText,
    rawRows: rows,
    headerRowIndex,
    headers,
    delimiter: options?.delimiter,
    selectedProfileId: options?.selectedProfileId ?? 'auto',
    matchedProfile: matched.profile,
    matchedProfileSource: matched.source,
    needsMappingReview,
    activeMapping: matched.profile,
    rawTransactions: extracted.rawTransactions,
    warnings,
  };
}

export function parseBankStatementBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options?: {
    savedProfiles?: BankImportProfile[];
    accountId?: string;
    fallbackCurrency?: string;
    selectedProfileId?: string;
  }
): BankStatementParseResult {
  const lowerName = fileName.toLowerCase();
  const isSpreadsheet = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');

  if (!isSpreadsheet) {
    const text = decodeTextBuffer(buffer);
    if (lowerName.endsWith('.xml') || isCamtXml(text)) {
      return parseCamtXml(text, fileName);
    }
    if (lowerName.endsWith('.ofx') || lowerName.endsWith('.qfx') || isOfxContent(text)) {
      return parseOfx(text, fileName);
    }

    const prefDelim = getPreferredDelimiterForSelection(
      options?.selectedProfileId,
      options?.savedProfiles ?? []
    );
    const { rows, delimiter } = parseCsvToMatrix(text, prefDelim);
    return parseTabularRows(rows, fileName, 'csv', {
      savedProfiles: options?.savedProfiles,
      accountId: options?.accountId,
      fallbackCurrency: options?.fallbackCurrency,
      selectedProfileId: options?.selectedProfileId,
      delimiter,
      rawText: text,
    });
  }

  // Excel (.xlsx / .xls)
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase().includes('transaction')) ??
    wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });
  const rows: string[][] = rawMatrix
    .map((r) =>
      r.map((cell) => {
        if (typeof cell === 'number' && cell > 20000 && cell < 80000) {
          return String(cell);
        }
        return String(cell ?? '').trim();
      })
    )
    .filter((r) => r.some((c) => c.length > 0));

  return parseTabularRows(rows, fileName, 'spreadsheet', {
    savedProfiles: options?.savedProfiles,
    accountId: options?.accountId,
    fallbackCurrency: options?.fallbackCurrency,
    selectedProfileId: options?.selectedProfileId,
    sheetName,
  });
}

export function reparseBankStatementWithProfile(
  prevResult: BankStatementParseResult,
  selectedProfileId: string,
  options?: {
    savedProfiles?: BankImportProfile[];
    accountId?: string;
    fallbackCurrency?: string;
  }
): BankStatementParseResult {
  if (prevResult.format === 'camt053' || prevResult.format === 'ofx') {
    return { ...prevResult, selectedProfileId };
  }

  if (prevResult.format === 'csv' && prevResult.rawText !== undefined) {
    const prefDelim = getPreferredDelimiterForSelection(
      selectedProfileId,
      options?.savedProfiles ?? []
    );
    const { rows, delimiter } = parseCsvToMatrix(prevResult.rawText, prefDelim);
    return parseTabularRows(rows, prevResult.fileName, 'csv', {
      savedProfiles: options?.savedProfiles,
      accountId: options?.accountId,
      fallbackCurrency: options?.fallbackCurrency ?? prevResult.detectedCurrency,
      selectedProfileId,
      delimiter,
      rawText: prevResult.rawText,
    });
  }

  if (prevResult.rawRows) {
    return parseTabularRows(
      prevResult.rawRows,
      prevResult.fileName,
      prevResult.format === 'spreadsheet' ? 'spreadsheet' : 'csv',
      {
        savedProfiles: options?.savedProfiles,
        accountId: options?.accountId,
        fallbackCurrency: options?.fallbackCurrency ?? prevResult.detectedCurrency,
        selectedProfileId,
        delimiter: prevResult.delimiter,
        sheetName: prevResult.sheetName,
        rawText: prevResult.rawText,
      }
    );
  }

  return { ...prevResult, selectedProfileId };
}

// ================= CANONICAL KEYWORD CATEGORIZATION =================

interface KeywordRuleDef {
  categoryIds: string[];
  keywords: string[];
  direction?: 'income' | 'expense';
}

const KEYWORD_MAP: KeywordRuleDef[] = [
  // Income
  {
    direction: 'income',
    categoryIds: ['home-inc-wages', 'biz-inc-retainers'],
    keywords: ['salary', 'lohn', 'gehalt', 'payroll', 'salaire', 'wages', 'sala'],
  },
  {
    direction: 'income',
    categoryIds: ['home-inc-interest', 'home-inc-dividends'],
    keywords: ['dividend', 'zins', 'interest', 'zinsen', 'coupon'],
  },
  {
    direction: 'income',
    categoryIds: ['home-inc-refunds'],
    keywords: ['refund', 'rückerstattung', 'ruckerstattung', 'erstattung', 'reimbursement', 'remboursement'],
  },
  // Daily Living / Groceries & Dining
  {
    direction: 'expense',
    categoryIds: ['home-dl-groceries'],
    keywords: [
      'migros',
      'coop',
      'aldi',
      'lidl',
      'denner',
      'volg',
      'manor food',
      'alnatura',
      'spar ',
      'edeka',
      'rewe',
      'carrefour',
      'whole foods',
      'trader joe',
      'supermarkt',
      'supermarket',
      'grocery',
      'lebensmittel',
    ],
  },
  {
    direction: 'expense',
    categoryIds: ['home-dl-coffee', 'home-dl-dining', 'biz-mkt-meals'],
    keywords: ['starbucks', 'cafe', 'kaffee', 'bakery', 'backerei', 'bäckerei', 'restaurant', 'bistro', 'uber eats', 'just eat', 'deliveroo', 'mcdo', 'burger'],
  },
  // Transit & Fuel
  {
    direction: 'expense',
    categoryIds: ['home-tr-transit', 'biz-trv-rail'],
    keywords: ['sbb', 'cff', 'ffs', 'zvv', 'bvb', 'vbz', 'deutsche bahn', 'bahn', 'oebb', 'obb', 'uber', 'taxi', 'halbtax', 'ga ', 'train', 'metro', 'tram'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-tr-fuel'],
    keywords: ['shell', 'bp ', 'avia', 'agrola', 'tamoil', 'esso', 'tankstelle', 'benzin', 'fuel', 'gas station'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-tr-parking'],
    keywords: ['parking', 'parkhaus', 'easypark', 'seety', 'toll', 'maut'],
  },
  // Housing & Utilities
  {
    direction: 'expense',
    categoryIds: ['home-exp-rent', 'biz-off-cowork'],
    keywords: ['miete', 'mietwohnung', 'rent', 'immobilien', 'verwaltung', 'hypothek', 'mortgage', 'loyer', 'cowork'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-exp-elec'],
    keywords: ['ewz', 'ekz', 'bkw', 'romande energie', 'strom', 'electricity', 'elektrizitat', 'elektrizität'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-exp-internet', 'home-exp-phone', 'biz-off-internet'],
    keywords: ['swisscom', 'sunrise', 'salt mobile', 'galaxus mobile', 'wingo', 'telekom', 'vodafone', 'o2 ', 'internet', 'mobilfunk'],
  },
  // Health & Insurance
  {
    direction: 'expense',
    categoryIds: ['home-hlth-ins'],
    keywords: ['css', 'helsana', 'swica', 'assura', 'concordia', 'sanitas', 'atupri', 'visana', 'krankenkasse', 'health insurance'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-hlth-doc', 'home-hlth-meds'],
    keywords: ['apotheke', 'pharmacy', 'amavita', 'sun store', 'coop vitality', 'doctor', 'arzt', 'zahnarzt', 'dentist', 'spital', 'clinic'],
  },
  // Tech, Cloud, AI & Subscriptions
  {
    direction: 'expense',
    categoryIds: ['biz-sw-ai', 'home-sub-ai'],
    keywords: ['openai', 'chatgpt', 'anthropic', 'claude', 'cursor', 'copilot', 'perplexity', 'midjourney'],
  },
  {
    direction: 'expense',
    categoryIds: ['biz-sw-cloud', 'home-sub-icloud'],
    keywords: ['aws', 'amazon web', 'cloudflare', 'hetzner', 'digitalocean', 'vercel', 'netlify', 'linode', 'github', 'google cloud', 'namecheap', 'gandi', 'hostpoint', 'infomaniak'],
  },
  {
    direction: 'expense',
    categoryIds: ['biz-sw-design'],
    keywords: ['adobe', 'figma', 'jetbrains', 'sketch', 'canva', 'notion', 'linear'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-sub-spotify', 'home-sub-netflix', 'home-sub-youtube', 'home-sub-apple', 'home-sub-amazon'],
    keywords: ['spotify', 'netflix', 'disney', 'youtube', 'apple.com/bill', 'itunes', 'amazon prime'],
  },
  // Travel
  {
    direction: 'expense',
    categoryIds: ['home-ent-vacation', 'biz-trv-flights'],
    keywords: ['swiss intl', 'lufthansa', 'easyjet', 'ryanair', 'klm', 'air france', 'booking.com', 'airbnb', 'hotel'],
  },
  // Bank Fees & ATM & Tax
  {
    direction: 'expense',
    categoryIds: ['home-misc-bank', 'biz-prof-bank', 'biz-prof-fx'],
    keywords: ['bank fee', 'kontoführung', 'kontofuhrung', 'gebühr', 'gebuhren', 'fee', 'frais', 'stripe', 'paypal fee'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-misc-atm'],
    keywords: ['atm', 'bancomat', 'bargeldbezug', 'cash withdrawal', 'bezug'],
  },
  {
    direction: 'expense',
    categoryIds: ['home-obl-fedtax', 'home-obl-statetax', 'biz-tax-income', 'biz-tax-vat'],
    keywords: ['steueramt', 'estv', 'finanzamt', 'tax office', 'bundessteuer', 'staatssteuer', 'ahv', 'ausgleichskasse'],
  },
];

function matchesImportRule(
  rule: ImportRule,
  raw: RawBankTransaction,
  direction: 'income' | 'expense',
  accountId: string | undefined
): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== accountId) return false;
  if (rule.direction && rule.direction !== 'any' && rule.direction !== direction) return false;

  const absAmt = Math.abs(raw.signedAmount);
  if (rule.minAmount !== undefined && absAmt < rule.minAmount) return false;
  if (rule.maxAmount !== undefined && absAmt > rule.maxAmount) return false;

  const pat = rule.pattern.trim();
  if (!pat) return false;

  let haystack = '';
  switch (rule.matchField) {
    case 'payee':
      haystack = raw.rawPayee || raw.rawDescription;
      break;
    case 'description':
      haystack = raw.rawDescription;
      break;
    case 'iban':
      haystack = raw.counterpartyIban ?? '';
      break;
    case 'any':
    default:
      haystack = `${raw.rawPayee} ${raw.rawDescription} ${raw.counterpartyIban ?? ''}`.trim();
      break;
  }

  const hayLower = haystack.toLowerCase();
  const patLower = pat.toLowerCase();

  switch (rule.matchType) {
    case 'exact':
      return hayLower.trim() === patLower;
    case 'starts_with':
      return hayLower.trim().startsWith(patLower);
    case 'regex':
      try {
        return new RegExp(pat, 'i').test(haystack);
      } catch {
        return false;
      }
    case 'contains':
    default:
      return hayLower.includes(patLower) || normalizeMerchantText(haystack).includes(normalizeMerchantText(pat));
  }
}

function isoDateToEpochDays(dateStr: string): number {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

// ================= STAGING (DEDUP + TRANSFERS + 4-TIER CATEGORIZATION) =================

export interface StageTransactionsParams {
  rawTransactions: RawBankTransaction[];
  state: LedgerState;
  targetMode: LedgerMode;
  accountId?: string;
  paymentMethodLabel?: string;
  rulesOverride?: ImportRule[];
}

export function stageBankTransactions(
  params: StageTransactionsParams
): StagedBankTransaction[] {
  const {
    rawTransactions,
    state,
    targetMode,
    accountId,
    paymentMethodLabel,
    rulesOverride,
  } = params;

  const existingTxs = state.transactions ?? [];
  const categories = state.categories ?? [];
  const catMap = new Map<string, CategoryItem>(categories.map((c) => [c.id, c]));
  const accMap = new Map<string, FinancialAccount>(
    (state.accounts ?? []).map((a) => [a.id, a])
  );
  const selectedAcc = accountId ? accMap.get(accountId) : undefined;
  const effectivePaymentMethod =
    paymentMethodLabel || selectedAcc?.name || 'Bank Import';

  // Existing dedup indexes (map key -> existing transaction id so exact pairs don't also trigger false fuzzy dups)
  const existingExternalIdToTxId = new Map<string, string>();
  const existingFingerprintToTxId = new Map<string, string>();
  for (const tx of existingTxs) {
    if (tx.externalId && !existingExternalIdToTxId.has(`${tx.accountId ?? ''}|${tx.externalId}`)) {
      existingExternalIdToTxId.set(`${tx.accountId ?? ''}|${tx.externalId}`, tx.id);
    }
    if (tx.importFingerprint && !existingFingerprintToTxId.has(tx.importFingerprint)) {
      existingFingerprintToTxId.set(tx.importFingerprint, tx.id);
    }
  }

  // Learned payee history map: key = `${normMerchant}|${type}|${mode}` -> Map<categoryId, count>
  const payeeHistory = new Map<string, Map<string, number>>();
  for (const tx of existingTxs) {
    if (!catMap.has(tx.categoryId)) continue;
    const norm = normalizeMerchantText(tx.rawDescription || tx.description);
    if (!norm || norm.length < 3) continue;
    const histKey = `${norm}|${tx.type}|${tx.mode}`;
    let counts = payeeHistory.get(histKey);
    if (!counts) {
      counts = new Map();
      payeeHistory.set(histKey, counts);
    }
    counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1);
  }

  const orderedRules = [...(rulesOverride ?? state.importRules ?? [])].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.id.localeCompare(b.id)
  );

  // Precompute cross-account transfer candidates against existing ledger entries
  const ownIbans = new Set(
    (state.accounts ?? [])
      .map((a) => (a.accountNumberMasked ?? '').replace(/\s+/g, '').toLowerCase())
      .filter((s) => s.length >= 6)
  );

  // Pass 1: compute per-file occurrence index & fingerprint, and claim 1-to-1 exact duplicate pairs
  const dayOccurrenceCounter = new Map<string, number>();
  const precomputed = rawTransactions.map((raw) => {
    const baseDirection: 'income' | 'expense' =
      raw.signedAmount >= 0 ? 'income' : 'expense';
    const normKey =
      normalizeMerchantText(raw.rawPayee || raw.rawDescription) ||
      normalizeMerchantText(raw.rawDescription) ||
      'tx';
    const cents = Math.round(raw.signedAmount * 100);
    const occBucketKey = `${accountId ?? ''}|${raw.date}|${cents}|${normKey}`;
    const occIndex = dayOccurrenceCounter.get(occBucketKey) ?? 0;
    dayOccurrenceCounter.set(occBucketKey, occIndex + 1);

    const fingerprint = computeImportFingerprint(
      accountId,
      raw.date,
      raw.signedAmount,
      normKey,
      occIndex
    );

    let exactDupLabel: string | undefined;
    let pairedTxId: string | undefined;
    if (raw.externalId) {
      const hitId = existingExternalIdToTxId.get(`${accountId ?? ''}|${raw.externalId}`);
      if (hitId) {
        pairedTxId = hitId;
        exactDupLabel = `Ref ${raw.externalId}`;
      }
    }
    if (!pairedTxId) {
      const hitId = existingFingerprintToTxId.get(fingerprint);
      if (hitId) {
        pairedTxId = hitId;
        exactDupLabel = `${raw.date} · ${Math.abs(raw.signedAmount).toFixed(2)}`;
      }
    }

    return { raw, baseDirection, normKey, fingerprint, exactDupLabel, pairedTxId };
  });

  const pairedExistingTxIds = new Set<string>();
  for (const item of precomputed) {
    if (item.pairedTxId) pairedExistingTxIds.add(item.pairedTxId);
  }

  const staged: StagedBankTransaction[] = [];

  for (let i = 0; i < precomputed.length; i++) {
    const { raw, baseDirection, normKey, fingerprint, exactDupLabel } = precomputed[i];

    // 1. Deduplication check
    let duplicateStatus: DuplicateStatus = 'none';
    let duplicateOfLabel: string | undefined;

    if (exactDupLabel) {
      duplicateStatus = 'exact_duplicate';
      duplicateOfLabel = exactDupLabel;
    } else {
      const targetDays = isoDateToEpochDays(raw.date);
      const fuzzy = existingTxs.find((tx) => {
        if (pairedExistingTxIds.has(tx.id)) return false;
        if (accountId && tx.accountId && tx.accountId !== accountId) return false;
        if (tx.type !== baseDirection) return false;
        if (Math.abs(tx.amount - Math.abs(raw.signedAmount)) > 0.009) return false;
        return Math.abs(isoDateToEpochDays(tx.date) - targetDays) <= 2;
      });
      if (fuzzy) {
        duplicateStatus = 'possible_duplicate';
        duplicateOfLabel = `${fuzzy.date} · ${fuzzy.description}`;
      }
    }

    // 2. Cross-account internal transfer detection
    const targetDays = isoDateToEpochDays(raw.date);
    const oppositeType = baseDirection === 'income' ? 'expense' : 'income';
    const transferPeer = existingTxs.find((tx) => {
      if (accountId && tx.accountId === accountId) return false;
      if (!accountId && !tx.accountId) return false;
      if (tx.type !== oppositeType) return false;
      if (Math.abs(tx.amount - Math.abs(raw.signedAmount)) > 0.009) return false;
      return Math.abs(isoDateToEpochDays(tx.date) - targetDays) <= 3;
    });

    const normCpIban = (raw.counterpartyIban ?? '').replace(/\s+/g, '').toLowerCase();
    const isOwnIban = Boolean(normCpIban && ownIbans.has(normCpIban));
    const hasTransferKeyword = /\b(internal transfer|eigenübertrag|eigenubertrag|umbuchung|kontoübertrag|virement interne|transfer from savings|transfer to savings)\b/i.test(
      `${raw.rawPayee} ${raw.rawDescription}`
    );

    let isTransferCandidate = Boolean(transferPeer || isOwnIban || hasTransferKeyword);
    let transferHint: string | undefined;
    if (transferPeer) {
      const peerAccName = transferPeer.accountId
        ? accMap.get(transferPeer.accountId)?.name
        : undefined;
      transferHint = `Matches ${peerAccName ?? 'another account'} on ${transferPeer.date}`;
    } else if (isOwnIban || hasTransferKeyword) {
      transferHint = 'Internal transfer keyword or own IBAN';
    }

    // 3. Layered categorization cascade
    let resolvedMode: LedgerMode = targetMode;
    let resolvedCategory: CategoryItem | undefined;
    let confidence: CategorizationConfidence = 'needs_review';
    let matchReason = 'Needs manual category review';
    let matchedRuleId: string | undefined;
    let cleanDescription = raw.rawPayee || raw.rawDescription;
    let client: string | undefined;
    let taxOverride: number | undefined;
    let dedOverride: number | undefined;

    // Tier 1: Explicit user ImportRules
    const hitRule = orderedRules.find((rule) =>
      matchesImportRule(rule, raw, baseDirection, accountId)
    );
    if (hitRule) {
      if (hitRule.setMode) resolvedMode = hitRule.setMode;
      const cat = catMap.get(hitRule.setCategoryId);
      if (cat) {
        resolvedCategory = cat;
        resolvedMode = cat.mode;
      }
      if (hitRule.setPayee) cleanDescription = hitRule.setPayee;
      if (hitRule.setClient) client = hitRule.setClient;
      if (hitRule.setTaxRate !== undefined) taxOverride = hitRule.setTaxRate;
      if (hitRule.setDeductiblePct !== undefined) dedOverride = hitRule.setDeductiblePct;
      if (hitRule.markAsTransfer) {
        isTransferCandidate = true;
        transferHint = transferHint ?? `Rule "${hitRule.name}"`;
      }
      confidence = 'rule';
      matchedRuleId = hitRule.id;
      matchReason = `Rule: ${hitRule.name || hitRule.pattern}`;
    }

    // Tier 2: Learned Payee History from existing transactions
    if (!resolvedCategory && normKey.length >= 3) {
      const histCounts = payeeHistory.get(`${normKey}|${baseDirection}|${resolvedMode}`);
      if (histCounts) {
        let total = 0;
        let topId = '';
        let topCount = 0;
        for (const [cid, cnt] of histCounts.entries()) {
          total += cnt;
          if (cnt > topCount) {
            topCount = cnt;
            topId = cid;
          }
        }
        if (topCount >= 2 && topCount / total >= 0.75) {
          const histCat = catMap.get(topId);
          if (histCat) {
            resolvedCategory = histCat;
            confidence = 'history';
            matchReason = `History (${topCount}/${total} past entries)`;
          }
        }
      }
    }

    // Tier 3: Category hint column -> ISO BkTxCd -> Canonical multilingual keywords
    if (!resolvedCategory && raw.categoryHint) {
      const hintLower = raw.categoryHint.toLowerCase();
      const byHint = categories.find(
        (c) =>
          c.mode === resolvedMode &&
          c.name.toLowerCase() === hintLower &&
          (baseDirection === 'income' ? c.kind === 'income' : c.kind !== 'income')
      );
      if (byHint) {
        resolvedCategory = byHint;
        confidence = 'keyword';
        matchReason = `Column category "${raw.categoryHint}"`;
      }
    }

    if (!resolvedCategory && raw.bankTxCode) {
      const code = raw.bankTxCode.toUpperCase();
      const codeTargetIds: string[] =
        code.includes('SALA') && baseDirection === 'income'
          ? ['home-inc-wages']
          : code.includes('INTR') && baseDirection === 'income'
            ? ['home-inc-interest']
            : code.includes('CHRG') && baseDirection === 'expense'
              ? [resolvedMode === 'freelancer' ? 'biz-prof-bank' : 'home-misc-bank']
              : code.includes('TAXS') && baseDirection === 'expense'
                ? [resolvedMode === 'freelancer' ? 'biz-tax-income' : 'home-obl-fedtax']
                : [];
      for (const cid of codeTargetIds) {
        const c = categories.find(
          (cat) => cat.id === cid && cat.mode === resolvedMode
        );
        if (c) {
          resolvedCategory = c;
          confidence = 'keyword';
          matchReason = `ISO Bank Code (${raw.bankTxCode})`;
          break;
        }
      }
    }

    if (!resolvedCategory) {
      const fullLower = ` ${raw.rawPayee} ${raw.rawDescription} `.toLowerCase();
      for (const kwDef of KEYWORD_MAP) {
        if (kwDef.direction && kwDef.direction !== baseDirection) continue;
        if (!kwDef.keywords.some((kw) => fullLower.includes(kw))) continue;
        for (const cid of kwDef.categoryIds) {
          const matchCat = categories.find(
            (c) =>
              c.id === cid &&
              c.mode === resolvedMode &&
              (baseDirection === 'income' ? c.kind === 'income' : c.kind !== 'income')
          );
          if (matchCat) {
            resolvedCategory = matchCat;
            confidence = 'keyword';
            matchReason = `Matched keyword`;
            break;
          }
        }
        if (resolvedCategory) break;
      }
    }

    const defaultTax =
      taxOverride ??
      resolvedCategory?.taxRate ??
      0;
    const defaultDed =
      dedOverride ??
      resolvedCategory?.deductiblePct ??
      (resolvedMode === 'freelancer' ? 100 : 0);

    staged.push({
      id: `staged-${i}-${fingerprint.slice(0, 8)}`,
      raw,
      included: duplicateStatus === 'none',
      date: raw.date,
      monthKey: raw.date.slice(0, 7),
      mode: resolvedMode,
      type: baseDirection,
      accountId,
      categoryId: resolvedCategory?.id ?? null,
      description: cleanDescription.slice(0, 200),
      rawDescription: raw.rawDescription,
      amount: Math.abs(raw.signedAmount),
      client,
      invoiceRef: raw.reference,
      taxRate: defaultTax,
      deductiblePct: defaultDed,
      paymentMethod: effectivePaymentMethod,
      externalId: raw.externalId,
      importFingerprint: fingerprint,
      confidence,
      matchReason,
      matchedRuleId,
      duplicateStatus,
      duplicateOfLabel,
      isTransferCandidate,
      transferHint,
      transferPeerId: transferPeer?.id,
    });
  }

  return staged;
}

// ================= COMMIT STAGED ROWS TO LEDGER =================

export function applyStagedTransactionsToLedger(params: {
  stagedRows: StagedBankTransaction[];
  currentState: LedgerState;
  savedProfile?: BankImportProfile;
  savedRules?: ImportRule[];
}): LedgerState {
  const { stagedRows, currentState, savedProfile, savedRules } = params;
  const nowMs = Date.now();
  const categories = currentState.categories ?? [];
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const newTransactions: TransactionItem[] = [];
  for (let i = 0; i < stagedRows.length; i++) {
    const row = stagedRows[i];
    if (!row.included) continue;
    const cat = row.categoryId ? catMap.get(row.categoryId) : undefined;
    const fallbackCat =
      cat ??
      categories.find(
        (c) =>
          c.mode === row.mode &&
          (row.type === 'income' ? c.kind === 'income' : c.kind !== 'income')
      ) ??
      categories.find((c) => c.mode === row.mode) ??
      categories[0];

    if (!fallbackCat) continue;

    newTransactions.push({
      id: `tx-bank-${nowMs}-${i}-${row.importFingerprint.slice(0, 6)}`,
      date: row.date,
      monthKey: row.monthKey,
      mode: fallbackCat.mode,
      type: row.type,
      categoryId: fallbackCat.id,
      accountId: row.accountId || undefined,
      description: row.description.trim() || row.rawDescription || 'Bank Transaction',
      amount: Math.abs(row.amount),
      client: row.client || undefined,
      invoiceRef: row.invoiceRef || undefined,
      taxRate: row.taxRate,
      deductiblePct: row.deductiblePct,
      paymentMethod: row.paymentMethod || 'Bank Import',
      status: 'cleared',
      externalId: row.externalId || undefined,
      importFingerprint: row.importFingerprint,
      rawDescription:
        row.rawDescription && row.rawDescription !== row.description
          ? row.rawDescription
          : undefined,
      transferPeerId: row.transferPeerId || undefined,
    });
  }

  let nextProfiles = [...(currentState.importProfiles ?? [])];
  if (savedProfile) {
    const idx = nextProfiles.findIndex((p) => p.id === savedProfile.id);
    if (idx >= 0) nextProfiles[idx] = savedProfile;
    else nextProfiles.push(savedProfile);
  }

  const nextRules = savedRules ?? currentState.importRules ?? [];

  return {
    ...currentState,
    settings: {
      ...currentState.settings,
      setupCompleted: true,
    },
    transactions: [...newTransactions, ...(currentState.transactions ?? [])],
    importProfiles: nextProfiles,
    importRules: nextRules,
  };
}
