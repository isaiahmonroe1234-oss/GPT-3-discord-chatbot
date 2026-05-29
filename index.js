'use strict';

const {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require('discord.js');

require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_KEY;
const BOT_CHANNEL = process.env.BOT_CHANNEL || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

if (!GEMINI_KEY) {
  console.error('Missing GEMINI_KEY in .env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const COLORS = {
  gold: '#FFD700',
  blue: '#54A0FF',
  red: '#FF4757',
  green: '#2ECC71',
  orange: '#FF6B35',
};

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  c.user.setActivity('chat messages', { type: ActivityType.Watching });
});

async function askGemini(prompt) {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction:
      'You are a helpful Discord chatbot. Keep replies clear, friendly, and not too long.',
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    const content = message.content.trim();

    const inBotChannel = BOT_CHANNEL && message.channel.id === BOT_CHANNEL;
    const mentioned = message.mentions.has(client.user);

    if (BOT_CHANNEL && !inBotChannel && !mentioned) return;

    if (content.toLowerCase() === '!ping') {
      return message.reply('🏓 Pong! Bot is working.');
    }

    if (content.toLowerCase() === '!help') {
      const embed = new EmbedBuilder()
        .setColor(COLORS.blue)
        .setTitle('🤖 Bot Commands')
        .setDescription(
          [
            '`!ping` - Check if bot works',
            '`!help` - Show commands',
            '`!ask <question>` - Ask AI a question',
            '`!joke` - Get a joke',
            '',
            'You can also just mention me and ask something.',
          ].join('\n')
        );

      return message.reply({ embeds: [embed] });
    }

    if (content.toLowerCase() === '!joke') {
      await message.channel.sendTyping();

      const answer = await askGemini('Tell me one short funny joke.');

      const embed = new EmbedBuilder()
        .setColor(COLORS.gold)
        .setTitle('😂 Joke')
        .setDescription(answer);

      return message.reply({ embeds: [embed] });
    }

    if (content.toLowerCase().startsWith('!ask ')) {
      const question = content.slice(5).trim();

      if (!question) {
        return message.reply('Please type a question after `!ask`.');
      }

      await message.channel.sendTyping();

      const answer = await askGemini(question);

      const embed = new EmbedBuilder()
        .setColor(COLORS.green)
        .setTitle('AI Answer')
        .setDescription(answer);

      return message.reply({ embeds: [embed] });
    }

    if (mentioned) {
      let prompt = content.replace(`<@${client.user.id}>`, '').replace(`<@!${client.user.id}>`, '').trim();

      if (!prompt) prompt = 'Hello';

      await message.channel.sendTyping();

      const answer = await askGemini(prompt);

      return message.reply(answer);
    }

    if (!BOT_CHANNEL) {
      await message.channel.sendTyping();

      const answer = await askGemini(content);

      return message.reply(answer);
    }
  } catch (error) {
    console.error(error);

    return message.reply(
      `❌ Error: ${error.message || 'Something went wrong.'}`
    );
  }
});

client.login(BOT_TOKEN);
