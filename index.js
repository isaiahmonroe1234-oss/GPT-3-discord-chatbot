'use strict';

const {
    Client, Events, GatewayIntentBits, EmbedBuilder,
    ActivityType, PermissionsBitField
} = require("discord.js");
require("dotenv/config");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const BOT_TOKEN   = process.env.BOT_TOKEN;
const GEMINI_KEY  = process.env.GEMINI_KEY;
const BOT_CHANNEL = process.env.BOT_CHANNEL || "";

const FREE_MESSAGE_LIMIT  = parseInt(process.env.FREE_MESSAGE_LIMIT  || "10");
const FREE_WINDOW_MS      = parseInt(process.env.FREE_WINDOW_MS      || "3600000");
const USER_COOLDOWN_MS    = parseInt(process.env.USER_COOLDOWN_MS    || "10000");
const MAX_RPM             = parseInt(process.env.MAX_RPM             || "8");

const COLORS = {
    gold:   '#FFD700',
    blue:   '#54A0FF',
    purple: '#A55EEA',
    red:    '#FF4757',
    green:  '#2ECC71',
    orange: '#FF6B35',
};
const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// ─── Retry with exponential backoff ──────────────────────────────────────────
async function withRetry(fn, retries = 3, delayMs = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const isRateLimit = /429|quota|retry|resource.has.been.exhausted/i.test(err.message || '');
            if (isRateLimit && attempt < retries) {
                const wait = delayMs * attempt;
                console.warn(`[RETRY] Gemini rate limited. Attempt ${attempt}/${retries}. Waiting ${wait}ms...`);
                await new Promise(r => setTimeout(r, wait));
            } else {
                throw err;
            }
        }
    }
}

// ─── Quota tracker ────────────────────────────────────────────────────────────
const quotaMap = new Map();

function getQuota(channelId) {
    if (!quotaMap.has(channelId)) {
        quotaMap.set(channelId, { count: 0, windowStart: Date.now() });
    }
    return quotaMap.get(channelId);
}

function resetQuota(channelId) {
    quotaMap.set(channelId, { count: 0, windowStart: Date.now() });
}

function checkQuota(channelId) {
    const q = getQuota(channelId);
    const now = Date.now();
    const elapsed = now - q.windowStart;
    if (elapsed >= FREE_WINDOW_MS) {
        resetQuota(channelId);
        return { allowed: true, used: 0, limit: FREE_MESSAGE_LIMIT, msUntilReset: FREE_WINDOW_MS };
    }
    const msUntilReset = FREE_WINDOW_MS - elapsed;
    const allowed = q.count < FREE_MESSAGE_LIMIT;
    return { allowed, used: q.count, limit: FREE_MESSAGE_LIMIT, msUntilReset };
}

function consumeQuota(channelId) {
    getQuota(channelId).count += 1;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const rateLimiter = {
    requests: [],
    cooldowns: new Map(),
    canRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(t => now - t < 60_000);
        return this.requests.length < MAX_RPM;
    },
    record() { this.requests.push(Date.now()); },
    timeUntilReset() {
        if (this.requests.length === 0) return 0;
        return Math.ceil((60_000 - (Date.now() - this.requests[0])) / 1000);
    },
    isUserOnCooldown(userId) {
        const last = this.cooldowns.get(userId);
        return last ? Date.now() - last < USER_COOLDOWN_MS : false;
    },
    setUserCooldown(userId) { this.cooldowns.set(userId, Date.now()); },
    userTimeLeft(userId) {
        const last = this.cooldowns.get(userId);
        return last ? Math.ceil((USER_COOLDOWN_MS - (Date.now() - last)) / 1000) : 0;
    },
};

