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

/** OpenAI 的開發者模式與 MCP 連接器說明（ChatGPT 的選單名稱常變動，以官方說明為準） */
export const CHATGPT_MCP_HELP = "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt";

/** 宣傳頁的使用說明，各家 AI 助理的設定方式都在這裡 */
export const SITE_GUIDE = "https://deskdo.adaizaiganma.qzz.io/guide";
