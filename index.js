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

// -------------------------------------------------------------
// 1. EXPRESS WEB SERVER FOR 24/7 HOSTING (RENDER)
// -------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🎵 Discord Music Bot is Online 24/7!');
});

app.listen(PORT, () => {
  console.log(`[HTTP Server] Listening on port ${PORT}`);
});

// -------------------------------------------------------------
// 2. MONGOOSE DATABASE CONNECTION & SCHEMA
// -------------------------------------------------------------
const DEFAULT_PREFIX = 'v!';
const prefixCache = new Map();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://discordmusicbot:Wearedevteam@cluster0.8vinh6j.mongodb.net/discordbot?retryWrites=true&w=majority';

const prefixSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, required: true, default: DEFAULT_PREFIX }
});

const PrefixModel = mongoose.model('Prefix', prefixSchema);

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

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

// -------------------------------------------------------------
// 3. DISCORD CLIENT SETUP
// -------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// -------------------------------------------------------------
// 4. DISTUBE SETUP (WITH YOUTUBE COOKIES)
// -------------------------------------------------------------
let youtubeCookies = undefined;

if (process.env.YOUTUBE_COOKIES) {
  try {
    youtubeCookies = JSON.parse(process.env.YOUTUBE_COOKIES);
    console.log('✅ YouTube Cookies loaded successfully!');
  } catch (err) {
    console.error('❌ YOUTUBE_COOKIES format error. Make sure it is valid JSON Array.');
  }
}

const distube = new DisTube(client, {
  plugins: [
    new YouTubePlugin({
      cookies: youtubeCookies
    })
  ],
  emitNewSongOnly: true
});

// -------------------------------------------------------------
// 5. REGISTER SLASH COMMANDS (/prefix set)
// -------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('Manage the bot prefix for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set a custom command prefix for this server')
        .addStringOption(opt =>
          opt
            .setName('new_prefix')
            .setDescription('Example: leng or v!')
            .setRequired(true)
        )
    )
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  try {
    console.log('🔄 Registering global slash commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash commands registered successfully!');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }
});

// -------------------------------------------------------------
// 6. SLASH COMMAND INTERACTION HANDLER (/prefix set)
// -------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'prefix') {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'set') {
      const newPrefix = interaction.options.getString('new_prefix').trim();

      try {
        await PrefixModel.findOneAndUpdate(
          { guildId: interaction.guildId },
          { prefix: newPrefix },
          { upsert: true, new: true }
        );
        prefixCache.set(interaction.guildId, newPrefix);

        return interaction.reply({
          content: `✅ Prefix សម្រាប់ Server នេះត្រូវបានប្តូរទៅជា៖ \`${newPrefix}\`\nឧទាហរណ៍៖ \`${newPrefix}play <ឈ្មោះបទចម្រៀង>\``
        });
      } catch (err) {
        console.error(err);
        return interaction.reply({ content: '❌ មិនអាចប្តូរ Prefix ក្នុង Database បានទេ។', ephemeral: true });
      }
    }
  }
});

