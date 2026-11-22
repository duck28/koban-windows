import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { createInitialLedgerState } from '../src/data/templates';
import { mergeLedgers } from '../src/utils/ledgerMerge';
import {
  applyStagedTransactionsToLedger,
  computeImportFingerprint,
  extractRawTransactionsFromMatrix,
  normalizeMerchantText,
  parseBankDate,
  parseBankNumber,
  parseBankStatementBuffer,
  reparseBankStatementWithProfile,
  stageBankTransactions,
  suggestRulePattern,
} from '../src/utils/bankImport';
import { BankImportProfile, ImportRule } from '../src/types';

function utf8Buffer(text: string, withBom = false): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  if (!withBom) return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const out = new Uint8Array(3 + encoded.length);
  out[0] = 0xef;
  out[1] = 0xbb;
  out[2] = 0xbf;
  out.set(encoded, 3);
  return out.buffer;
}

// 1. Fingerprint vector & same-day uniqueness
const fp0 = computeImportFingerprint('acc-1', '2026-11-15', -48.9, 'migros zurich', 0);
const fp1 = computeImportFingerprint('acc-1', '2026-11-15', -48.9, 'migros zurich', 1);
assert.equal(fp0, '24badbda3dd689d2aec70e859ce55b4d', 'Cross-platform fingerprint vector must remain stable');
assert.notEqual(fp0, fp1, 'Same-day occurrenceIndex 0 and 1 must produce distinct fingerprints');
console.log(`FINGERPRINT_VECTOR_ACC1=${fp0}`);

assert.equal(normalizeMerchantText('TWINT Zahlung Migros Z\u00fcrich XXXX-1234 15.11.2026'), 'migros zurich');
assert.equal(suggestRulePattern('Migros Z\u00fcrich Bahnhof', ''), 'migros zurich');

// 2. Number & Date parsing (Swiss, German, accounting, Excel serial string)
assert.equal(parseBankNumber("1'234.50", 'auto'), 1234.5);
assert.equal(parseBankNumber('1.234,50', 'auto'), 1234.5);
assert.equal(parseBankNumber('(45.00)', 'auto'), -45);
assert.equal(parseBankNumber('42,80-', ','), -42.8);
assert.equal(parseBankDate('15.11.2026', 'DD.MM.YYYY'), '2026-11-15');
assert.equal(parseBankDate('45611', 'auto'), '2024-11-15');

// 3. ISO 20022 camt.053 XML parsing (single + batch TxDtls + entities + IBAN + BkTxCd)
const camtXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <Stmt>
      <Acct>
        <Id><IBAN>CH9300762011623852957</IBAN></Id>
        <Ccy>CHF</Ccy>
      </Acct>
      <Ntry>
        <Amt Ccy="CHF">5200.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-11-01</Dt></BookgDt>
        <AcctSvcrRef>CAMT-SALA-001</AcctSvcrRef>
        <BkTxCd><Domn><Fmly><SubFmlyCd>SALA</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls><TxDtls>
          <RltdPties><Dbtr><Nm>Helvetia Tech AG</Nm></Dbtr></RltdPties>
          <RmtInf><Ustrd>November Salary &amp; Bonus</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">150.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-11-05</Dt></BookgDt>
        <BkTxCd><Domn><Fmly><SubFmlyCd>PMNT</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Amt Ccy="CHF">100.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <Refs><AcctSvcrRef>CAMT-BATCH-1</AcctSvcrRef></Refs>
            <RltdPties>
              <Cdtr><Nm>O&apos;Connor Books &amp; Press</Nm></Cdtr>
              <CdtrAcct><Id><IBAN>CH1000230001234567890</IBAN></Id></CdtrAcct>
            </RltdPties>
            <RmtInf><Ustrd>Technical Reference</Ustrd></RmtInf>
          </TxDtls>
          <TxDtls>
            <Amt Ccy="CHF">50.00</Amt>
            <CdtDbtInd>DBIT</CdtDbtInd>
            <Refs><AcctSvcrRef>CAMT-BATCH-2</AcctSvcrRef></Refs>
            <RltdPties><Cdtr><Nm>SBB CFF FFS</Nm></Cdtr></RltdPties>
            <RmtInf><Ustrd>Train ticket</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const camtParsed = parseBankStatementBuffer(utf8Buffer(camtXml), 'statement.xml', {});
