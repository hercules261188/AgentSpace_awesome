import {
  createExternalIntegrationSync,
  listExternalIntegrationsSync,
  readExternalIntegrationByAgentSync,
  readExternalIntegrationSync,
  updateExternalIntegrationCredentialsSync,
  updateExternalIntegrationHealthSync,
  updateExternalIntegrationStatusSync,
  type ExternalIntegrationRecord,
  type ExternalIntegrationTransportMode,
} from "@agent-space/db";
import { FEISHU_DEFAULT_SCOPES, FEISHU_EVENT_CALLBACK_PATH, FEISHU_PROVIDER_ID } from "./constants.ts";
import type { FeishuApiClient } from "./client.ts";
import {
  buildEncryptedFeishuCredentials,
  readFeishuIntegrationCredentials,
} from "./credentials.ts";
import {
  buildFeishuHealthSnapshotConfigJson,
  checkFeishuIntegrationHealth,
  type FeishuHealthCheckResult,
} from "./health.ts";
import type {
  FeishuBotAddedAutoProvisionMode,
  FeishuChannelReviewStatus,
  FeishuFirstMessageAutoProvisionMode,
} from "./channel-auto-provisioning.ts";
import type {
  FeishuGuestPermissionProfile,
  FeishuUnboundUserMode,
} from "./external-guests.ts";

export interface FeishuAgentBotBinding extends ExternalIntegrationRecord {
  provider: typeof FEISHU_PROVIDER_ID;
  agentId: string;
  appId: string;
}

export interface CreateFeishuAgentBotBindingInput {
  workspaceId: string;
  agentId: string;
  displayName?: string;
  appId: string;
  appSecret: string;
  transportMode?: ExternalIntegrationTransportMode;
  tenantKey?: string;
  verificationToken?: string;
  encryptKey?: string;
  createdByUserId?: string;
  channelAutoProvisioning?: FeishuAgentBotChannelAutoProvisioningInput;
  externalGuestPolicy?: FeishuAgentBotExternalGuestPolicyInput;
}

export interface FeishuAgentBotChannelAutoProvisioningInput {
  botAdded?: FeishuBotAddedAutoProvisionMode;
  firstMessage?: FeishuFirstMessageAutoProvisionMode;
  reviewStatus?: FeishuChannelReviewStatus;
}

export interface FeishuAgentBotExternalGuestPolicyInput {
  unboundUserMode?: FeishuUnboundUserMode;
  guestPermissionProfile?: FeishuGuestPermissionProfile;
  requireIdentityFor?: string[];
}

export interface RotateFeishuAgentBotCredentialsInput {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  appId?: string;
  appSecret: string;
  tenantKey?: string;
  verificationToken?: string;
  encryptKey?: string;
  updatedByUserId?: string;
}

export interface DisableFeishuAgentBotBindingInput {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  updatedByUserId?: string;
}

export interface FeishuAgentBotHealthCheckResult {
  binding: FeishuAgentBotBinding;
  health: FeishuHealthCheckResult;
}

export function createFeishuAgentBotBindingSync(
  input: CreateFeishuAgentBotBindingInput,
): FeishuAgentBotBinding {
  const workspaceId = requireText(input.workspaceId, "feishu.agent_bot_binding.missing_workspace_id");
  const agentId = requireText(input.agentId, "feishu.agent_bot_binding.missing_agent_id");
  const appId = requireText(input.appId, "feishu.agent_bot_binding.missing_app_id");
  const appSecret = requireText(input.appSecret, "feishu.agent_bot_binding.missing_app_secret");
  const transportMode = input.transportMode ?? "websocket_worker";
  const tenantKey = optionalText(input.tenantKey);
  const verificationToken = optionalText(input.verificationToken);
  const encryptKey = optionalText(input.encryptKey);

  validateTransportMode(transportMode);
  assertNoPlaceholder(agentId, "agentId");
  assertNoPlaceholder(appId, "appId");
  assertNoPlaceholder(appSecret, "appSecret");
  assertNoPlaceholder(tenantKey, "tenantKey");
  assertNoPlaceholder(verificationToken, "verificationToken");
  assertNoPlaceholder(encryptKey, "encryptKey");
  if (transportMode === "http_webhook" && !verificationToken) {
    throw new Error("feishu.agent_bot_binding.missing_verification_token");
  }

  try {
    const integration = createExternalIntegrationSync({
      workspaceId,
      provider: FEISHU_PROVIDER_ID,
      displayName: optionalText(input.displayName) ?? `${agentId} Feishu Bot`,
      transportMode,
      agentId,
      appId,
      tenantKey,
      encryptedCredentialsJson: buildEncryptedFeishuCredentials({
        appSecret,
        verificationToken,
        encryptKey,
      }),
      configJson: buildFeishuAgentBotConfig(input),
      capabilitiesJson: {
        messageTransport: true,
        docsDataPlane: true,
        sheetsDataPlane: true,
        baseDataPlane: true,
      },
      scopesJson: [...FEISHU_DEFAULT_SCOPES],
      createdByUserId: optionalText(input.createdByUserId),
    });
    return requireFeishuAgentBotBinding(integration);
  } catch (error) {
    throw normalizeFeishuAgentBotBindingError(error);
  }
}