// ─── Progress bar ─────────────────────────────────────────────────────────────
function buildProgressBar(current, total, length = 20) {
    const pct    = Math.max(0, Math.min(1, current / total));
    const filled = Math.round(pct * length);
    const empty  = length - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(pct * 100)}%`;
}

// ─── Lock / unlock ────────────────────────────────────────────────────────────
async function lockChannel(channel, msUntilUnlock) {
    try {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
            SendMessages: false,
        });
        console.log(`[LOCK] #${channel.name} locked for ${Math.round(msUntilUnlock / 1000)}s`);
    } catch (err) {
        console.error('[LOCK ERROR]', err.message);
    }

    setTimeout(async () => {
        await unlockChannel(channel);
        resetQuota(channel.id);
        try {
            const embed = new EmbedBuilder()
                .setColor(COLORS.green)
                .setTitle('🔓 Channel Unlocked!')
                .setDescription(
                    `The free-message window has reset.\n\n` +
                    `You have **${FREE_MESSAGE_LIMIT} messages** available again.\n\n${DIVIDER}`
                )
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        } catch { /* ignore */ }
    }, msUntilUnlock);
}

async function unlockChannel(channel) {
    try {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
            SendMessages: null,
        });
        console.log(`[UNLOCK] #${channel.name} unlocked`);
    } catch (err) {
        console.error('[UNLOCK ERROR]', err.message);
    }
}

// ─── Live countdown embed ─────────────────────────────────────────────────────
async function sendCountdownEmbed(channel, titleText, initialMs, color) {
    const totalSecs = Math.round(initialMs / 1000);

    const buildEmbed = (secsLeft) => {
        const mins = Math.floor(secsLeft / 60);
        const secs = secsLeft % 60;
        const bar  = buildProgressBar(secsLeft, totalSecs);
        return new EmbedBuilder()
            .setColor(color)
            .setTitle(titleText)
            .setDescription(
                `**Time remaining until unlock:**\n\n` +
                `⏱  \`${mins}m ${String(secs).padStart(2, '0')}s\`\n\n` +
                `${bar}\n\n${DIVIDER}`
            )
            .setFooter({ text: `Resets in ${mins}m ${String(secs).padStart(2, '0')}s` })
            .setTimestamp();
    };

    let secsLeft = Math.max(1, totalSecs);
    let sent;
    try {
        sent = await channel.send({ embeds: [buildEmbed(secsLeft)] });
    } catch { return; }

    const interval = setInterval(async () => {
        secsLeft -= 1;
        if (secsLeft <= 0) {
            clearInterval(interval);
            try {
                await sent.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(COLORS.green)
                            .setTitle('✅ Timer Expired — Channel Unlocked!')
                            .setDescription(`The free window has reset.\n\n${DIVIDER}`)
                            .setTimestamp()
                    ]
                });
            } catch { /* ignore */ }
            return;
        }
        try {
            await sent.edit({ embeds: [buildEmbed(secsLeft)] });
        } catch {
            clearInterval(interval);
        }
    }, 1000);
}

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

client.once(Events.ClientReady, (c) => {
    console.log(`[READY] Logged in as ${c.user.tag}`);
    c.user.setActivity('your messages 👀', { type: ActivityType.Watching });
});

// ─── AI wrapper ───────────────────────────────────────────────────────────────
async function runAI(message, fn) {
    const userId = message.author.id;

    if (rateLimiter.isUserOnCooldown(userId)) {
        const secs = rateLimiter.userTimeLeft(userId);
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.orange)
                    .setTitle('⏳ Slow Down!')
                    .setDescription(`You're sending messages too fast.\n\nPlease wait **${secs}s** before trying again.\n\n${DIVIDER}`)
                    .setTimestamp()
            ]
        });
    }

    if (!rateLimiter.canRequest()) {
        const secs = rateLimiter.timeUntilReset();
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.orange)
                    .setTitle('🚦 Rate Limited')
                    .setDescription(`The bot has hit its request limit.\n\nPlease wait **${secs}s** and try again.\n\n${DIVIDER}`)
                    .setFooter({ text: `Free tier: ${MAX_RPM} requests/minute` })
                    .setTimestamp()
            ]
        });
    }

    rateLimiter.setUserCooldown(userId);
    rateLimiter.record();

    try {
        await withRetry(fn);
    } catch (err) {
        console.error('[AI ERROR]', err.message);
        const isRateLimit = /429|quota|retry|resource.has.been.exhausted/i.test(err.message || '');
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(isRateLimit ? COLORS.orange : COLORS.red)
                    .setTitle(isRateLimit ? '🚦 Rate Limited by Google' : '❌ AI Error')
                    .setDescription(
                        isRateLimit
                            ? `Too many requests to Gemini.\n\nThe bot already retried 3 times. Please wait **30–60 seconds** and try again.\n\n${DIVIDER}`
                            : `> ${err.message}\n\n${DIVIDER}`
                    )
                    .setTimestamp()
            ]
        });
    }
}

