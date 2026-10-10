/** 設定精靈與設定頁用到的外部連結 */

export const CF_SIGNUP = "https://dash.cloudflare.com/sign-up";

/** 預填好權限的 API token 建立頁（OAuth 登入不能用時的備案） */
export const CF_TOKEN_TEMPLATE =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=" +
  encodeURIComponent(
    JSON.stringify([
      { key: "account_settings", type: "read" },
      { key: "workers_scripts", type: "edit" },
      { key: "d1", type: "edit" },
    ]),
  ) +
  "&accountId=*&zoneId=all&name=Deskdo";

export const CLAUDE_CONNECTORS = "https://claude.ai/settings/connectors";