function buildFeishuAgentBotConfig(input: CreateFeishuAgentBotBindingInput): Record<string, unknown> {
  return {
    eventCallbackPath: FEISHU_EVENT_CALLBACK_PATH,
    agentBotBinding: true,
    dataPlane: {
      docs: true,
      sheets: true,
      base: true,
    },
    ...buildFeishuAgentBotChannelAutoProvisioningConfig(input.channelAutoProvisioning),
    ...buildFeishuAgentBotExternalGuestPolicyConfig(input.externalGuestPolicy),
  };
}

function buildFeishuAgentBotChannelAutoProvisioningConfig(
  policy: FeishuAgentBotChannelAutoProvisioningInput | undefined,
): Record<string, unknown> {
  if (!policy) {
    return {};
  }
  return {
    channelAutoProvisioning: {
      botAdded: normalizeOptionalPolicyValue(
        policy.botAdded,
        ["auto_create_channel", "pending_admin_review", "disabled"],
        "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy",
      ),
      firstMessage: normalizeOptionalPolicyValue(
        policy.firstMessage,
        ["auto_create_if_bot_mentioned", "pending_admin_review", "reply_with_setup_card", "disabled"],
        "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy",
      ),
      reviewStatus: normalizeOptionalPolicyValue(
        policy.reviewStatus,
        ["approved", "pending_admin_review", "needs_identity_binding"],
        "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy",
      ),
    },
  };
}

function buildFeishuAgentBotExternalGuestPolicyConfig(
  policy: FeishuAgentBotExternalGuestPolicyInput | undefined,
): Record<string, unknown> {
  if (!policy) {
    return {};
  }
  return {
    externalGuestPolicy: {
      unboundUserMode: normalizeOptionalPolicyValue(
        policy.unboundUserMode,
        ["ignore", "reply_on_mention", "reply_all", "require_identity"],
        "feishu.agent_bot_binding.invalid_external_guest_policy",
      ),
      guestPermissionProfile: normalizeOptionalPolicyValue(
        policy.guestPermissionProfile,
        ["none", "channel_context_only", "channel_readonly"],
        "feishu.agent_bot_binding.invalid_external_guest_policy",
      ),
      requireIdentityFor: normalizePolicyStringArray(policy.requireIdentityFor),
    },
  };
}

function normalizeOptionalPolicyValue<T extends string>(
  value: T | undefined,
  allowedValues: readonly T[],
  errorCode: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (allowedValues.includes(value)) {
    return value;
  }
  throw new Error(errorCode);
}

function normalizePolicyStringArray(value: string[] | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function listFeishuAgentBotBindingsSync(input: {
  workspaceId: string;
  agentId?: string;
  includeDisabled?: boolean;
}): FeishuAgentBotBinding[] {
  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    scope: "agent",
    agentId: optionalText(input.agentId),
    includeDisabled: input.includeDisabled,
  }).filter(isFeishuAgentBotBinding);
}

export function readFeishuAgentBotBindingByAgentSync(input: {
  workspaceId: string;
  agentId: string;
  includeDisabled?: boolean;
}): FeishuAgentBotBinding | null {
  const record = readExternalIntegrationByAgentSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    agentId: input.agentId,
    includeDisabled: input.includeDisabled,
  });
  return isFeishuAgentBotBinding(record) ? record : null;
}

export function rotateFeishuAgentBotCredentialsSync(
  input: RotateFeishuAgentBotCredentialsInput,
): FeishuAgentBotBinding {
  const binding = resolveFeishuAgentBotBindingSync(input);
  const currentCredentials = readFeishuIntegrationCredentials(binding);
  const appId = optionalText(input.appId) ?? binding.appId;
  const appSecret = requireText(input.appSecret, "feishu.agent_bot_binding.missing_app_secret");
  const tenantKey = input.tenantKey === undefined ? binding.tenantKey : optionalText(input.tenantKey);
  const verificationToken = input.verificationToken === undefined
    ? optionalText(currentCredentials.verificationToken)
    : optionalText(input.verificationToken);
  const encryptKey = input.encryptKey === undefined
    ? optionalText(currentCredentials.encryptKey)
    : optionalText(input.encryptKey);

  assertNoPlaceholder(appId, "appId");
  assertNoPlaceholder(appSecret, "appSecret");
  assertNoPlaceholder(tenantKey, "tenantKey");
  assertNoPlaceholder(verificationToken, "verificationToken");
  assertNoPlaceholder(encryptKey, "encryptKey");
  if (binding.transportMode === "http_webhook" && !verificationToken) {
    throw new Error("feishu.agent_bot_binding.missing_verification_token");
  }

  try {
    const updated = updateExternalIntegrationCredentialsSync({
      workspaceId: input.workspaceId,
      integrationId: binding.id,
      appId,
      tenantKey,
      encryptedCredentialsJson: buildEncryptedFeishuCredentials({
        appSecret,
        verificationToken,
        encryptKey,
      }),
      updatedByUserId: optionalText(input.updatedByUserId),
    });
    return requireFeishuAgentBotBinding(updated);
  } catch (error) {
    throw normalizeFeishuAgentBotBindingError(error);
  }
}

