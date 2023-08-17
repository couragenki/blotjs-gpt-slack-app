const fs = require("fs");
require("dotenv").config();
const { App } = require("@slack/bolt");
const { Configuration, OpenAIApi } = require("openai");

const readJsonFile = async (fileName) => {
  return new Promise((resolve, reject) => {
    fs.readFile(fileName, "utf8", (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(JSON.parse(data));
    });
  });
};

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

app.message("hello gpt", async ({ message, say }) => {
  await say(`Hey there <@${message.user}>!`);
});

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

  if (botId || !threadTs) {
    return;
  }

  const threadMessagesResponse = await client.conversations.replies({
    channel: event.channel,
    ts: threadTs,
  });

  const messages = threadMessagesResponse.messages?.sort(
    (a, b) => Number(a.ts) - Number(b.ts)
  );

  if (!messages[0].bot_id === "B05G3C4EQ4Q") {
    return;
  }

  try {
    const thinkingMessageResponse = await postAsGptBot({
      client,
      channel: event.channel,
      threadTs,
      text: "...",
    });

    const prevMessages =
      messages.length < 6 ? messages.slice(1, -1) : messages.slice(-6, -1);
    const prevMessageText =
      prevMessages.map((m) => `- ${m.text}`).join("\n") || "";

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
8. UQmobile
9. Ymobile
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
    const checkMobileType = await openAIClient.createCompletion({
      model: "text-davinci-003",
      prompt: mobileTypePrompt,
      max_tokens: 1000,
      top_p: 0.5,
      frequency_penalty: 1,
    });

    const mobileType = checkMobileType.data.choices[0].text;
    const carriers = [
      "docomo",
      "SoftBank",
      "au",
      "楽天モバイル",
      "ahamo",
      "povo",
      "LINEMO",
      "UQmobile",
      "Ymobile",
      "該当なし",
    ];
    const foundCarriers = carriers.filter((carrier) =>
      mobileType.includes(carrier)
    );

    let jsonData;
    for (const carrier of foundCarriers) {
      const fileName = `./resources/${carrier}.json`;
      try {
        jsonData = await readJsonFile(fileName);
      } catch (err) {
        console.error(`エラーが発生しました: ${err}`);
        return;
      }

      const prompt = `
あなたは優秀なスマートフォンキャリアのアドバイザーです。
（以下略）
## 最新の補足情報
${JSON.stringify(jsonData, null, 2)}

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
      await client.chat.delete({
        channel: event.channel,
        ts: thinkingMessageResponse.ts,
      });

      await postAsGptBot({
        client,
        channel: event.channel,
        threadTs,
        text: message,
      });
    }
  } catch (error) {
    logger.error(error);
  }
});

app.start().then(() => {
  console.log("App is running!");
});
