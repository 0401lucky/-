export interface OIDCConfig {
  enabled: boolean;
  displayName: string;
  issuerUrl: string;
  discoveryUrl: string;
  clientId: string;
  redirectUrl: string;
  scopes: string;
  tokenAuthMethod: 'client_secret_post' | 'client_secret_basic';
  newApiProvider: 'oidc' | 'custom';
  newApiProviderId: number;
  subjectClaim: string;
  usernameClaim: string;
  clientSecretConfigured: boolean;
  updatedAt?: number;
  updatedBy?: string;
}

export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';

export const OIDC_ERROR_MESSAGES: Record<string, string> = {
  disabled: '统一登录已停用，请使用账号密码登录。',
  unavailable: '统一登录服务暂时不可用，请稍后重试。',
  provider_error: '无法连接身份服务，请稍后重试或联系管理员。',
  invalid_state: '登录验证已过期或不属于当前浏览器，请重新发起统一登录。',
  config_changed: '统一登录配置已更新，请重新发起登录。',
  verification_failed: '身份验证失败，请重新登录身份服务；若仍失败，请联系管理员检查配置。',
  cancelled: '已取消身份服务授权，可以重新登录。',
  account_disabled: '对应的 new-api 账号已被禁用或删除，请联系管理员。',
  account_ambiguous: '当前身份绑定了多个账号，请联系管理员检查 new-api 的账号绑定。',
};