assert.equal(camtParsed.format, 'camt053');
assert.equal(camtParsed.detectedAccountIban, 'CH9300762011623852957');
assert.equal(camtParsed.detectedCurrency, 'CHF');
assert.equal(camtParsed.rawTransactions.length, 3);
assert.equal(camtParsed.rawTransactions[0].signedAmount, 5200);
assert.equal(camtParsed.rawTransactions[0].externalId, 'CAMT-SALA-001');
assert.equal(camtParsed.rawTransactions[0].bankTxCode, 'SALA');
assert.equal(camtParsed.rawTransactions[1].signedAmount, -100);
assert.equal(camtParsed.rawTransactions[1].rawPayee, "O'Connor Books & Press");
assert.equal(camtParsed.rawTransactions[1].counterpartyIban, 'CH1000230001234567890');
assert.equal(camtParsed.rawTransactions[2].signedAmount, -50);

// 4. OFX v1 SGML + OFX v2 XML parsing
const ofxSgml = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>CHF</CURDEF>
<BANKACCTFROM><ACCTID>CH93000011112222</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261110120000[+1:CET]
<TRNAMT>-64.50
<FITID>OFX-101
<NAME>Coop Pronto
<MEMO>Card purchase Zurich
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const ofx1Parsed = parseBankStatementBuffer(utf8Buffer(ofxSgml), 'bank.ofx', {});
assert.equal(ofx1Parsed.format, 'ofx');
assert.equal(ofx1Parsed.rawTransactions.length, 1);
assert.equal(ofx1Parsed.rawTransactions[0].date, '2026-11-10');
assert.equal(ofx1Parsed.rawTransactions[0].signedAmount, -64.5);
assert.equal(ofx1Parsed.rawTransactions[0].externalId, 'OFX-101');
assert.equal(ofx1Parsed.rawTransactions[0].rawPayee, 'Coop Pronto');

