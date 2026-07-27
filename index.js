require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');
const { DisTube } = require('distube');
const { YouTubePlugin } = require('@distube/youtube');
const { YtDlpPlugin } = require('@distube/yt-dlp');

// =======================================================
// 1. WEB SERVER (សម្រាប់រត់ 24/7 លើ Render)
// =======================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🎵 Discord Music Bot is Online & Fixed!'));
app.listen(PORT, () => console.log(`✅ [Server] Web Server running on port ${PORT}`));

// =======================================================
// 2. MONGODB (DATABASE)
// =======================================================
const DEFAULT_PREFIX = 'v!';
const prefixCache = new Map();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://discordmusicbot:Wearedevteam@cluster0.8vinh6j.mongodb.net/discordbot?retryWrites=true&w=majority';

const prefixSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, required: true, default: DEFAULT_PREFIX }
});
const PrefixModel = mongoose.model('Prefix', prefixSchema);

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ [MongoDB] Connected successfully!'))
  .catch(err => console.error('❌ [MongoDB] Error:', err));

async function getPrefix(guildId) {
  if (prefixCache.has(guildId)) return prefixCache.get(guildId);
  try {
    const data = await PrefixModel.findOne({ guildId });
    const p = data ? data.prefix : DEFAULT_PREFIX;
    prefixCache.set(guildId, p);
    return p;
  } catch {
    return DEFAULT_PREFIX;
  }
}

// =======================================================
// 3. DISCORD CLIENT
// =======================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =======================================================
// 4. DISTUBE (MUSIC ENGINE - FULLY FIXED)
// =======================================================
let youtubeCookies = undefined;
if (process.env.YOUTUBE_COOKIES) {
  try {
    youtubeCookies = JSON.parse(process.env.YOUTUBE_COOKIES);
    console.log('✅ [Cookies] YouTube Cookies Loaded!');
  } catch (err) {
    console.error('❌ [Cookies] Error parsing YOUTUBE_COOKIES. It must be valid JSON.');
  }
}

const distube = new DisTube(client, {
  plugins: [
    new YouTubePlugin({ cookies: youtubeCookies }),
    new YtDlpPlugin({ update: true }) // <--- ជំនួយការ Bypass YouTube ខ្លាំងបំផុត
  ],
  leaveOnEmpty: false,   // កុំឱ្យរត់ចេញពេលគ្មានអ្នកស្តាប់
  leaveOnFinish: false,  // កុំឱ្យរត់ចេញពេលចាក់ចប់បទ
  leaveOnStop: false,    // កុំឱ្យរត់ចេញពេលគេវាយបញ្ជា Stop
  emitNewSongOnly: true,
  savePreviousSongs: true
});

// =======================================================
// 5. COMMANDS & EVENTS
// =======================================================
const commands = [
  new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('Manage the bot prefix')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('set')
         .setDescription('Set a new prefix')
         .addStringOption(opt => opt.setName('new_prefix').setDescription('Ex: v!').setRequired(true))
    )
];

client.once('ready', async () => {
  console.log(`✅ [Discord] Logged in as ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ [Commands] Slash commands registered!');
  } catch (err) {
    console.error('❌ [Commands] Failed to register:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'prefix' && interaction.options.getSubcommand() === 'set') {
    const newPrefix = interaction.options.getString('new_prefix').trim();
    try {
      await PrefixModel.findOneAndUpdate({ guildId: interaction.guildId }, { prefix: newPrefix }, { upsert: true });
      prefixCache.set(interaction.guildId, newPrefix);
      return interaction.reply(`✅ Prefix បានប្តូរទៅជា៖ \`${newPrefix}\``);
    } catch (err) {
      return interaction.reply({ content: '❌ មិនអាចប្តូរ Prefix បានទេ។', ephemeral: true });
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const prefix = await getPrefix(message.guild.id);
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift()?.toLowerCase();
  const voiceChannel = message.member?.voice?.channel;

  if (['play', 'p'].includes(command)) {
    if (!voiceChannel) return message.reply('❌ សូមចូល Voice Channel ជាមុនសិន!');
    const query = args.join(' ');
    if (!query) return message.reply(`❌ របៀបប្រើ៖ \`${prefix}play <ឈ្មោះបទ>\``);

    message.channel.send(`🔍 កំពុងស្វែងរក៖ **${query}**...`);
    try {
      distube.play(voiceChannel, query, {
        textChannel: message.channel,
        member: message.member
      });
    } catch (error) {
      console.error(error);
      message.channel.send('❌ មានបញ្ហាក្នុងការចាក់បទនេះ សូមសាកល្បងម្ដងទៀត។');
    }
  }

  else if (['skip', 's'].includes(command)) {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទកំពុងចាក់ទេ!');
    try { await distube.skip(message); message.reply('⏭️ រំលងបទ!'); } 
    catch { message.reply('❌ គ្មានបទបន្ទាប់ទេ!'); }
  }

  else if (command === 'stop') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទកំពុងចាក់ទេ!');
    distube.stop(message);
    message.reply('⏹️ បានបញ្ឈប់!');
  }

  else if (command === 'queue' || command === 'q') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ បញ្ជី Queue ទទេ!');
    const q = queue.songs.slice(0, 10).map((song, i) => `${i === 0 ? '▶️' : `**${i}.**`} ${song.name} - \`${song.formattedDuration}\``).join('\n');
    message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎶 បញ្ជីបទចម្រៀង').setDescription(q).setColor('#5865F2')] });
  }
});

// =======================================================
// 6. DISTUBE MUSIC EVENTS (LOGS & ERRORS)
// =======================================================
distube
  .on('playSong', (queue, song) => {
    queue.textChannel?.send(`🎶 កំពុងចាក់បទ៖ **${song.name}** \`[${song.formattedDuration}]\` | កម្ម៉ង់ដោយ៖ ${song.user}`);
  })
  .on('addSong', (queue, song) => {
    queue.textChannel?.send(`✅ បានបន្ថែមបទ **${song.name}** \`[${song.formattedDuration}]\` ចូល Queue`);
  })
  .on('error', (channel, error) => {
    console.error('DISTUBE ERROR:', error);
    // បង្ហាញ Error ច្បាស់ៗចូលក្នុង Discord ដើម្បីងាយស្រួលដឹង
    if (channel) channel.send(`❌ **បញ្ហាពី YouTube:** \`${error.message.substring(0, 150)}...\` (អាចមកពី YouTube Block លើ Render)`);
  })
  .on('disconnect', (queue) => {
    queue.textChannel?.send('🔌 Bot ត្រូវបានផ្តាច់ចេញពី Voice Channel ហើ់យ។');
  });

client.login(process.env.DISCORD_TOKEN);