export function disableFeishuAgentBotBindingSync(
  input: DisableFeishuAgentBotBindingInput,
): FeishuAgentBotBinding {
  const binding = resolveFeishuAgentBotBindingSync(input);
  const updated = updateExternalIntegrationStatusSync({
    workspaceId: input.workspaceId,
    integrationId: binding.id,
    status: "disabled",
    updatedByUserId: optionalText(input.updatedByUserId),
  });
  return requireFeishuAgentBotBinding(updated);
}

export async function checkFeishuAgentBotHealth(input: {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  clientFactory?: (tenantAccessToken: string) => FeishuApiClient;
  persist?: boolean;
}): Promise<FeishuAgentBotHealthCheckResult> {
  const binding = resolveFeishuAgentBotBindingSync(input);
  const credentials = readFeishuIntegrationCredentials(binding);
  if (!credentials.appSecret) {
    throw new Error("feishu.agent_bot_binding.missing_app_secret");
  }
  const health = await checkFeishuIntegrationHealth({
    appId: binding.appId,
    appSecret: credentials.appSecret,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    clientFactory: input.clientFactory,
  });
  const updated = input.persist === false
    ? binding
    : requireFeishuAgentBotBinding(updateExternalIntegrationHealthSync({
      workspaceId: input.workspaceId,
      integrationId: binding.id,
      lastHealthStatus: health.status,
      lastError: health.errorMessage,
      configJson: buildFeishuHealthSnapshotConfigJson({
        configJson: binding.configJson,
        health,
      }),
    }));
  return {
    binding: updated,
    health,
  };
}

export function resolveFeishuAgentBotBindingSync(input: {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  includeDisabled?: boolean;
}): FeishuAgentBotBinding {
  const workspaceId = requireText(input.workspaceId, "feishu.agent_bot_binding.missing_workspace_id");
  const integrationId = optionalText(input.integrationId);
  const agentId = optionalText(input.agentId);
  const record = integrationId
    ? readExternalIntegrationSync({ workspaceId, integrationId })
    : agentId
      ? readExternalIntegrationByAgentSync({
        workspaceId,
        provider: FEISHU_PROVIDER_ID,
        agentId,
        includeDisabled: input.includeDisabled,
      })
      : null;

  if (!record) {
    throw new Error("feishu.agent_bot_binding.not_found");
  }
  if (record.status === "disabled" && !input.includeDisabled) {
    throw new Error("feishu.agent_bot_binding.not_found");
  }
  return requireFeishuAgentBotBinding(record);
}

export function isFeishuAgentBotBinding(
  record: ExternalIntegrationRecord | null | undefined,
): record is FeishuAgentBotBinding {
  return Boolean(
    record
      && record.provider === FEISHU_PROVIDER_ID
      && optionalText(record.agentId)
      && optionalText(record.appId),
  );
}

function requireFeishuAgentBotBinding(record: ExternalIntegrationRecord | null | undefined): FeishuAgentBotBinding {
  if (!isFeishuAgentBotBinding(record)) {
    throw new Error("feishu.agent_bot_binding.not_found");
  }
  return record;
}

function validateTransportMode(value: ExternalIntegrationTransportMode): void {
  if (value !== "http_webhook" && value !== "websocket_worker") {
    throw new Error("feishu.agent_bot_binding.invalid_transport_mode");
  }
}

function normalizeFeishuAgentBotBindingError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/app and tenant are already connected/.test(message)) {
    return new Error("feishu.agent_bot_binding.duplicate_app_tenant");
  }
  if (/agent is already connected/.test(message)) {
    return new Error("feishu.agent_bot_binding.duplicate_agent");
  }
  if (/FEISHU_CREDENTIAL_ENCRYPTION_KEY is required/.test(message)) {
    return new Error("feishu.agent_bot_binding.credential_encryption_key_missing");
  }
  if (/FEISHU_CREDENTIAL_ENCRYPTION_KEY must be/.test(message)) {
    return new Error("feishu.agent_bot_binding.credential_encryption_key_invalid");
  }
  return error instanceof Error ? error : new Error(message);
}

function requireText(value: string | undefined, errorCode: string): string {
  const normalized = optionalText(value);
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertNoPlaceholder(value: string | undefined, fieldName: string): void {
  if (!value) {
    return;
  }
  const normalized = value.trim();
  const tokenized = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (
    /^change_me/i.test(normalized)
    || /^your[_\s-]/i.test(normalized)
    || /^<.+>$/.test(normalized)
    || /^\{.+\}$/.test(normalized)
    || tokenized === "xxx"
    || tokenized === "todo"
    || tokenized === "placeholder"
    || /(^|_)(todo|placeholder)($|_)/.test(tokenized)
  ) {
    throw new Error(`feishu.agent_bot_binding.placeholder_value:${fieldName}`);
  }
}