const ofxXml = `<?xml version="1.0" encoding="utf-8"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD</CURDEF>
<BANKTRANLIST>
  <STMTTRN>
    <TRNTYPE>PAYMENT</TRNTYPE>
    <DTPOSTED>20261112</DTPOSTED>
    <TRNAMT>300.00</TRNAMT>
    <FITID>OFX-V2-9</FITID>
    <NAME>Client Wire</NAME>
    <MEMO>Invoice 88</MEMO>
  </STMTTRN>
</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

const ofx2Parsed = parseBankStatementBuffer(utf8Buffer(ofxXml), 'card.qfx', {});
assert.equal(ofx2Parsed.format, 'ofx');
assert.equal(ofx2Parsed.detectedCurrency, 'USD');
assert.equal(ofx2Parsed.rawTransactions.length, 1);
assert.equal(ofx2Parsed.rawTransactions[0].signedAmount, 300);
assert.equal(ofx2Parsed.rawTransactions[0].externalId, 'OFX-V2-9');

// 5. Smart CSV (preamble + BOM + semicolon + UBS split Debit/Credit + DD.MM.YYYY + German comma/dot CSV + XLSX)
const ubsCsv = [
  'Account:;CH93 0023 0000 1234 5678 9',
  'Currency:;CHF',
  'Trade date;Description1;Description2;Debit;Credit;Valuta',
  '15.11.2026;Migros Zurich;POS Purchase;1\'234.50;;15.11.2026',
  '16.11.2026;Acme GmbH;Consulting;;2\'500.00;16.11.2026',
  '17.11.2026;Account Maintenance Fee;Quarterly;(45.00);;17.11.2026',
].join('\r\n');

const csvParsed = parseBankStatementBuffer(utf8Buffer(ubsCsv, true), 'ubs_export.csv', {});
assert.equal(csvParsed.format, 'csv');
assert.equal(csvParsed.delimiter, ';');
assert.equal(csvParsed.headerRowIndex, 2);
assert.equal(csvParsed.detectedAccountIban, 'CH9300230000123456789');
assert.equal(csvParsed.matchedProfile?.id, 'builtin-ubs-ch');
assert.equal(csvParsed.needsMappingReview, false);
assert.equal(csvParsed.rawTransactions.length, 3);
assert.equal(csvParsed.rawTransactions[0].date, '2026-11-15');
assert.equal(csvParsed.rawTransactions[0].signedAmount, -1234.5);
assert.equal(csvParsed.rawTransactions[0].rawDescription, 'Migros Zurich · POS Purchase');
assert.equal(csvParsed.rawTransactions[1].signedAmount, 2500);
assert.equal(csvParsed.rawTransactions[2].signedAmount, -45);

// Modern UBS German CSV without spaces in Beschreibung1/2/3
const ubsDeCsv = [
  'Kontonummer:;CH10 0023 0000 9999 8888 1',
  'Abschlussdatum;Valutadatum;Währung;Belastung;Gutschrift;Transaktions-Nr.;Beschreibung1;Beschreibung2;Beschreibung3',
  '22.11.2026;22.11.2026;CHF;18.90;;TX-991;Coop City;Zürich;Einkauf',
].join('\n');
const ubsDeParsed = parseBankStatementBuffer(utf8Buffer(ubsDeCsv), 'transactions_20261122185604.csv', {});
assert.equal(ubsDeParsed.matchedProfile?.id, 'builtin-ubs-ch');
assert.equal(ubsDeParsed.needsMappingReview, false);
assert.equal(ubsDeParsed.detectedAccountIban, 'CH1000230000999988881');
assert.equal(ubsDeParsed.rawTransactions[0].rawDescription, 'Coop City · Zürich · Einkauf');
assert.notEqual(ubsDeParsed.rawTransactions[0].rawDescription, 'Imported Bank Entry');

// Explicit bank preset selection + live reparse + custom force + mismatch warning
const yuhCsv = 'DATE;ACTIVITY TYPE;ACTIVITY NAME;DEBIT;CREDIT;PAYMENT CURRENCY\n2026-11-20;Card;SBB Mobile;24.50;;CHF\n';
const yuhExplicit = parseBankStatementBuffer(utf8Buffer(yuhCsv), 'yuh.csv', {
  selectedProfileId: 'builtin-yuh-ch',
});
assert.equal(yuhExplicit.matchedProfile?.id, 'builtin-yuh-ch');
assert.equal(yuhExplicit.needsMappingReview, false);
assert.equal(yuhExplicit.rawTransactions[0].signedAmount, -24.5);
assert.equal(yuhExplicit.rawTransactions[0].rawDescription, 'SBB Mobile · Card');

const reparsedCustom = reparseBankStatementWithProfile(yuhExplicit, 'custom', {});
assert.equal(reparsedCustom.selectedProfileId, 'custom');
assert.equal(reparsedCustom.needsMappingReview, true);

const unrelatedCsv = 'Tag;Code;Summe\n20.11.2026;A1;99.00\n';
const mismatched = parseBankStatementBuffer(utf8Buffer(unrelatedCsv), 'odd.csv', {
  selectedProfileId: 'builtin-ubs-ch',
});
assert.equal(mismatched.needsMappingReview, true);
assert.ok(mismatched.warnings.length > 0, 'Mismatched preset must warn about unmapped columns');

// German decimal format + invertSign credit card CSV
const ccCsv = 'Date;Merchant;Amount\n18.11.2026;Starbucks Berlin;1.234,50\n';
const ccParsed = parseBankStatementBuffer(utf8Buffer(ccCsv), 'card.csv', {});
assert.equal(ccParsed.rawTransactions[0].signedAmount, 1234.5);
assert.ok(ccParsed.activeMapping);
const invertedMapping: BankImportProfile = {
  ...ccParsed.activeMapping!,
  invertSign: true,
};
const inverted = extractRawTransactionsFromMatrix(
  ccParsed.rawRows!,
  ccParsed.headerRowIndex!,
  invertedMapping
);
assert.equal(inverted.rawTransactions[0].signedAmount, -1234.5);

// XLSX sheet with Excel serial date string
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['Date', 'Description', 'Amount'],
  [45611, 'Obscure Kiosk 99', -19.9],
]);
XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
const xlsxOut = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
const xlsxParsed = parseBankStatementBuffer(xlsxOut, 'statement.xlsx', {});
assert.equal(xlsxParsed.format, 'spreadsheet');
assert.equal(xlsxParsed.rawTransactions.length, 1);
assert.equal(xlsxParsed.rawTransactions[0].date, '2024-11-15');
assert.equal(xlsxParsed.rawTransactions[0].signedAmount, -19.9);

// 6. Staging: Dedup + Cross-account transfer + 4-tier categorization + apply + merge
const baseState = createInitialLedgerState('both', 'CHF', '', true);
const checkingAcc = baseState.accounts[0];
const savingsAcc = baseState.accounts[1] ?? {
  ...checkingAcc,
  id: 'acc-sav',
  name: 'Savings Account',
  type: 'savings' as const,
};
if (!baseState.accounts[1]) {
  baseState.accounts.push(savingsAcc);
}
const existingFpSameDay0 = computeImportFingerprint(
  checkingAcc.id,
  '2026-11-15',
  -5.5,
  'kiosk coffee',
  0
);

baseState.transactions = [
  // Existing tx matched by externalId
  {
    id: 'tx-ext-1',
    date: '2026-11-01',
    monthKey: '2026-11',
    mode: 'home',
    type: 'expense',
    categoryId: 'home-dl-groceries',
    accountId: checkingAcc.id,
    description: 'Already Imported Ref',
    amount: 33.3,
    status: 'cleared',
    externalId: 'EXT-DUP-1',
  },
  // Existing same-day occurrence 0
  {
    id: 'tx-fp-0',
    date: '2026-11-15',
    monthKey: '2026-11',
    mode: 'home',
    type: 'expense',
    categoryId: 'home-dl-dining',
    accountId: checkingAcc.id,
    description: 'Kiosk Coffee #1',
    amount: 5.5,
    status: 'cleared',
    importFingerprint: existingFpSameDay0,
  },
  // Existing tx for fuzzy +/- 2 day dup match
  {
    id: 'tx-fuzzy-1',
    date: '2026-11-12',
    monthKey: '2026-11',
    mode: 'home',
    type: 'expense',
    categoryId: 'home-dl-dining',
    accountId: checkingAcc.id,
    description: 'Bistro Old Entry',
    amount: 88.0,
    status: 'cleared',
  },
  // Opposite transfer leg on savings account (within 3 days)
  {
    id: 'tx-xfer-peer',
    date: '2026-11-14',
    monthKey: '2026-11',
    mode: 'home',
    type: 'income',
    categoryId: 'home-inc-savings-transfer',
    accountId: savingsAcc.id,
    description: 'Transfer in from checking',
    amount: 750.0,
    status: 'cleared',
  },
  // History training: 2 past entries for "Roastery XYZ" -> home-dl-dining (2/2 >= 75%)
  {
    id: 'tx-hist-1',
    date: '2026-10-05',
    monthKey: '2026-10',
    mode: 'home',
    type: 'expense',
    categoryId: 'home-dl-dining',
    accountId: checkingAcc.id,
    description: 'Roastery XYZ',
    amount: 12.0,
    status: 'cleared',
  },
  {
    id: 'tx-hist-2',
    date: '2026-10-19',
    monthKey: '2026-10',
    mode: 'home',
    type: 'expense',
    categoryId: 'home-dl-dining',
    accountId: checkingAcc.id,
    description: 'Roastery XYZ',
    amount: 14.0,
    status: 'cleared',
  },
  // Single history entry (<2) should NOT auto-categorize
  {
    id: 'tx-hist-once',
    date: '2026-10-20',
    monthKey: '2026-10',
    mode: 'home',
    type: 'expense',
    categoryId: 'home-dl-dining',
    accountId: checkingAcc.id,
    description: 'Single Time Shop',
    amount: 9.0,
    status: 'cleared',
  },
];

const ruleList: ImportRule[] = [
  {
    id: 'rule-migros-override',
    name: 'Migros Biz Override',
    enabled: true,
    priority: 1,
    matchField: 'any',
    matchType: 'contains',
    pattern: 'special studio',
    setCategoryId: 'biz-sw-design',
    setPayee: 'Special Studio Clean',
    setClient: 'Internal Studio',
    setTaxRate: 8.1,
    setDeductiblePct: 80,
    createdAt: '2026-11-01',
    updatedAt: '2026-11-01',
  },
];

const staged = stageBankTransactions({
  rawTransactions: [
    // 0: externalId exact dup
    { rowIndex: 1, date: '2026-11-01', signedAmount: -33.3, externalId: 'EXT-DUP-1', rawPayee: 'Migros', rawDescription: 'Migros' },
    // 1: same-day occurrence 0 -> exact dup
    { rowIndex: 2, date: '2026-11-15', signedAmount: -5.5, rawPayee: 'Kiosk Coffee', rawDescription: 'Kiosk Coffee' },
    // 2: same-day occurrence 1 -> unique!
    { rowIndex: 3, date: '2026-11-15', signedAmount: -5.5, rawPayee: 'Kiosk Coffee', rawDescription: 'Kiosk Coffee' },
    // 3: fuzzy +/-2 day dup (Nov 13 vs Nov 12, 88.00)
    { rowIndex: 4, date: '2026-11-13', signedAmount: -88.0, rawPayee: 'Bistro', rawDescription: 'Bistro Zurich' },
    // 4: transfer peer detection (Nov 14 -750 vs savings +750)
    { rowIndex: 5, date: '2026-11-14', signedAmount: -750.0, rawPayee: 'Savings Sweep', rawDescription: 'Savings Sweep' },
    // 5: Tier 1 explicit rule
    { rowIndex: 6, date: '2026-11-16', signedAmount: -120.0, rawPayee: 'SPECIAL STUDIO PRO', rawDescription: 'SPECIAL STUDIO PRO #42' },
    // 6: Tier 2 learned payee history (2/2)
    { rowIndex: 7, date: '2026-11-17', signedAmount: -15.0, rawPayee: 'Roastery XYZ', rawDescription: 'Roastery XYZ Zurich' },
    // 7: Tier 3 ISO BkTxCd SALA
    { rowIndex: 8, date: '2026-11-18', signedAmount: 5200.0, rawPayee: 'Employer AG', rawDescription: 'Salary', bankTxCode: 'SALA' },
    // 8: Tier 3 keyword (Migros -> groceries)
    { rowIndex: 9, date: '2026-11-19', signedAmount: -48.9, rawPayee: 'Migros Zurich', rawDescription: 'TWINT Migros Zurich' },
    // 9: Tier 4 needs_review (<2 history)
    { rowIndex: 10, date: '2026-11-20', signedAmount: -9.0, rawPayee: 'Single Time Shop', rawDescription: 'Single Time Shop' },
    // 10: Tier 3 categoryHint column match
    { rowIndex: 11, date: '2026-11-21', signedAmount: -22.0, rawPayee: 'Corner Store', rawDescription: 'Corner Store', categoryHint: 'Groceries' },
  ],
  state: baseState,
  targetMode: 'home',
  accountId: checkingAcc.id,
  rulesOverride: ruleList,
});

assert.equal(staged[0].duplicateStatus, 'exact_duplicate');
assert.equal(staged[0].included, false);
assert.equal(staged[1].duplicateStatus, 'exact_duplicate');
assert.equal(staged[1].included, false);
assert.equal(staged[2].duplicateStatus, 'none');
assert.equal(staged[2].included, true);
assert.equal(staged[3].duplicateStatus, 'possible_duplicate');
assert.equal(staged[3].included, false);
assert.equal(staged[4].isTransferCandidate, true);
assert.equal(staged[4].transferPeerId, 'tx-xfer-peer');

assert.equal(staged[5].confidence, 'rule');
assert.equal(staged[5].categoryId, 'biz-sw-design');
assert.equal(staged[5].mode, 'freelancer');
assert.equal(staged[5].description, 'Special Studio Clean');
assert.equal(staged[5].client, 'Internal Studio');
assert.equal(staged[5].taxRate, 8.1);
assert.equal(staged[5].deductiblePct, 80);

assert.equal(staged[6].confidence, 'history');
assert.equal(staged[6].categoryId, 'home-dl-dining');

assert.equal(staged[7].confidence, 'keyword');
assert.equal(staged[7].categoryId, 'home-inc-wages');

assert.equal(staged[8].confidence, 'keyword');
assert.equal(staged[8].categoryId, 'home-dl-groceries');

assert.equal(staged[9].confidence, 'needs_review');
assert.equal(staged[9].categoryId, null);

assert.equal(staged[10].confidence, 'keyword');
assert.equal(staged[10].categoryId, 'home-dl-groceries');

// Commit staged transactions & verify persistence + rawDescription preservation
const customProfile: BankImportProfile = {
  ...ccParsed.activeMapping!,
  id: 'prof-custom-1',
  name: 'German Card CSV',
  updatedAt: '2026-11-20',
};
const committed = applyStagedTransactionsToLedger({
  stagedRows: staged,
  currentState: baseState,
  savedProfile: customProfile,
  savedRules: ruleList,
});
// 3 rows were duplicates (indices 0, 1, 3) -> 8 included out of 11 staged
assert.equal(committed.transactions.length, baseState.transactions.length + 8);
const insertedRuleTx = committed.transactions.find((t) => t.description === 'Special Studio Clean');
assert.ok(insertedRuleTx);
assert.equal(insertedRuleTx!.rawDescription, 'SPECIAL STUDIO PRO #42');
assert.equal(committed.importProfiles?.length, 1);
assert.equal(committed.importRules?.length, 1);

// 7. Merge Parity: importProfiles + importRules merge cleanly by id & updatedAt
const remoteState = createInitialLedgerState('both', 'CHF', '', true);
remoteState.importProfiles = [
  { ...customProfile, name: 'Remote Updated Card CSV', updatedAt: '2026-11-22' },
];
remoteState.importRules = [
  { ...ruleList[0], priority: 5 },
  {
    id: 'rule-remote-2',
    name: 'Remote Priority 1',
    enabled: true,
    priority: 1,
    matchField: 'any',
    matchType: 'contains',
    pattern: 'sbb',
    setCategoryId: 'home-tr-transit',
    createdAt: '2026-11-21',
    updatedAt: '2026-11-21',
  },
];
const localMergeState = {
  ...committed,
  importRules: [{ ...ruleList[0], priority: 5, updatedAt: '2026-11-21' }],
};
const mergeRes = mergeLedgers(localMergeState, remoteState, { prefer: 'local' });
assert.equal(mergeRes.merged.importProfiles?.length, 1);
assert.equal(mergeRes.merged.importProfiles?.[0].name, 'Remote Updated Card CSV');
assert.equal(mergeRes.merged.importRules?.length, 2);
assert.equal(mergeRes.merged.importRules?.[0].id, 'rule-remote-2');
assert.ok(mergeRes.summary.rulesMerged >= 2);

console.log('ALL BANK IMPORT TS ASSERTIONS PASSED');
