const { 
    Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');
const express = require('express');
require('dotenv').config();

// --- 1. EXPRESS SERVER (ចាំបាច់សម្រាប់ Render មិនឱ្យបែក Port Error) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 Discord Music Bot is running smoothly on Render!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web Server is running on port ${PORT}`);
});

// --- 2. SPOTIFY TOKEN SETUP ---
play.setToken({
    spotify: {
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
        refresh_token: '',
        market: 'US'
    }
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const queues = new Map();

class ServerQueue {
    constructor(textChannel, voiceChannel) {
        this.textChannel = textChannel;
        this.voiceChannel = voiceChannel;
        this.connection = null;
        this.player = createAudioPlayer();
        this.songs = [];
        this.playing = true;
        this.loop = false;

        this.player.on(AudioPlayerStatus.Idle, () => {
            if (this.loop && this.songs.length > 0) {
                const playedSong = this.songs.shift();
                this.songs.push(playedSong);
            } else {
                this.songs.shift();
            }
            this.playNext();
        });

        this.player.on('error', error => console.error('Player Error:', error));
    }

    async playNext() {
        if (this.songs.length === 0) {
            if (this.connection) this.connection.destroy();
            queues.delete(this.textChannel.guild.id);
            return this.textChannel.send('🎵 ចម្រៀងក្នុង Queue អស់ហើយ! Bot បានចាកចេញពី Voice Channel។');
        }

        const song = this.songs[0];
        try {
            let stream;
            if (play.sp_validate(song.url) === 'track' || song.isSearch) {
                stream = await play.stream(`${song.title}`, { source: { soundcloud: "tracks" } });
            } else if (play.so_validate(song.url)) {
                stream = await play.stream(song.url);
            } else {
                stream = await play.stream(song.title, { source: { soundcloud: "tracks" } });
            }

            const resource = createAudioResource(stream.stream, { inputType: stream.type });
            this.player.play(resource);

            // Controls UI (Buttons)
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pause_resume').setLabel('⏯️ Pause/Resume').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('loop').setLabel(this.loop ? '🔁 Loop: ON' : '🔁 Loop: OFF').setStyle(ButtonStyle.Success)
            );

            const embed = new EmbedBuilder()
                .setTitle('🎶 កំពុងលេង (Now Playing)')
                .setDescription(`**[${song.title}](${song.url})**\nស្នើដោយ៖ ${song.requestedBy}`)
                .setColor('#1DB954');

            this.textChannel.send({ embeds: [embed], components: [row] });
        } catch (err) {
            console.error(err);
            this.textChannel.send(`⚠️ មានបញ្ហាក្នុងการលេងបទ៖ **${song.title}**! កំពុង Skip...`);
            this.songs.shift();
            this.playNext();
        }
    }
}

// --- 3. SLASH COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('play').setDescription('លេងចម្រៀងពី Spotify/SoundCloud/Search')
        .addStringOption(opt => opt.setName('query').setDescription('ឈ្មោះបទ ឬ Link').setRequired(true)),
    new SlashCommandBuilder().setName('search').setDescription('ស្វែងរកចម្រៀង ៥ បទ ហើយជ្រើសរើសលេង')
        .addStringOption(opt => opt.setName('query').setDescription('ឈ្មោះបទ').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('Skip បទចម្រៀងបច្ចុប្បន្ន'),
    new SlashCommandBuilder().setName('stop').setDescription('បញ្ឈប់ចម្រៀង និងលុប Queue'),
    new SlashCommandBuilder().setName('queue').setDescription('មើលបញ្ជីចម្រៀង (Queue)'),
    new SlashCommandBuilder().setName('shuffle').setDescription('ច្របល់បញ្ជីចម្រៀង'),
    new SlashCommandBuilder().setName('loop').setDescription('បើក/បិទ Loop បទចម្រៀង'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.on('ready', async () => {
    console.log(`✅ Bot Online: ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Registered Slash Commands successfully!');
    } catch (e) { console.error(e); }
});

// --- 4. INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, member, guildId, channel } = interaction;
        const voiceChannel = member.voice.channel;

        if (['play', 'search'].includes(commandName) && !voiceChannel) {
            return interaction.reply({ content: '❌ អ្នកត្រូវចូល Voice Channel ជាមុនសិន!', ephemeral: true });
        }

        let serverQueue = queues.get(guildId);

        if (commandName === 'play' || commandName === 'search') {
            await interaction.deferReply();
            const query = options.getString('query');

            if (commandName === 'search') {
                const results = await play.search(query, { limit: 5, source: { soundcloud: 'tracks' } });
                if (!results || results.length === 0) return interaction.editReply('❌ រកមិនឃើញចម្រៀងទេ!');

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_song')
                    .setPlaceholder('ជ្រើសរើសចម្រៀងមួយ...')
                    .addOptions(results.map((track, i) => ({
                        label: `${i + 1}. ${track.name}`.slice(0, 100),
                        value: track.url,
                        description: `Duration: ${track.durationRaw || 'N/A'}`
                    })));

                const row = new ActionRowBuilder().addComponents(selectMenu);
                return interaction.editReply({ content: '🔍 **លទ្ធផលស្វែងរក៖**', components: [row] });
            }

            let songsToAdd = [];
            if (play.sp_validate(query) === 'track') {
                const spData = await play.spotify(query);
                songsToAdd.push({
                    title: `${spData.name} - ${spData.artists.map(a => a.name).join(', ')}`,
                    url: query,
                    requestedBy: member.user.username
                });
            } else if (play.sp_validate(query) === 'playlist' || play.sp_validate(query) === 'album') {
                const spList = await play.spotify(query);
                const allTracks = await spList.all_tracks();
                songsToAdd = allTracks.map(t => ({
                    title: `${t.name} - ${t.artists.map(a => a.name).join(', ')}`,
                    url: t.url,
                    requestedBy: member.user.username,
                    isSearch: true
                }));
            } else {
                songsToAdd.push({
                    title: query,
                    url: query,
                    requestedBy: member.user.username,
                    isSearch: true
                });
            }

            if (!serverQueue) {
                serverQueue = new ServerQueue(channel, voiceChannel);
                queues.set(guildId, serverQueue);
                serverQueue.songs.push(...songsToAdd);

                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: guildId,
                    adapterCreator: guildId => guildId, // fixed fallback
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                });
                serverQueue.connection = connection;
                connection.subscribe(serverQueue.player);
                serverQueue.playNext();

                interaction.editReply(`✅ បានបន្ថែម **${songsToAdd.length} បទ** ចូល Queue!`);
            } else {
                serverQueue.songs.push(...songsToAdd);
                interaction.editReply(`✅ បានបន្ថែម **${songsToAdd.length} បទ** ចូល Queue!`);
            }
        }

        if (commandName === 'skip') {
            if (!serverQueue) return interaction.reply('❌ គ្មានចម្រៀងកំពុងលេងទេ!');
            serverQueue.player.stop();
            interaction.reply('⏭️ Skipped!');
        }

        if (commandName === 'stop') {
            if (!serverQueue) return interaction.reply('❌ គ្មានចម្រៀងកំពុងលេងទេ!');
            serverQueue.songs = [];
            serverQueue.player.stop();
            if (serverQueue.connection) serverQueue.connection.destroy();
            queues.delete(guildId);
            interaction.reply('⏹️ Stopped and cleared queue!');
        }

        if (commandName === 'queue') {
            if (!serverQueue || serverQueue.songs.length === 0) return interaction.reply('❌ Queue ទទេ!');
            const queueList = serverQueue.songs.slice(0, 10).map((s, i) => `${i + 1}. **${s.title}**`).join('\n');
            const embed = new EmbedBuilder()
                .setTitle('📜 Queue (Top 10)')
                .setDescription(queueList)
                .setColor('#0099FF');
            interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'shuffle') {
            if (!serverQueue || serverQueue.songs.length < 2) return interaction.reply('❌ ចម្រៀងមិនគ្រប់គ្រាន់ដើម្បី Shuffle ទេ!');
            const current = serverQueue.songs.shift();
            serverQueue.songs.sort(() => Math.random() - 0.5);
            serverQueue.songs.unshift(current);
            interaction.reply('🔀 Shuffled!');
        }

        if (commandName === 'loop') {
            if (!serverQueue) return interaction.reply('❌ គ្មានចម្រៀងកំពុងលេងទេ!');
            serverQueue.loop = !serverQueue.loop;
            interaction.reply(`🔁 Loop: **${serverQueue.loop ? 'ON' : 'OFF'}**`);
        }
    }

    // BUTTON & SELECT MENU HANDLERS
    if (interaction.isButton()) {
        const serverQueue = queues.get(interaction.guildId);
        if (!serverQueue) return interaction.reply({ content: '❌ គ្មានចម្រៀងកំពុងលេងទេ!', ephemeral: true });

        if (interaction.customId === 'pause_resume') {
            if (serverQueue.playing) {
                serverQueue.player.pause();
                serverQueue.playing = false;
                interaction.reply({ content: '⏸️ Paused!', ephemeral: true });
            } else {
                serverQueue.player.unpause();
                serverQueue.playing = true;
                interaction.reply({ content: '▶️ Resumed!', ephemeral: true });
            }
        } else if (interaction.customId === 'skip') {
            serverQueue.player.stop();
            interaction.reply({ content: '⏭️ Skipped!', ephemeral: true });
        } else if (interaction.customId === 'stop') {
            serverQueue.songs = [];
            serverQueue.player.stop();
            if (serverQueue.connection) serverQueue.connection.destroy();
            queues.delete(interaction.guildId);
            interaction.reply({ content: '⏹️ Stopped!', ephemeral: true });
        } else if (interaction.customId === 'shuffle') {
            const current = serverQueue.songs.shift();
            serverQueue.songs.sort(() => Math.random() - 0.5);
            serverQueue.songs.unshift(current);
            interaction.reply({ content: '🔀 Shuffled!', ephemeral: true });
        } else if (interaction.customId === 'loop') {
            serverQueue.loop = !serverQueue.loop;
            interaction.reply({ content: `🔁 Loop ${serverQueue.loop ? 'ON' : 'OFF'}!`, ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_song') {
        const selectedUrl = interaction.values[0];
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ចូល Voice Channel សិន!', ephemeral: true });

        await interaction.deferUpdate();
        let serverQueue = queues.get(interaction.guildId);

        const songObj = {
            title: selectedUrl,
            url: selectedUrl,
            requestedBy: interaction.user.username
        };

        if (!serverQueue) {
            serverQueue = new ServerQueue(interaction.channel, voiceChannel);
            queues.set(interaction.guildId, serverQueue);
            serverQueue.songs.push(songObj);

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });
            serverQueue.connection = connection;
            connection.subscribe(serverQueue.player);
            serverQueue.playNext();
        } else {
            serverQueue.songs.push(songObj);
            interaction.followUp(`✅ បានបន្ថែមចូល Queue!`);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
