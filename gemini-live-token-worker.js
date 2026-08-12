/**
 * Gemini Live API 用 ephemeral トークン発行 Worker
 * ------------------------------------------------------------
 * ブラウザ(index.html)に本物のGEMINI_API_KEYを渡さず、
 * 短命な ephemeral token (auth_tokens/...) だけを発行して返す中継サーバーです。
 *
 * デプロイ手順:
 *   1. wrangler をインストール済みの状態で、このファイルと同じフォルダに
 *      wrangler.toml を用意する(下記コメント参照)
 *   2. シークレット登録:
 *        wrangler secret put GEMINI_API_KEY
 *      (プロンプトが出たら Google AI Studio で取得したAPIキーを貼り付け)
 *   3. 必要なら環境変数(wrangler.toml の [vars])で以下を設定:
 *        ALLOWED_ORIGIN   例: "https://yourname.github.io"
 *        LIVE_MODEL       例: "gemini-3.1-flash-live-preview" (省略時デフォルト)
 *        LIVE_VOICE       例: "Puck" (省略時は指定なし = デフォルト音声)
 *   4. デプロイ:
 *        wrangler deploy
 *   5. 発行されたURL(例: https://xxxx.workers.dev)を
 *      index.html の「🎙️ 会話」パネルの Worker URL 欄に入力
 *
 * --- wrangler.toml の例 ---
 * name = "gemini-live-token-worker"
 * main = "gemini-live-token-worker.js"
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
 *  - このトークンは liveConnectConstraints で model / responseModalities を
 *    サーバー側で固定しています。これにより、万一トークンが漏れても
 *    別モデルへの切り替えや設定改変(コード実行ツールの有効化など)を
 *    防げます。systemInstruction はロックしていないため、ブラウザ側の
 *    「指示(任意)」欄からその場でキャラクター設定を渡せます。
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

    if (!env.GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY is not configured on this Worker.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const model = env.LIVE_MODEL || 'gemini-3.1-flash-live-preview';
    const voice = env.LIVE_VOICE || '';

    try {
      const now = Date.now();
      const liveConfig = {
        responseModalities: ['AUDIO'],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      };
      if (voice) {
        liveConfig.speechConfig = {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        };
      }

      const tokenReq = {
        uses: 1,
        // トークン自体の有効期限(この時間内に新規セッションを開始し、接続を維持できる)
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        // 「セッション開始」に使える猶予(発行後すぐに接続しない場合はここを延ばす)
        newSessionExpireTime: new Date(now + 5 * 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: `models/${model}`,
          config: liveConfig,
        },
      };

      const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
        method: 'POST',
        headers: {
          'x-goog-api-key': env.GEMINI_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tokenReq),
      });

      const bodyText = await resp.text();

      if (!resp.ok) {
        return new Response(bodyText, {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // フロント側で扱いやすいよう { name, model } の形に整えて返す
      let data;
      try { data = JSON.parse(bodyText); } catch (e) { data = {}; }

      return new Response(
        JSON.stringify({ name: data.name, model, expireTime: data.expireTime }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
