/**
 * OpenAI Realtime API 用 ephemeral トークン発行 Worker
 * ------------------------------------------------------------
 * ブラウザ(index.html)に本物のOPENAI_API_KEYを渡さず、
 * 短命な client_secret (ek_...) だけを発行して返す中継サーバーです。
 *
 * デプロイ手順:
 *   1. wrangler をインストール済みの状態で、このファイルと同じフォルダに
 *      wrangler.toml を用意する(下記コメント参照)
 *   2. シークレット登録:
 *        wrangler secret put OPENAI_API_KEY
 *      (プロンプトが出たら sk-... のAPIキーを貼り付け)
 *   3. 必要なら環境変数(wrangler.toml の [vars])で以下を設定:
 *        ALLOWED_ORIGIN   例: "https://yourname.github.io"
 *        REALTIME_MODEL   例: "gpt-realtime" (省略時デフォルト)
 *        REALTIME_VOICE   例: "marin" (省略時デフォルト)
 *   4. デプロイ:
 *        wrangler deploy
 *   5. 発行されたURL(例: https://xxxx.workers.dev)を
 *      index.html の「🎙️ 会話」パネルの Worker URL 欄に入力
 *
 * --- wrangler.toml の例 ---
 * name = "realtime-token-worker"
 * main = "realtime-token-worker.js"
 * compatibility_date = "2026-01-01"
 *
 * [vars]
 * ALLOWED_ORIGIN = "https://yourname.github.io"
 * ---------------------------
 *
 * セキュリティ上の注意:
 *  - ALLOWED_ORIGIN は "*" のままでも動作しますが、
 *    第三者があなたのAPI利用枠を消費できてしまうため、
 *    本番運用では自分のGitHub Pagesのオリジンに限定することを推奨します。
 *  - このWorker自体はレートリミットを行っていません。
 *    必要であればCloudflareのRate Limitingルールを別途設定してください。
 */

export default {
  async fetch(request, env) {
    const allowOrigin = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY is not configured on this Worker.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const sessionConfig = {
        session: {
          type: 'realtime',
          model: env.REALTIME_MODEL || 'gpt-realtime',
          audio: {
            output: { voice: env.REALTIME_VOICE || 'marin' },
          },
        },
      };

      const resp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionConfig),
      });

      const bodyText = await resp.text();

      if (!resp.ok) {
        return new Response(bodyText, {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(bodyText, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
