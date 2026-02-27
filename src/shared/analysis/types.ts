export type Severity = 'info' | 'warning' | 'error';

export type HeuristicId =
  | 'CHAIN_LENGTH'
  | 'LOOP'
  | 'PING_PONG'
  | 'REDIRECT_TYPES'
  | 'FINAL_OUTCOME'
  | 'AUTH_BOUNCE'
  | 'LOCALE_CONSENT'
  | 'TRACKING_NOISE'
  | 'CDN';

export interface AnalysisIssue {
  id: HeuristicId;
  severity: Severity;
  title: string;
  detail: string;
  hops?: number[];
}

export interface HopAnnotation {
  index: number;
  tags: string[];
}

export interface AnalysisResult {
  summary: string;
  issues: AnalysisIssue[];
  tags: string[];
  hopAnnotations: HopAnnotation[];
}