// -------------------------------------------------------------
// 7. MESSAGE PREFIX COMMAND HANDLER
// -------------------------------------------------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const prefix = await getPrefix(message.guild.id);

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift()?.toLowerCase();

  const voiceChannel = message.member?.voice?.channel;

  // --- MUSIC COMMANDS ---
  if (command === 'play' || command === 'p') {
    if (!voiceChannel) {
      return message.reply('❌ អ្នកត្រូវតែចូល Voice Channel ជាមុនសិន!');
    }
    const query = args.join(' ');
    if (!query) {
      return message.reply(`❌ របៀបប្រើ៖ \`${prefix}play <ឈ្មោះបទចម្រៀង ឬ Link YouTube>\``);
    }

    message.channel.send(`🔍 កំពុងស្វែងរក និងចាក់បទ៖ **${query}**...`);
    return distube.play(voiceChannel, query, {
      textChannel: message.channel,
      member: message.member
    });
  }

  if (command === 'skip' || command === 's') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទចម្រៀងកំពុងចាក់នោះទេ!');
    try {
      await distube.skip(message);
      return message.reply('⏭️ បានរំលងទៅបទបន្ទាប់!');
    } catch {
      return message.reply('❌ គ្មានបទបន្ទាប់សម្រាប់រំលងទៀតទេ!');
    }
  }

  if (command === 'stop') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទចម្រៀងកំពុងចាក់នោះទេ!');
    await distube.stop(message);
    return message.reply('⏹️ បានបិទបទចម្រៀង និងលុប Queue ចោលរួចរាល់។');
  }

  if (command === 'pause') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទចម្រៀងកំពុងចាក់ទេ។');
    if (queue.paused) return message.reply('⏸️ បទចម្រៀងកំពុងផ្អាកស្រាប់ហើយ។');
    distube.pause(message);
    return message.reply('⏸️ បានផ្អាកបទចម្រៀង។');
  }

  if (command === 'resume') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទចម្រៀងកំពុងចាក់ទេ។');
    if (!queue.paused) return message.reply('▶️ បទចម្រៀងកំពុងចាក់ស្រាប់ហើយ។');
    distube.resume(message);
    return message.reply('▶️ បានបន្តចាក់បទចម្រៀងឡើងវិញ។');
  }

  if (command === 'queue' || command === 'q') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ បញ្ជី Queue ទទេស្អាត!');

    const q = queue.songs
      .slice(0, 10)
      .map((song, i) => `${i === 0 ? '▶️ **Now Playing:**' : `**${i}.**`} ${song.name} - \`${song.formattedDuration}\``)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🎶 បញ្ជីបទចម្រៀង (Music Queue)')
      .setDescription(q + (queue.songs.length > 10 ? `\n...និងមាន ${queue.songs.length - 10} បទទៀត។` : ''))
      .setColor('#5865F2');

    return message.channel.send({ embeds: [embed] });
  }

  if (command === 'np') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទចម្រៀងកំពុងចាក់ទេ។');
    const song = queue.songs[0];
    return message.reply(`🎵 កំពុងចាក់បទ៖ **${song.name}** [${song.formattedDuration}]`);
  }

  if (command === 'volume' || command === 'vol') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ គ្មានបទចម្រៀងកំពុងចាក់ទេ។');
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100) {
      return message.reply('❌ សូមវាយលេខកម្រិតសំឡេងពី 0 ដល់ 100។');
    }
    distube.setVolume(message, vol);
    return message.reply(`🔊 បានកំណត់កម្រិតសំឡេងទៅ **${vol}%**`);
  }

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🎵 ជំនួយ និងរបៀបប្រើប្រាស់ Bot')
      .setColor('#5865F2')
      .setDescription(`Prefix បច្ចុប្បន្នលើ Server នេះគឺ៖ \`${prefix}\``)
      .addFields(
        { name: 'Slash Command (ប្តូរ Prefix)', value: '`/prefix set <new_prefix>` - កំណត់ Prefix ថ្មី' },
        { name: 'Music Commands', value: `\`${prefix}play <ឈ្មោះបទ>\` - ចាក់បទចម្រៀង\n\`${prefix}skip\` - រំលងបទចម្រៀង\n\`${prefix}stop\` - បញ្ឈប់ការចាក់\n\`${prefix}pause\` / \`${prefix}resume\` - ផ្អាក / បន្តចាក់\n\`${prefix}queue\` - មើលបញ្ជីបទចម្រៀង\n\`${prefix}np\` - មើលបទកំពុងចាក់\n\`${prefix}volume <0-100>\` - សារេកម្រិតសំឡេង` }
      );
    return message.channel.send({ embeds: [embed] });
  }
});

// -------------------------------------------------------------
// 8. DISTUBE EVENT LISTENERS
// -------------------------------------------------------------
distube
  .on('playSong', (queue, song) => {
    queue.textChannel?.send(`🎶 កំពុងចាក់បទ៖ **${song.name}** - \`${song.formattedDuration}\` | កម្ម៉ង់ដោយ៖ ${song.user}`);
  })
  .on('addSong', (queue, song) => {
    queue.textChannel?.send(`✅ បានបន្ថែមបទ **${song.name}** - \`${song.formattedDuration}\` ចូលក្នុង Queue។`);
  })
  .on('error', (channel, e) => {
    console.error(e);
    if (channel) channel.send(`❌ Music Error: ${e.message.slice(0, 1900)}`);
  });

client.login(process.env.DISCORD_TOKEN);
