export type DemoDomain = 'invoice' | 'teaching' | 'encounter';

export interface DemoCheckpoint {
  ruleRevision?: number;
  dataRevision?: number;
  phase?: string;
  totals?: { expectedSatang?: number; deltaSatang?: number; unknownCount?: number };
  physics?: { force?: number; mass?: number; time?: number; acceleration?: number; velocity?: number; position?: number };
  characters?: { name: string; hp: number; ap: number }[];
  privateFieldsHidden?: boolean;
}

export interface PublicDemoStep {
  id: string;
  title: string;
  actor: string;
  description: string;
  outcome: 'recorded' | 'expected-rejection';
  checkpoint?: DemoCheckpoint;
}

export interface PublicDemoScenario {
  id: string;
  title: string;
  domain: DemoDomain;
  persona: { name: string; role: string; goal: string };
  prompt: string;
  outcome: string;
  steps: PublicDemoStep[];
}

export interface PublicDemoCatalog {
  schemaVersion: 1;
  recordedAt: string;
  scenarios: PublicDemoScenario[];
}
