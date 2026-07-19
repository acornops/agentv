export interface RestartRequest {
  protocol_version: 1;
  action: 'restart_service';
  operation_id: string;
  unit: string;
  reason: string;
  expected_active_state: string;
  expected_sub_state: string;
  expected_invocation_id?: string;
}

export interface RestartReceipt {
  operation_id: string; unit: string; outcome: 'success' | 'failed' | 'not_started' | 'unknown';
  before: { active_state: string; sub_state: string; invocation_id: string | null };
  after: { active_state: string; sub_state: string; invocation_id: string | null } | null;
  started_at: string; completed_at: string | null; systemd_job_result: string | null;
}

export interface HelperCapabilities { protocol_version: 1; policy_valid: boolean; restart_services: string[]; }

export interface ActionClient {
  capabilities(signal?: AbortSignal): Promise<HelperCapabilities>;
  restart(request: RestartRequest, signal?: AbortSignal): Promise<RestartReceipt>;
}
