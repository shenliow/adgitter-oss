/**
 * i18n key maps for integration providers and token scopes. Kept separate
 * from `tokens.ts` so that module stays UI-agnostic. Using explicit literal
 * `MessageKey`s (not template strings) keeps `t()` type-safe and satisfies the
 * i18n lint's usage scan.
 */
import type { MessageKey } from "../i18n/messages";
import type { IntegrationProvider, TokenScope } from "./tokens";

export const PROVIDER_KEY: Record<IntegrationProvider, MessageKey> = {
  slack: "webhook.provider.slack",
  jira: "webhook.provider.jira",
  github: "webhook.provider.github",
  gitlab: "webhook.provider.gitlab",
};

export const SCOPE_KEY: Record<TokenScope, MessageKey> = {
  send_notification: "webhook.scope.send_notification",
  commit: "webhook.scope.commit",
  leave_comment: "webhook.scope.leave_comment",
  create_branch: "webhook.scope.create_branch",
  rename_branch: "webhook.scope.rename_branch",
  delete_branch: "webhook.scope.delete_branch",
};
