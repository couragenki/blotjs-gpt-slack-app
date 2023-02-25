const { App } = require("@slack/bolt");
const { Configuration, OpenAIApi } = require("openai");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

// Listens to incoming messages that contain "hello"
app.message("hello", async ({ message, say }) => {
  await say(`Hey there <@${message.user}>!`);
});

// ここからOPEN_AIーーーーーーーーーーーーーーーーーーーーーーーー

app.message("gpt召喚", async ({ message, say }) => {
  await say(`<@${message.user}> お呼びでしょうか？ こちらのスレッドで質問をしてください。`);
});

const postAsGptBot = async ({
  client,
  channel,
  threadTs,
  text,
}) => {
  return await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
  });
};

  app.event("message", async ({ event, client, logger }) => {
    console.log('イベント取得done')
    // console.log(event, "event");
    const { thread_ts: threadTs, bot_id: botId, text } = event;
    // botの返信またはスレッドのメッセージでなければ何もしない
    if (botId || !threadTs) {
      return;
    }

    // console.log(client, "client");

    // スレッドのメッセージを取得
    const threadMessagesResponse = await client.conversations.replies({
      channel: event.channel,
      ts: threadTs,
    });

    // console.log("メッセージの取得ができました", threadMessagesResponse);
    const messages = threadMessagesResponse.messages?.sort(
      (a, b) => Number(a.ts) - Number(b.ts)
    );

    // GPT Botへの返信でなければ何もしない
    console.log(messages[0], "messages[0]");
    if (!messages[0].bot_id === 'B04QU3HD1N1') {
      console.log('マッチ')
      return;
    }

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
      messages.length < 6
        ? messages.slice(1, -1)
        : messages.slice(-6, -1);
    const prevMessageText =
      prevMessages.map((m) => `- ${m.text}`).join("\n") || "";


      // 回答メッセージの作成 with OpenAI
      const prompt = `
あなたは優秀なSlackBotです。あなたの知識とこれまでの会話の内容を考慮した上で、今の質問に正確な回答をしてください。

### これまでの会話:
${prevMessageText}

### 今の質問:
${text}

### 今の質問の回答:
`;

      console.log(prompt, "prompt");

      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY,
      });
      const openAIClient = new OpenAIApi(configuration);
      const completions = await openAIClient.createCompletion({
        model: "text-davinci-003",
        prompt: prompt,
        max_tokens: 1000,
        top_p: 0.5,
        frequency_penalty: 1,
      });
      
      const message = completions.data.choices[0].text;

      console.log(message, "生成したmessage");

      // 仮のメッセージを削除する
      await client.chat.delete({
        channel: event.channel,
        ts: thinkingMessageResponse.ts,
      });

      // 回答メッセージを投稿する
      if (message) {
        console.log('実行まではできたよ')
        await postAsGptBot({
          client,
          channel: event.channel,
          threadTs,
          text: message,
        });
        // await say(message);
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
  console.log('起動完了')
})();
