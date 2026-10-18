export type Category = 'Laptop' | 'Furniture' | 'Equipment' | 'Vehicle' | 'Unknown';
export type GovernedCategory = 'Furniture' | 'Equipment' | 'Vehicle';
export type DepreciationStart = 'in-service' | 'following-month';
export interface CategoryPolicyRule {
  threshold?: number;
  usefulLifeMonths?: number;
  start?: DepreciationStart;
}
export interface Asset {
  rowId: string; assetId: string; description: string; category: Category;
  acquisitionDate: string | null; inServiceDate: string | null; cost: number;
  usefulLifeMonths: number; method: 'straight-line'; accumulatedDepreciation: number;
  recordedMonthlyDepreciation: number; glAccount: string; department: string;
}
export interface LedgerEntry { id: string; assetId: string; period: string; account: string; amount: number }
export interface Dataset { id: string; name: string; period: string; assets: Asset[]; ledger: LedgerEntry[]; source: 'synthetic' | 'imported' }
export interface Policy {
  version: number; defaultThreshold: number;
  laptop: { threshold: number; usefulLifeMonths: number; start: DepreciationStart };
  categoryRules?: Partial<Record<GovernedCategory, CategoryPolicyRule>>;
  createdAt: string; source: string; parentVersion?: number;
}
export interface Finding { code: string; message: string; severity: 'warning' | 'error' }
export interface AssetResult { asset: Asset; calculated: number; recorded: number; ledgerAmount: number | null; difference: number; findings: Finding[]; status: 'matched' | 'review'; ruleVersion: number }
export interface Reconciliation {
  rows: AssetResult[];
  ledgerFindings: { entry: LedgerEntry; finding: Finding }[];
  summary: { totalAssets: number; calculated: number; recorded: number; ledger: number; difference: number; exceptions: number; matched: number };
  categories: { category: string; calculated: number; recorded: number; count: number }[];
}
export interface EvaluationCase { id: string; title: string; group: 'regression' | 'new'; expected: number | string | boolean; actual: number | string | boolean; passed: boolean }
export interface Impact { rowId: string; assetId: string; before: number; after: number; difference: number }
export interface Evaluation { cases: EvaluationCase[]; passed: number; failed: number; regressions: number; impacts: Impact[]; beforeExceptions: number; afterExceptions: number; ranAt: string }
export interface Equipment { id: string; name: string; category: string; owner: string; warrantyUntil: string; condition: 'working' | 'needs-repair' | 'in-repair'; location: string }
export interface EquipmentResult { equipment: Equipment; warrantyDays: number; priority: 'urgent' | 'soon' | 'healthy'; reason: string }
