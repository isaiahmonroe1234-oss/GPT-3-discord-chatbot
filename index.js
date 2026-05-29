'use strict';

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
} = require('discord.js');

require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_KEY;
const BOT_CHANNEL = process.env.BOT_CHANNEL || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let genAI = null;

if (GEMINI_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_KEY);
}

client.once(Events.ClientReady, (client) => {
  console.log(`Logged in as ${client.user.tag}`);
});

async function askAI(prompt) {
  if (!genAI) {
    return 'AI is not configured.';
  }

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    const text = message.content.trim();

    if (
      BOT_CHANNEL &&
      BOT_CHANNEL.length > 0 &&
      message.channel.id !== BOT_CHANNEL
    ) {
      return;
    }

    if (text === '!ping') {
      return message.reply('🏓 Pong! Bot is working.');
    }

    if (text === '!help') {
      return message.reply(
        [
          '**Commands**',
          '`!ping`',
          '`!help`',
          '`!ask <question>`',
          '`!image <prompt>`',
        ].join('\n')
      );
    }

    // FREE IMAGE GENERATION
    if (text.startsWith('!image ')) {
      const prompt = text.slice(7).trim();

      if (!prompt) {
        return message.reply('Please enter an image prompt.');
      }

      const imageUrl =
        'https://image.pollinations.ai/prompt/' +
        encodeURIComponent(prompt);

      const embed = new EmbedBuilder()
        .setTitle('🖼️ Generated Image')
        .setDescription(`Prompt: ${prompt}`)
        .setImage(imageUrl);

      return message.reply({
        embeds: [embed],
      });
    }

    // AI CHAT
    if (text.startsWith('!ask ')) {
      const question = text.slice(5).trim();

      if (!question) {
        return message.reply('Please enter a question.');
      }

      await message.channel.sendTyping();

      const answer = await askAI(question);

      const embed = new EmbedBuilder()
        .setTitle('AI Answer')
        .setColor('#2ECC71')
        .setDescription(answer.substring(0, 4000));

      return message.reply({
        embeds: [embed],
      });
    }
  } catch (error) {
    console.error(error);

    return message.reply(
      `❌ Error: ${error.message || 'Unknown error'}`
    );
  }
});

client.login(BOT_TOKEN);
