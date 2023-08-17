require("dotenv").config();
const { App } = require("@slack/bolt");
const { Configuration, OpenAIApi } = require("openai");

console.log(process.env.SLACK_SIGNING_SECRET);

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

// Listens to incoming messages that contain "hello"
app.message("hello gpt", async ({ message, say }) => {
  console.log("hello gpt", message);
  await say(`Hey there <@${message.user}>!`);
});

// ここからOPEN_AIーーーーーーーーーーーーーーーーーーーーーーーー

app.message("gptに質問する", async ({ message, say }) => {
  await say(
    `<@${message.user}> お呼びでしょうか？ こちらのスレッドで質問をしてください。`
  );
});

const postAsGptBot = async ({ client, channel, threadTs, text }) => {
  return await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
  });
};

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openAIClient = new OpenAIApi(configuration);

app.event("message", async ({ event, client, logger }) => {
  const { thread_ts: threadTs, bot_id: botId, text } = event;

  console.log("イベント取得done", text, "text");

  // botの返信またはスレッドのメッセージでなければ何もしない
  if (botId || !threadTs) {
    return;
  }

  // スレッドのメッセージを取得
  const threadMessagesResponse = await client.conversations.replies({
    channel: event.channel,
    ts: threadTs,
  });

  // console.log("メッセージの取得ができました", threadMessagesResponse);
  const messages = threadMessagesResponse.messages?.sort(
    (a, b) => Number(a.ts) - Number(b.ts)
  );

  // // GPT Botへの返信でなければ何もしない
  // console.log(messages[0], "messages[0]");
  // if (!messages[0].bot_id === "B04QU3HD1N1") {
  //   console.log("マッチ");
  //   return;
  // }

  try {
    // Slackのレスポンス制約を回避するために、仮のメッセージを投稿する
    const thinkingMessageResponse = await postAsGptBot({
      client,
      channel: event.channel,
      threadTs,
      text: "...",
    });

    // 会話の履歴を取得して結合。最大6件まで
    const prevMessages =
      messages.length < 6 ? messages.slice(1, -1) : messages.slice(-6, -1);
    const prevMessageText =
      prevMessages.map((m) => `- ${m.text}`).join("\n") || "";

    console.log(prevMessageText, "prevMessageText");
    console.log(text, "text");

    const mobileTypePrompt = `
## 前提
あなたは優秀なスマートフォンキャリアのアドバイザーです。今回顧客から以下のような質問を受けました。そこであなたは以下のモバイルキャリアの情報とユーザーのメッセージをもとに、質問からどのスマホキャリアに関する内容を選別しなさい。
その際回答には以下で選定するモバイルキャリア候補の中から答えなさい。

## モバイルキャリア候補
以下の中からモバイルキャリアを選択しなさい。その際以下の10個の選択肢から選定しなさい。
もしも1~9の選択肢に該当するものがなければ『10. 該当なし』を選択しなさい。

1. docomo
2. SoftBank
3. au
4. 楽天モバイル
5. ahamo
6. povo
7. LINEMO
8. UQ mobile
9. Y!mobile
10. 該当なし

## 回答例
例えば以下のような質問があったとします。

サンプルの質問：『楽天モバイルの料金プランはどれがおすすめですか？』

上記のような質問場合は以下の回答を行いなさい。

正しい回答：楽天モバイル

回答の際は『カテゴリー: 楽天モバイル』など余計な文字列は付け加えてはいけない。
必ず『楽天モバイル』とカテゴリー名のみを返すこと。

## 今回カテゴライズする情報
さて本番です。今回の質問から上記の10つのカテゴリーのうち、どれに当てはまるかを選び、そのカテゴリーのみを出力しなさい。

### 今回の質問:
『${text}』
`;
    // ここで会話の内容からモバイルキャリアの情報抽出
    const checkMobileType = await openAIClient.createCompletion({
      model: "text-davinci-003",
      prompt: mobileTypePrompt,
      max_tokens: 1000,
      top_p: 0.5,
      frequency_penalty: 1,
    });

    // 抽出結果を入力する
    const mobileType = checkMobileType.data.choices[0].text;

    console.log(mobileType, "mobileType");

    // 回答メッセージの作成
    const prompt = `
あなたは優秀なスマートフォンキャリアのアドバイザーです。
あなたの知識とこれまでの会話の内容を考慮した上で、ユーザーにとってもっと適切なスマートフォンのキャリアに対する質問に答えなさい。

### これまでの会話:
${prevMessageText}

### 今の質問:
${text}

### 今の質問の回答:
`;

    const completions = await openAIClient.createCompletion({
      model: "text-davinci-003",
      prompt: prompt,
      max_tokens: 1000,
      top_p: 0.5,
      frequency_penalty: 1,
    });

    const message = completions.data.choices[0].text;

    // 仮のメッセージを削除する
    await client.chat.delete({
      channel: event.channel,
      ts: thinkingMessageResponse.ts,
    });

    // 回答メッセージを投稿する
    if (message) {
      console.log("実行まではできたよ");

      デバッグ用に投稿を一時コメントアウトで停止;
      await postAsGptBot({
        client,
        channel: event.channel,
        threadTs,
        text: message,
      });
      await say(message);
      console.log("発言DONE");
    } else {
      throw new Error("message is empty");
    }
  } catch (e) {
    logger.error(e);
    await postAsGptBot({
      client,
      channel: event.channel,
      threadTs,
      text: "大変申し訳ございません。エラーです。別スレッドでやり直してください。",
    });
  }
});

// ここまでOPEN_AIーーーーーーーーーーーーーーーーーーーーーーーー

// スタート
(async () => {
  await app.start();
  console.log("起動完了");
})();
