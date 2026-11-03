declare module '*/state/loopState.js' {
  export const STATUS: {
    readonly IDLE: 'IDLE';
    readonly PR_CREATED: 'PR_CREATED';
    readonly REVIEW_REQUESTED: 'REVIEW_REQUESTED';
    readonly NEEDS_FIX: 'NEEDS_FIX';
    readonly RESOLVED_LGTM: 'RESOLVED_LGTM';
  };
  export const DEFAULT_STATE_FILE: string;
  export function resolveScriptCliPath(relativePathFromPlugin: string): string;
  export function createInitialState(): any;
  export class LoopStateMachine {
    filePath: string;
    constructor(stateFilePath?: string);
    getState(): any;
    saveState(state: any): any;
    setPrCreated(prNumber: number): any;
    setReviewRequested(options?: any): any;
    setActiveSubagents(active?: boolean): any;
    recordReview(agentType: string, result?: any): any;
    setReviewResult(result: { lgtm: boolean; issues?: any[] }): any;
    resolveIssues(resolvedCommit: string, resolvedIssueIds?: string | string[] | null): any;
    reset(options?: any): any;
    canStop(options?: any): { allowed: boolean; status: string; prNumber: number | null; reason: string };
  }
  export const defaultStateMachine: LoopStateMachine;
  export function getState(): any;
  export function saveState(state: any): any;
  export function setPrCreated(prNumber: number): any;
  export function setReviewRequested(options?: any): any;
  export function setActiveSubagents(active?: boolean): any;
  export function recordReview(agentType: string, result?: any): any;
  export function setReviewResult(result: { lgtm: boolean; issues?: any[] }): any;
  export function resolveIssues(resolvedCommit: string, resolvedIssueIds?: string | string[] | null): any;
  export function reset(options?: any): any;
  export function canStop(options?: any): { allowed: boolean; status: string; prNumber: number | null; reason: string };
}

declare module '*/skills/review-self-healing/scripts/parseReviewResult.js' {
  export interface ParseReviewResultOptions {
    updateState?: boolean;
    agentType?: string | null;
    stateUpdater?: (res: any) => any;
  }
  export function parseReviewResult(reviewText: string, options?: ParseReviewResultOptions): any;
}

declare module '*/skills/review-self-healing/scripts/postPrComment.js' {
  export function postPrComment(prNumber: number | string, commentBody: string, options?: any): any;
}

declare module '*/skills/review-self-healing/scripts/resolveReview.js' {
  export type NonEmptyString<T extends string = string> = T extends '' ? never : T;
  export interface ResolveReviewOptions<S extends string = string> {
    commitHash: string;
    summary: NonEmptyString<S>;
    details?: string;
    issueIds?: string | string[] | null;
    prNumber?: number | string | null;
    dryRun?: boolean;
    stateMachine?: any;
    postCommentFn?: any;
  }
  export function resolveReview<S extends string = string>(options: ResolveReviewOptions<S>): any;
}

declare module '*/hooks/stopHook.js' {
  export function detectSubagentContext(payload?: any): boolean;
  export function detectActiveSubagents(payload?: any, stateMachine?: any): boolean;
  export function handleStop(payload?: any, stateMachine?: any, options?: any): { decision: string; reason: string };
}

declare module '*/hooks/safetyGuard.js' {
  export function verifySingleCommandExecution(commandLine: string): { decision: string; reason?: string };
  export function handleSafetyGuard(payload?: any, options?: any): { decision: string; reason?: string; overwrite?: any };
}

declare module '*/hooks/branchDoRGate.js' {
  export const DEFAULT_SECTION_PATTERNS: Record<string, RegExp>;
  export const DEFAULT_EMPTY_FIELD_PATTERNS: readonly RegExp[];
  export const DEFAULT_PLACEHOLDER_PATTERNS: readonly RegExp[];
  export function escapePathForRegex(pathStr: string): string;
  export function verifyNoTemplatePlaceholders(content: string, fileName: string, targetIssueDir: string, issuesRelDir?: string): { decision: string; reason?: string };
  export function handleBranchDoRGate(payload?: any, options?: any): { decision: string; reason?: string };
}

declare module '*/hooks/prePrAuditGate.js' {
  export function handlePrePrAuditGate(payload?: any, options?: any): { decision: string; reason?: string };
}

declare module '*/hooks/postPrCreate.js' {
  export function handlePostPrCreate(payload?: any, stateMachine?: any): any;
}

declare module '*/hooks/prBodyAuditGate.js' {
  export function extractPrBodyFromCommand(commandLine: string, projectRoot?: string, fsModule?: any): any;
  export function extractPrBodySections(bodyText: string): { mainChanges: string; reviewHistory: string; nonReviewText: string; other?: string };
  export function findDisallowedTerms(text: string, terms?: string[]): string[];
  export function handlePrBodyAuditGate(payload?: any, options?: any): { decision: string; reason?: string; overwrite?: any };
}

declare module '*/hooks/prBodyStaleGuard.js' {
  export function getLatestCodeCommit(options?: any): { timestamp: number; hash: string } | null;
  export function getWalkthroughTimestamp(walkthroughPath: string, options?: any): number | null;
  export function getPrBodySyncStatus(prNumber: number, options?: any): any;
  export function verifyPrBodyNotStale(options?: any): { allowed: boolean; decision?: string; reason: string };
  export function handlePrBodyStaleStop(payload?: any, options?: any): { decision: string; reason: string };
}

declare module '*/hooks/hookUtils.js' {
  export function readStdinJson(timeoutMs?: number): Promise<any>;
  export function writeStdoutJson(data: any): void;
  export function findPluginRoot(startDir: string): string;
  export function findProjectRoot(startDir: string): string;
  export function findIssueDir(issuesDir: string, issueNum: number): string | null;
}

declare module '*/config/reviewLoopConfig.js' {
  export const DEFAULT_CONFIG: any;
  export const CONFIG_FILE_NAMES: readonly string[];
  export function resolveConfigPath(projectRoot: string): string | null;
  export function mergeConfig(parsed: any): any;
  export function loadConfig(projectRoot: string): any;
}

declare module '*/scripts/sync-pr-body.js' {
  export function sanitizeMainChanges(text: string, disallowedTerms?: string[]): string;
  export function parseWalkthrough(content: string, disallowedTerms?: string[]): any;
  export function getGitDiffStat(options?: any): string;
  export function getHeadCommitHash(options?: any): string;
  export function resolveWalkthroughPath(options?: any): string | null;
  export function generatePrBody(options?: any): any;
  export function syncPrBody(options?: any): any;
}
