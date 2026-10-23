/** Host-recorded input provenance. Actor ids resolve through the authorized room membership. */
export interface TableInputWrite {
  actorId: string;
  at: number;
  origin: 'human' | 'ai';
}
export interface TableDataProvenance {
  /** Who added each source file to this table, not a claim about the file's original author. */
  sources: Record<string, TableInputWrite>;
  /** Most recent write to each collection, not a claim that this actor authored every row. */
  collections: Record<string, TableInputWrite>;
}