// ─── Message handler ──────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const inTargetChannel = BOT_CHANNEL ? message.channel.id === BOT_CHANNEL : false;
    const wasMentioned    = message.mentions.has(client.user);
    if (!inTargetChannel && !wasMentioned) return;

    const content = message.content.trim();

    // !help
    if (content.toLowerCase() === '!help') {
        const { used, limit, msUntilReset } = checkQuota(message.channel.id);
        const mins = Math.floor(msUntilReset / 60_000);
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.blue)
                    .setTitle('🤖 Bot Commands')
                    .setDescription(DIVIDER)
                    .addFields(
                        { name: '💬 Chat',           value: 'Type normally or @mention me anywhere' },
                        { name: '❓ !help',           value: 'Shows this command list' },
                        { name: '🤖 !ask <question>', value: 'Ask the AI a direct question' },
                        { name: '🔥 !roast @user',    value: 'Roast someone with AI' },
                        { name: '😂 !joke',           value: 'Get a random joke' },
                        { name: '🏓 !ping',           value: 'Check if the bot is alive' },
                        { name: '📊 !quota',          value: 'Check remaining free messages' },
                        { name: '📈 Free Messages',   value: `**${limit - used}/${limit}** remaining • resets in ~${mins}m` },
                    )
                    .setFooter({ text: 'Powered by Gemini 2.0 Flash (Free)', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp()
            ]
        });
    }

    // !ping
    if (content.toLowerCase() === '!ping') {
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.green)
                    .setTitle('🏓 Pong!')
                    .setDescription(`Bot is alive!\n\n**Latency:** ${client.ws.ping}ms\n\n${DIVIDER}`)
                    .setTimestamp()
            ]
        });
    }

    // !quota
    if (content.toLowerCase() === '!quota') {
        const { used, limit, msUntilReset } = checkQuota(message.channel.id);
        const remaining = limit - used;
        const mins = Math.floor(msUntilReset / 60_000);
        const secs = Math.floor((msUntilReset % 60_000) / 1000);
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(remaining > 0 ? COLORS.green : COLORS.red)
                    .setTitle('📊 Free Message Quota')
                    .setDescription(
                        `**${remaining}/${limit}** messages remaining\n\n` +
                        `${buildProgressBar(remaining, limit)}\n\n` +
                        `⏱  Window resets in \`${mins}m ${String(secs).padStart(2, '0')}s\`\n\n${DIVIDER}`
                    )
                    .setTimestamp()
            ]
        });
    }

    // !joke
    if (content.toLowerCase() === '!joke') {
        message.channel.sendTyping();
        return runAI(message, async () => {
            const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' }); // ← FIXED
            const result = await model.generateContent('Tell me one short, funny joke. Just the joke, no intro.');
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.purple)
                        .setTitle('😂 Random Joke')
                        .setDescription(`${result.response.text()}\n\n${DIVIDER}`)
                        .setFooter({ text: 'Powered by Gemini', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp()
                ]
            });
        });
    }

    // !roast @user
    if (content.toLowerCase().startsWith('!roast')) {
        const target     = message.mentions.users.first();
        const targetName = target ? target.username : 'this person';
        message.channel.sendTyping();
        return runAI(message, async () => {
            const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' }); // ← FIXED
            const result = await model.generateContent(
                `Write a funny, lighthearted roast for someone named "${targetName}". Keep it playful, not mean. 2-3 sentences max.`
            );
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.red)
                        .setTitle(`🔥 Roasting ${targetName}...`)
                        .setDescription(`${result.response.text()}\n\n${DIVIDER}`)
                        .setFooter({ text: `Requested by ${message.author.username}`, iconURL: client.user.displayAvatarURL() })
                        .setTimestamp()
                ]
            });
        });
    }

    // !ask <question>
    if (content.toLowerCase().startsWith('!ask ')) {
        const question = content.slice(5).trim();
        if (!question) return message.reply('> ❌ Please provide a question! e.g. `!ask what is the meaning of life`');
        message.channel.sendTyping();
        return runAI(message, async () => {
            const model  = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash', // ← FIXED
                systemInstruction: 'Answer concisely and helpfully. You are a Discord bot assistant.',
            });
            const result = await model.generateContent(question);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(COLORS.gold)
                        .setAuthor({ name: 'AI ASSISTANT', iconURL: 'https://cdn-icons-png.flaticon.com/512/471/471663.png' })
                        .setDescription(`**Q: ${question}**\n\n${result.response.text()}\n\n${DIVIDER}`)
                        .setFooter({ text: `Asked by ${message.author.username}`, iconURL: client.user.displayAvatarURL() })
                        .setTimestamp()
                ]
            });
        });
    }

    // ── General AI chat — quota-gated ─────────────────────────────────────────
    if (!GEMINI_KEY) return message.reply('> ❌ **Missing Key** — `GEMINI_KEY` is not set.');

    const { allowed, used, limit, msUntilReset } = checkQuota(message.channel.id);

    if (!allowed) {
        const mins = Math.floor(msUntilReset / 60_000);
        const secs = Math.floor((msUntilReset % 60_000) / 1000);
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(COLORS.red)
                    .setTitle('🔒 Free Message Limit Reached')
                    .setDescription(
                        `This channel has used all **${limit}** free AI messages for this window.\n\n` +
                        `Channel will unlock in:\n\n` +
                        `⏱  \`${mins}m ${String(secs).padStart(2, '0')}s\`\n\n${DIVIDER}`
                    )
                    .setTimestamp()
            ]
        });
        await lockChannel(message.channel, msUntilReset);
        await sendCountdownEmbed(message.channel, '🔒 Channel Locked — Free Limit Used', msUntilReset, COLORS.red);
        return;
    }

    consumeQuota(message.channel.id);
    const remaining = limit - (used + 1);

    message.channel.sendTyping();

    return runAI(message, async () => {
        let rawMessages = Array.from(
            await message.channel.messages.fetch({ limit: 10, before: message.id })
        );
        rawMessages = rawMessages.map(m => m[1]).reverse();

        const history = [];
        for (const m of rawMessages) {
            if (m.author.bot && m.author.id !== client.user.id) continue;
            const role = m.author.id === client.user.id ? 'model' : 'user';
            history.push({ role, parts: [{ text: m.content || '(no text)' }] });
        }

        const model  = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash', // ← FIXED
            systemInstruction: 'You are a helpful, friendly, and witty AI assistant in a Discord server. Keep responses concise and conversational.',
        });

        const chat   = model.startChat({ history });
        const result = await chat.sendMessage(content || 'Hello!');

        let footerText = `Gemini 2.0 Flash (Free) • ${remaining}/${limit} messages left`;
        if (remaining === 0)      footerText = `⚠️ Last free message used — channel will now lock!`;
        else if (remaining <= 2)  footerText = `⚠️ Only ${remaining} free message${remaining === 1 ? '' : 's'} left!`;

        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(remaining === 0 ? COLORS.red : remaining <= 2 ? COLORS.orange : COLORS.gold)
                    .setAuthor({ name: 'AI ASSISTANT', iconURL: 'https://cdn-icons-png.flaticon.com/512/471/471663.png' })
                    .setDescription(`${result.response.text()}\n\n${DIVIDER}`)
                    .setFooter({ text: footerText, iconURL: client.user.displayAvatarURL() })
                    .setTimestamp()
            ]
        });

        if (remaining === 0) {
            const { msUntilReset: ms } = checkQuota(message.channel.id);
            await lockChannel(message.channel, ms);
            await sendCountdownEmbed(message.channel, '🔒 Channel Locked — Free Limit Used', ms, COLORS.red);
        }
    });
});

client.login(BOT_TOKEN);
