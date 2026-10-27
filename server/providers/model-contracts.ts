import type { InvoiceState } from '../../src/tabletop/shared/contracts.js';

/**
 * The invoice provider contract the Node runtime shares with its DeepSeek
 * adapter. F078-T10 removed the parallel `ModelGateway`/`SqlModelJobStore`
 * lifecycle that used to live beside these two types; the contract stays because
 * `server/providers/deepseek.ts` and the Worker's invoice path still use it.
 */
export interface ModelInput {
  prompt: string;
  sourceId: string;
  excerpt: string;
  rules: InvoiceState['rules'];
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  propose(input: ModelInput, signal: AbortSignal): Promise<unknown>;
}
