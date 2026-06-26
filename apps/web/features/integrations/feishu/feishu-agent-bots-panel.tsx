"use client";

import { type TransitionStartFunction, useMemo, useState } from "react";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import {
  createFeishuAgentBotBindingAction,
  disableFeishuAgentBotBindingAction,
  rotateFeishuAgentBotCredentialsAction,
} from "./feishu-actions";
import type {
  FeishuAvailableAgentItem,
  FeishuIntegrationSettingsItem,
} from "./feishu-types";

export function FeishuAgentBotsPanel({
  availableAgents,
  integrations,
  isPending,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  availableAgents: FeishuAvailableAgentItem[];
  integrations: FeishuIntegrationSettingsItem[];
  isPending: boolean;
  onUpdated: (integration: FeishuIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const agentBots = integrations.filter((integration) => Boolean(integration.agentId));
  const boundAgentIds = new Set(agentBots.filter((integration) => integration.status !== "disabled").map((integration) => integration.agentId));
  const firstUnboundAgent = availableAgents.find((agent) => !boundAgentIds.has(agent.id)) ?? availableAgents[0];
  const [agentId, setAgentId] = useState(firstUnboundAgent?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [transportMode, setTransportMode] = useState<"websocket_worker" | "http_webhook">("websocket_worker");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [encryptKey, setEncryptKey] = useState("");
  const [tenantKey, setTenantKey] = useState("");
  const [botAddedPolicy, setBotAddedPolicy] = useState<"auto_create_channel" | "pending_admin_review" | "disabled">("auto_create_channel");
  const [firstMessagePolicy, setFirstMessagePolicy] = useState<"auto_create_if_bot_mentioned" | "pending_admin_review" | "reply_with_setup_card" | "disabled">("auto_create_if_bot_mentioned");
  const [reviewStatusPolicy, setReviewStatusPolicy] = useState<"approved" | "pending_admin_review" | "needs_identity_binding">("approved");
  const [unboundUserMode, setUnboundUserMode] = useState<"ignore" | "reply_on_mention" | "reply_all" | "require_identity">("reply_on_mention");
  const [guestPermissionProfile, setGuestPermissionProfile] = useState<"none" | "channel_context_only" | "channel_readonly">("channel_context_only");
  const [rotationSecrets, setRotationSecrets] = useState<Record<string, string>>({});
  const requiresVerificationToken = transportMode === "http_webhook";
  const canCreate = Boolean(agentId.trim() && appId.trim() && appSecret.trim() && (!requiresVerificationToken || verificationToken.trim()));
  const agentOptions = useMemo(() => availableAgents.map((agent) => ({
    ...agent,
    label: agent.remarkName ? `${agent.name} · ${agent.remarkName}` : agent.name,
  })), [availableAgents]);

  return (
    <section
      aria-label={tx("Agent 飞书 Bot", "Agent Feishu Bots")}
      className="page-panel"
      id="feishu-agent-bots"
    >
      <div className="panel-header">
        <div>
          <h3>{tx("Agent 飞书 Bot", "Agent Feishu Bots")}</h3>
          <p className="settings-panel-note">
            {tx("每个 Agent 绑定一个飞书 Bot；用户在飞书群里直接 @对应 Bot。", "Bind one Feishu bot per agent so people can mention that bot directly in Feishu chats.")}
          </p>
        </div>
      </div>

      <div className="feishu-integration-form feishu-agent-bot-form">
        {agentOptions.length > 0 ? (
          <label className="form-field">
            <span>{tx("Agent", "Agent")}</span>
            <select
              disabled={isPending}
              onChange={(event) => setAgentId(event.currentTarget.value)}
              value={agentId}
            >
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="form-field">
            <span>{tx("Agent", "Agent")}</span>
            <input
              disabled={isPending}
              onChange={(event) => setAgentId(event.currentTarget.value)}
              value={agentId}
            />
          </label>
        )}

        <label className="form-field">
          <span>{tx("App ID", "App ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setAppId(event.currentTarget.value)}
            value={appId}
          />
        </label>

        <label className="form-field">
          <span>{tx("App Secret", "App Secret")}</span>
          <input
            autoComplete="new-password"
            disabled={isPending}
            onChange={(event) => setAppSecret(event.currentTarget.value)}
            type="password"
            value={appSecret}
          />
        </label>

        <details className="feishu-advanced-settings">
          <summary>
            <span>{tx("自定义高级功能", "Customize Advanced Options")}</span>
            <small>{tx("事件回调、Tenant Key、自动建群和未绑定用户策略", "Event callback, Tenant Key, auto-provisioning, and unbound user policy")}</small>
          </summary>

          <div className="feishu-advanced-settings__body">
            <label className="form-field">
              <span>{tx("名称", "Name")}</span>
              <input
                disabled={isPending}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                value={displayName}
              />
            </label>

            <label className="form-field">
              <span>{tx("连接方式", "Transport")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setTransportMode(event.currentTarget.value as "websocket_worker" | "http_webhook")}
                value={transportMode}
              >
                <option value="websocket_worker">{tx("长连接", "WebSocket worker")}</option>
                <option value="http_webhook">{tx("事件回调", "Event callback")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("Tenant Key", "Tenant Key")}</span>
              <input
                autoComplete="off"
                disabled={isPending}
                onChange={(event) => setTenantKey(event.currentTarget.value)}
                value={tenantKey}
              />
            </label>

            <label className="form-field">
              <span>
                {requiresVerificationToken
                  ? tx("Verification Token（事件回调必填）", "Verification Token (required for callbacks)")
                  : tx("Verification Token", "Verification Token")}
              </span>
              <input
                autoComplete="new-password"
                disabled={isPending}
                onChange={(event) => setVerificationToken(event.currentTarget.value)}
                type="password"
                value={verificationToken}
              />
            </label>

            <label className="form-field">
              <span>{tx("Encrypt Key", "Encrypt Key")}</span>
              <input
                autoComplete="new-password"
                disabled={isPending}
                onChange={(event) => setEncryptKey(event.currentTarget.value)}
                type="password"
                value={encryptKey}
              />
            </label>

            <label className="form-field">
              <span>{tx("机器人进群", "Bot Added")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setBotAddedPolicy(event.currentTarget.value as "auto_create_channel" | "pending_admin_review" | "disabled")}
                value={botAddedPolicy}
              >
                <option value="auto_create_channel">{tx("自动创建 Channel", "Auto-create channel")}</option>
                <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
                <option value="disabled">{tx("关闭", "Disabled")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("首次消息", "First Message")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setFirstMessagePolicy(event.currentTarget.value as "auto_create_if_bot_mentioned" | "pending_admin_review" | "reply_with_setup_card" | "disabled")}
                value={firstMessagePolicy}
              >
                <option value="auto_create_if_bot_mentioned">{tx("@Bot 时自动创建", "Auto-create when mentioned")}</option>
                <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
                <option value="reply_with_setup_card">{tx("回复设置卡片", "Reply with setup card")}</option>
                <option value="disabled">{tx("关闭", "Disabled")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("建群审核状态", "Provision Review")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setReviewStatusPolicy(event.currentTarget.value as "approved" | "pending_admin_review" | "needs_identity_binding")}
                value={reviewStatusPolicy}
              >
                <option value="approved">{tx("通过", "Approved")}</option>
                <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
                <option value="needs_identity_binding">{tx("需要身份绑定", "Needs identity binding")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("未绑定用户", "Unbound Users")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setUnboundUserMode(event.currentTarget.value as "ignore" | "reply_on_mention" | "reply_all" | "require_identity")}
                value={unboundUserMode}
              >
                <option value="reply_on_mention">{tx("@Bot 时回复", "Reply when mentioned")}</option>
                <option value="reply_all">{tx("全部回复", "Reply all")}</option>
                <option value="require_identity">{tx("要求绑定身份", "Require identity")}</option>
                <option value="ignore">{tx("忽略", "Ignore")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("访客权限", "Guest Permission")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setGuestPermissionProfile(event.currentTarget.value as "none" | "channel_context_only" | "channel_readonly")}
                value={guestPermissionProfile}
              >
                <option value="channel_context_only">{tx("当前 Channel 上下文", "Current channel context")}</option>
                <option value="channel_readonly">{tx("当前 Channel 只读", "Current channel readonly")}</option>
                <option value="none">{tx("无", "None")}</option>
              </select>
            </label>
          </div>
        </details>

        <div className="feishu-integration-form__actions">
          <button
            className="primary-button"
            disabled={isPending || !canCreate}
            onClick={() => {
              startTransition(async () => {
                try {
                  const created = await createFeishuAgentBotBindingAction({
                    agentId,
                    displayName,
                    transportMode,
                    appId,
                    appSecret,
                    verificationToken,
                    encryptKey,
                    tenantKey,
                    channelAutoProvisioning: {
                      botAdded: botAddedPolicy,
                      firstMessage: firstMessagePolicy,
                      reviewStatus: reviewStatusPolicy,
                    },
                    externalGuestPolicy: {
                      unboundUserMode,
                      guestPermissionProfile,
                      requireIdentityFor: [
                        "writes",
                        "approvals",
                        "private_resources",
                        "runtime_sensitive_tools",
                      ],
                    },
                  });
                  setAppSecret("");
                  setVerificationToken("");
                  setEncryptKey("");
                  setFeedback(tx("Agent 飞书 Bot 已绑定。", "Agent Feishu bot bound."));
                  onUpdated(created);
                } catch (error) {
                  setFeedback(translateSettingsActionError(error, tx));
                }
              });
            }}
            type="button"
          >
            {tx("绑定 Bot", "Bind Bot")}
          </button>
        </div>
      </div>

      <div className="feishu-binding-list">
        {agentBots.length === 0 ? (
          <p className="settings-panel-note">{tx("暂无 Agent 飞书 Bot。", "No agent Feishu bots yet.")}</p>
        ) : agentBots.map((integration) => {
          const rotationSecret = rotationSecrets[integration.id] ?? "";
          return (
            <article className="feishu-binding-card" key={integration.id}>
              <div>
                <strong>{integration.displayName}</strong>
                <div className="feishu-binding-card__meta">
                  <span>{tx("Agent", "Agent")}: {integration.agentId}</span>
                  <span>{tx("连接方式", "Transport")}: {integration.transportMode}</span>
                  <span>{tx("状态", "Status")}: {integration.status}</span>
                  {integration.appId ? <span>App ID: {integration.appId}</span> : null}
                </div>
              </div>
              <div className="feishu-agent-bot-actions">
                <input
                  aria-label={tx("新的 App Secret", "New App Secret")}
                  autoComplete="new-password"
                  disabled={isPending || integration.status === "disabled"}
                  onChange={(event) => setRotationSecrets((current) => ({
                    ...current,
                    [integration.id]: event.currentTarget.value,
                  }))}
                  placeholder={tx("新的 App Secret", "New App Secret")}
                  type="password"
                  value={rotationSecret}
                />
                <button
                  className="action-button"
                  disabled={isPending || integration.status === "disabled" || !rotationSecret.trim()}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        const updated = await rotateFeishuAgentBotCredentialsAction({
                          integrationId: integration.id,
                          appSecret: rotationSecret,
                        });
                        setRotationSecrets((current) => ({
                          ...current,
                          [integration.id]: "",
                        }));
                        setFeedback(tx("Agent 飞书 Bot 密钥已轮换。", "Agent Feishu bot secret rotated."));
                        onUpdated(updated);
                      } catch (error) {
                        setFeedback(translateSettingsActionError(error, tx));
                      }
                    });
                  }}
                  type="button"
                >
                  {tx("轮换", "Rotate")}
                </button>
                <button
                  className="danger-button"
                  disabled={isPending || integration.status === "disabled"}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        const updated = await disableFeishuAgentBotBindingAction(integration.id);
                        setFeedback(tx("Agent 飞书 Bot 已停用。", "Agent Feishu bot disabled."));
                        onUpdated(updated);
                      } catch (error) {
                        setFeedback(translateSettingsActionError(error, tx));
                      }
                    });
                  }}
                  type="button"
                >
                  {tx("停用", "Disable")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
