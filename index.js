require('dotenv').config();
const express = require('express');
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
// 2. DISCORD CLIENT SETUP
// -------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// In-Memory Storage for Guild Prefixes (Default: 'v!')
const prefixes = new Map();
const DEFAULT_PREFIX = 'v!';

// -------------------------------------------------------------
// 3. DISTUBE SETUP WITH SAFE YOUTUBE COOKIES CHECK (FIXED!)
// -------------------------------------------------------------
let youtubePluginOptions = {};

if (process.env.YOUTUBE_COOKIE) {
  try {
    const parsedCookies = JSON.parse(process.env.YOUTUBE_COOKIE);
    if (Array.isArray(parsedCookies) && parsedCookies.length > 0) {
      youtubePluginOptions.cookies = parsedCookies;
      console.log("✅ YouTube cookies loaded successfully!");
    } else {
      console.warn("⚠️ YOUTUBE_COOKIE is not a valid JSON array. Skipping cookies.");
    }
  } catch (err) {
    console.warn("⚠️ Failed to parse YOUTUBE_COOKIE. Skipping cookies.");
  }
}

const distube = new DisTube(client, {
  plugins: [
    new YouTubePlugin(youtubePluginOptions)
  ],
  emitNewSongOnly: true,
  leaveOnEmpty: false,
  leaveOnStop: false,
  leaveOnFinish: false
});

// -------------------------------------------------------------
// 4. REGISTER SLASH COMMANDS (/prefix set)
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
// 5. SLASH COMMAND INTERACTION HANDLER (/prefix set)
// -------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'prefix') {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'set') {
      const newPrefix = interaction.options.getString('new_prefix').trim();
      prefixes.set(interaction.guildId, newPrefix);

      return interaction.reply({
        content: `✅ Prefix for this server has been changed to: \`${newPrefix}\`\nExample command: \`${newPrefix}play <song>\``
      });
    }
  }
});

// -------------------------------------------------------------
// 6. MESSAGE PREFIX COMMAND HANDLER
// -------------------------------------------------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Get dynamic server prefix or fall back to default 'v!'
  const prefix = prefixes.get(message.guild.id) || DEFAULT_PREFIX;

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift()?.toLowerCase();

  const voiceChannel = message.member?.voice?.channel;

  // --- MUSIC COMMANDS ---

  // Play Command
  if (command === 'play' || command === 'p') {
    if (!voiceChannel) {
      return message.reply('❌ You must join a voice channel first!');
    }
    const query = args.join(' ');
    if (!query) {
      return message.reply(`❌ Usage: \`${prefix}play <song name or URL>\``);
    }

    message.channel.send(`🔍 Searching and playing: **${query}**...`);
    return distube.play(voiceChannel, query, {
      textChannel: message.channel,
      member: message.member
    });
  }

  // Skip Command
  if (command === 'skip' || command === 's') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ There is no music playing right now!');
    try {
      const song = await distube.skip(message);
      return message.reply('⏭️ Skipped to the next song!');
    } catch {
      return message.reply('❌ No next song in queue to skip to!');
    }
  }

  // Stop Command
  if (command === 'stop') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ There is no music playing right now!');
    await distube.stop(message);
    return message.reply('⏹️ Stopped the music and cleared the queue.');
  }

  // Pause Command
  if (command === 'pause') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ No music playing.');
    if (queue.paused) return message.reply('⏸️ The music is already paused.');
    distube.pause(message);
    return message.reply('⏸️ Paused the music.');
  }

  // Resume Command
  if (command === 'resume') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ No music playing.');
    if (!queue.paused) return message.reply('▶️ The music is already playing.');
    distube.resume(message);
    return message.reply('▶️ Resumed the music.');
  }

  // Queue Command
  if (command === 'queue' || command === 'q') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ The queue is currently empty!');

    const q = queue.songs
      .slice(0, 10)
      .map((song, i) => `${i === 0 ? '▶️ **Now Playing:**' : `**${i}.**`} ${song.name} - \`${song.formattedDuration}\``)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🎶 Current Music Queue')
      .setDescription(q + (queue.songs.length > 10 ? `\n...and ${queue.songs.length - 10} more songs.` : ''))
      .setColor('#5865F2');

    return message.channel.send({ embeds: [embed] });
  }

  // Now Playing Command
  if (command === 'np') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ Nothing is currently playing.');
    const song = queue.songs[0];
    return message.reply(`🎵 Now playing: **${song.name}** [${song.formattedDuration}]`);
  }

  // Volume Command
  if (command === 'volume' || command === 'vol') {
    const queue = distube.getQueue(message);
    if (!queue) return message.reply('❌ No music playing.');
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100) {
      return message.reply('❌ Please enter a valid volume between 0 and 100.');
    }
    distube.setVolume(message, vol);
    return message.reply(`🔊 Volume set to **${vol}%**`);
  }

  // Help Command
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Music Bot Help')
      .setColor('#5865F2')
      .setDescription(`Current server prefix is: \`${prefix}\``)
      .addFields(
        { name: 'Slash Commands', value: '`/prefix set <new_prefix>` - Change server prefix' },
        { name: 'Music Commands', value: `\`${prefix}play <query>\` - Play a song\n\`${prefix}skip\` - Skip current song\n\`${prefix}stop\` - Stop music\n\`${prefix}pause\` / \`${prefix}resume\` - Pause/Resume\n\`${prefix}queue\` - Show queue\n\`${prefix}np\` - Current song\n\`${prefix}volume <0-100>\` - Adjust volume` }
      );
    return message.channel.send({ embeds: [embed] });
  }
});

// -------------------------------------------------------------
// 7. DISTUBE EVENT LISTENERS
// -------------------------------------------------------------
distube
  .on('playSong', (queue, song) => {
    queue.textChannel?.send(`🎶 Playing: **${song.name}** - \`${song.formattedDuration}\` | Requested by: ${song.user}`);
  })
  .on('addSong', (queue, song) => {
    queue.textChannel?.send(`✅ Added **${song.name}** - \`${song.formattedDuration}\` to queue.`);
  })
  .on('error', (channel, e) => {
    console.error(e);
    if (channel) channel.send(`❌ Music Error: ${e.message.slice(0, 1900)}`);
  });

// -------------------------------------------------------------
// 8. LOG IN THE BOT
// -------------------------------------------------------------
client.login(process.env.DISCORD_TOKEN);