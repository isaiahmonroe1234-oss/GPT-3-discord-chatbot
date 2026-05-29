'use strict';

const {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');

require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_KEY;
const BOT_CHANNEL = process.env.BOT_CHANNEL || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN');
if (!GEMINI_KEY) throw new Error('Missing GEMINI_KEY');

const genAI = new GoogleGenerativeAI(GEMINI_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

async function askGemini(prompt) {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: `
You are a helpful Discord AI bot.
Never output JSON.
Never output tool calls.
Never say dalle.text2im.
Never say action_input.
If the user asks for an image, say:
"I can't generate real images yet, but I can help write a good image prompt."
Keep replies short and friendly.
`,
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    const text = message.content.trim();

    const inBotChannel = BOT_CHANNEL && message.channel.id === BOT_CHANNEL;
    const mentioned = message.mentions.has(client.user);

    if (BOT_CHANNEL && !inBotChannel && !mentioned) return;

    if (text === '!ping') {
      return message.reply('🏓 Pong! Bot is working.');
    }

    if (text === '!help') {
      return message.reply(
        '**Commands:**\n`!ping`\n`!ask your question`\nMention me and ask something'
      );
    }

    if (text.startsWith('!ask')) {
      const question = text.replace('!ask', '').trim();

      if (!question) {
        return message.reply('Type a question after `!ask`.');
      }

      await message.channel.sendTyping();

      const answer = await askGemini(question);

      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('AI Answer')
        .setDescription(answer.slice(0, 4000));

      return message.reply({ embeds: [embed] });
    }

    if (mentioned) {
      const prompt = text
        .replace(`<@${client.user.id}>`, '')
        .replace(`<@!${client.user.id}>`, '')
        .trim();

      if (!prompt) return message.reply('Hi! Ask me something.');

      await message.channel.sendTyping();

      const answer = await askGemini(prompt);

      return message.reply(answer.slice(0, 1900));
    }
  } catch (err) {
    console.error(err);
    return message.reply(`❌ Error: ${err.message}`);
  }
});

client.login(BOT_TOKEN);
